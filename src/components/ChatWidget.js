'use client'

import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, Fragment } from 'react'
import { Minus, ArrowUpRight, Loader2 } from 'lucide-react'
import Image from 'next/image'
import { supabase } from '../supabase/supabaseClient'
import { useRouter } from 'next/router'

/* ============================================================
   ChatWidget — POST SSE for /api/rag/answer/stream
   (Keep previous chat message structure/layout)

   ✅ Key change (per your last requirement):
   - key info ONLY displays the "content" inside payload
     - redis payload: show message contents (no role / no tags)
     - rag payload: show preview (or content-like field if present)
     - answer_delta payload: show the delta text itself
   ============================================================ */

const logger = {
  info: (...a) => console.log('[ChatWidget]', ...a),
  warn: (...a) => console.warn('[ChatWidget]', ...a),
  error: (...a) => console.error('[ChatWidget]', ...a),
}

/* ───────── minimal sanitizer ───────── */
const sanitizeHtml = (html) =>
  String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'")

/* ───────── linkify plain URLs (for non-HTML answers) ───────── */
const URL_RE = /\bhttps?:\/\/[^\s<]+/gi

function splitTrailingPunct(url) {
  // Avoid including trailing punctuation in the link
  // Include both ASCII and common CJK punctuation
  const m = url.match(/^(.*?)([)\].,!?:;。，“”，！？、》》】】]+)?$/)
  return { href: m?.[1] || url, tail: m?.[2] || '' }
}

function renderTextWithLinks(text) {
  const s = String(text || '')
  const out = []
  let last = 0

  s.replace(URL_RE, (match, offset) => {
    const idx = Number(offset)
    if (idx > last) out.push(s.slice(last, idx))

    const { href, tail } = splitTrailingPunct(match)
    out.push(
      <a
        key={`${idx}-${href}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="chat-link"
      >
        {href}
      </a>
    )
    if (tail) out.push(tail)

    last = idx + match.length
    return match
  })

  if (last < s.length) out.push(s.slice(last))
  return out
}

const SESSION_TTL_MS = 15 * 60 * 1000
const UPLOAD_BUCKET = 'chat-uploads'
const UPLOAD_TTL_MS = 2 * 60 * 1000
const storageSafeGet = (key) => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch (err) {
    logger.warn('localStorage get failed', err)
    return null
  }
}

const storageSafeSet = (key, value) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch (err) {
    logger.warn('localStorage set failed', err)
  }
}

const migrateSessionStorageValue = (key) => {
  if (typeof window === 'undefined') return null
  try {
    const legacy = window.sessionStorage.getItem(key)
    if (legacy != null) storageSafeSet(key, legacy)
    return legacy
  } catch {
    return null
  }
}

const readPersistedJson = (key) => {
  const raw = storageSafeGet(key)
  if (raw != null) return safeJsonParse(raw)
  const legacy = migrateSessionStorageValue(key)
  return legacy != null ? safeJsonParse(legacy) : null
}

const isSessionFresh = () => {
  const lastActive = Number(storageSafeGet('chatSessionLastActive') || 0)
  return Number.isFinite(lastActive) && Date.now() - lastActive < SESSION_TTL_MS
}

/* Convert plain guideline text into clickable links */
function formatGuideText(text) {
  if (text.startsWith('Need a hand?')) {
    return (
      'Need a hand?<br />Sections → '
      + '<a href="/#about-section">About Me</a> | '
      + '<a href="/#works-section">Projects</a> | '
      + '<a href="/blog">Tech Blogs</a> | '
      + '<a href="/#resume-section">Experience</a>'
    )
  }
  if (text.startsWith('导航：')) {
    return (
      '导航：'
      + '<a href="/#about-section">关于我</a>｜'
      + '<a href="/#resume-section">经历</a>｜'
      + '<a href="/#works-section">项目</a>｜'
      + '<a href="/blog">技术博客</a>｜'
      + '<a href="/#contact-section">联系我</a>'
    )
  }
  return text
}

/** Ensure there's a root container for the chat widget */
const ensureRoot = () => {
  let el = document.getElementById('__chat_widget_root')
  if (!el) {
    el = document.createElement('div')
    el.id = '__chat_widget_root'
    document.body.appendChild(el)
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '0',
      right: '0',
      zIndex: '2147483647',
      pointerEvents: 'auto',
    })
  }
  return el
}

/** Fetch with timeout */
async function fetchWithTimeout(resource, options = {}, timeoutMs = 20000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(resource, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(id)
  }
}

/** UUID generator */
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
    ).toString(16)
  )
}

function safeJsonParse(s) {
  try { return JSON.parse(s) } catch { return null }
}

function compactText(s, max = 220) {
  if (s == null) return ''
  const t = String(s)
  return t.length > max ? t.slice(0, max) + '…' : t
}

function safeShort(s, max) {
  return compactText(String(s ?? ''), max).replace(/\s+/g, ' ').trim()
}

/* ---------- RAG endpoint helpers ---------- */

function normalizeRagBaseUrl(raw) {
  if (!raw) return ''
  const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  u.hash = ''
  u.search = ''
  u.pathname = u.pathname.replace(/\/api\/rag\/answer\/stream\/?$/, '/api/rag/answer')
  if (!/\/api\/rag\/answer\/?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/$/, '') + '/api/rag/answer'
  }
  return u.toString().replace(/\/$/, '')
}

function ragStreamUrl(ragBaseUrl) {
  const u = new URL(ragBaseUrl, window.location.origin)
  u.pathname = u.pathname.replace(/\/api\/rag\/answer\/?$/, '/api/rag/answer/stream')
  return u.toString()
}

async function resolveRagEndpoint() {
  const primaryRaw = process.env.NEXT_PUBLIC_ASSIST_API || process.env.NEXT_PUBLIC_RAG_API || ''
  const primary = primaryRaw ? normalizeRagBaseUrl(primaryRaw) : ''
  const fallback = '/api/rag/answer'

  const candidates = []
  if (primary) candidates.push(primary)
  candidates.push(fallback)

  for (const ep of candidates) {
    try {
      const u = new URL(ep, window.location.origin)
      const healthUrl = new URL('/health', u.origin).toString()
      const res = await fetchWithTimeout(healthUrl, { method: 'GET' }, 3000)
      if (res.ok) return u.toString().replace(/\/$/, '')
    } catch (e) {
      logger.warn('Health probe failed:', e?.message || e)
    }
  }
  return candidates[0]
}

/* ---------- SSE parsing (POST fetch stream) ---------- */

function parseSSEBlock(block) {
  const lines = block.split(/\r?\n/)
  let event = 'message'
  const dataLines = []
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  return { event, data: dataLines.join('\n') }
}

async function postSSE(url, body, { onEvent, signal }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    mode: 'cors',
    signal,
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`SSE HTTP ${res.status} ${res.statusText}${t ? ' — ' + t.slice(0, 160) : ''}`)
  }
  if (!res.body) throw new Error('ReadableStream not supported')

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
      const evt = parseSSEBlock(raw)
      if (evt?.data != null) onEvent?.(evt)
    }
  }
}

/* ============================================================
   ✅ Key info = ONLY payload "content" (or content-like field)
   - redis: payload is [{content, role}, ...] -> show content only
   - rag: payload is [{preview, ...}, ...] -> show preview (content-like)
   - answer_delta: payload is string delta -> show delta
   - start: no content -> show ts only (small)
   ============================================================ */
function summarizePayloadContentOnly(stage, payload, meta) {
  if (stage === 'start') {
    const ts = payload?.ts
    return ts ? `ts=${ts}` : ''
  }

  if (stage === 'redis') {
    const arr = Array.isArray(payload) ? payload : []
    // show last few messages' content (most relevant)
    const last = arr.slice(-4).map((m) => safeShort(m?.content, 50)).filter(Boolean)
    return last.join('  ·  ')
  }

  if (stage === 'rag') {
    const arr = Array.isArray(payload) ? payload : []
    if (!arr.length) return ''
    // show top hit preview as "content"
    const top = arr[0] || {}
    const preview = top?.preview
    const contentLike = top?.content
    const text = preview ?? contentLike ?? ''
    return safeShort(text, 160)
  }

  if (stage === 'answer_delta') {
    const delta = typeof payload === 'string' ? payload : ''
    // show a little rolling delta (or fallback to buf len)
    if (delta) return safeShort(delta, 80)
    const bufLen = typeof meta?.answerLen === 'number' ? meta.answerLen : null
    return bufLen != null ? `bufLen=${bufLen}` : ''
  }

  // generic fallback: try to pick "content"/"preview", else stringify short
  if (payload && typeof payload === 'object') {
    const maybe = payload?.content ?? payload?.preview
    if (maybe) return safeShort(maybe, 160)
  }
  try {
    return safeShort(JSON.stringify(payload), 160)
  } catch {
    return safeShort(String(payload), 160)
  }
}

function formatStageTitle(stage, message) {
  const msg = typeof message === 'string' ? message.trim() : ''
  if (msg) return msg

  const label = typeof stage === 'string' ? stage.replace(/_/g, ' ').trim() : ''
  if (!label) return 'Stage'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/* ---------- UI bits ---------- */

function TypingIndicator() {
  return (
    <div className="typing">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
      <style jsx>{`
        .typing { display:flex; gap:6px; align-items:center; padding: 2px 0; }
        .dot {
          width:6px; height:6px; border-radius:999px;
          background: rgba(107,114,128,0.85);
          animation: bounce 1s infinite;
        }
        .dot:nth-child(2){ animation-delay: .15s }
        .dot:nth-child(3){ animation-delay: .3s }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: .55 }
          40% { transform: translateY(-4px); opacity: 1 }
        }
        @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
      `}</style>
    </div>
  )
}

function StreamingCursor() {
  return (
    <span className="blinking-cursor">
      <style jsx>{`
        .blinking-cursor {
          display:inline-block;
          width: 8px;
          height: 14px;
          margin-left: 3px;
          background: currentColor;
          opacity: .45;
          animation: blink 1s step-end infinite;
          transform: translateY(2px);
          border-radius: 2px;
        }
        @keyframes blink { 50% { opacity: 0 } }
        @media (prefers-reduced-motion: reduce) {
          .blinking-cursor { animation: none; opacity: .35; }
        }
      `}</style>
    </span>
  )
}

function Overlay({ onClick }) {
  return (
    <div
      className="fixed inset-0 z-[2147483646] bg-gray-900/40 backdrop-blur-sm transition-opacity sm:hidden"
      onClick={onClick}
    />
  )
}

/**
 * StageToast
 * - Row1: spinner + stage (horizontal)
 * - Row2: key info shows payload "content" only (clamped)
 * - Spinner: rotate + subtle pulse
 * - Payload content: gradient wave animation
 */
function StageToast({ step }) {
  if (!step) return null

  return (
    <div key={step.id} className="stage-toast mb-2">
      <div className="stage-card">
        <div className="row1">
          <span className="spinnerWrap" aria-hidden="true">
            <Loader2 className="spinnerIcon" />
          </span>
          <div className="stage-text">{step.title}</div>
        </div>

        <div className="row2">
          <span className="key-label">key info:</span>
          <span className="key-value">{step.keyInfo}</span>
        </div>

        <div className="bar" aria-hidden="true" />
      </div>

      <style jsx>{`
        .stage-toast { animation: stageIn 180ms ease-out; }

        .stage-card{
          position: relative;
          border-radius: 12px;
          border: 1px solid rgba(229,231,235,0.9);
          background: rgba(248,250,252,0.92);
          box-shadow: 0 6px 18px rgba(15,23,42,0.06);
          padding: 12px 14px 14px;
          max-height: 92px;
          overflow: hidden;
        }
        :global(.dark) .stage-card{
          border-color: rgba(55,65,81,0.7);
          background: rgba(15,23,42,0.55);
          box-shadow: 0 8px 22px rgba(0,0,0,0.25);
        }

        .row1{
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .spinnerWrap{
          width: 18px;
          height: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          filter: drop-shadow(0 2px 6px rgba(15,23,42,0.16));
          animation: pulseSoft 1.2s ease-in-out infinite;
        }
        .spinnerIcon{
          width: 18px;
          height: 18px;
          color: rgba(75,85,99,0.95);
          animation: spinFast 0.75s linear infinite;
        }
        :global(.dark) .spinnerIcon{
          color: rgba(226,232,240,0.85);
          filter: drop-shadow(0 2px 8px rgba(0,0,0,0.35));
        }

        .stage-text{
          font-size: 18px;
          font-weight: 500;
          color: rgba(17,24,39,0.95);
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        :global(.dark) .stage-text{
          color: rgba(248,250,252,0.92);
        }

        .row2{
          margin-top: 8px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          min-width: 0;
        }
        .key-label{
          font-size: 12px;
          color: rgba(100,116,139,0.9);
          flex-shrink: 0;
          line-height: 1.2;
        }
        :global(.dark) .key-label{
          color: rgba(226,232,240,0.7);
        }

        .key-value{
          font-size: 12px;
          line-height: 1.25;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          min-width: 0;

          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          white-space: pre-wrap;
          word-break: break-word;

          /* animated gradient wave */
          color: transparent;
          background-image: linear-gradient(
            90deg,
            rgba(30,41,59,0.35) 0%,
            rgba(59,130,246,0.95) 35%,
            rgba(236,72,153,0.85) 55%,
            rgba(16,185,129,0.85) 75%,
            rgba(30,41,59,0.35) 100%
          );
          background-size: 220% 100%;
          background-position: 0% 50%;
          -webkit-background-clip: text;
          background-clip: text;
          animation: waveText 1.6s ease-in-out infinite;
        }
        :global(.dark) .key-value{
          background-image: linear-gradient(
            90deg,
            rgba(226,232,240,0.35) 0%,
            rgba(96,165,250,0.95) 35%,
            rgba(244,114,182,0.9) 55%,
            rgba(52,211,153,0.85) 75%,
            rgba(226,232,240,0.35) 100%
          );
        }

        .bar{
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 10px;
          height: 2px;
          border-radius: 999px;
          overflow: hidden;
          opacity: 0.55;
          background: rgba(148,163,184,0.25);
        }
        .bar::before{
          content:'';
          position:absolute;
          left:-40%;
          top:0;
          height:100%;
          width:40%;
          border-radius: 999px;
          background: rgba(100,116,139,0.7);
          animation: indeterminate 1.2s ease-in-out infinite;
        }

        @keyframes stageIn{
          from { opacity: 0; transform: translateY(6px) scale(0.99); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes spinFast{
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes pulseSoft{
          0%,100% { transform: scale(1); opacity: 0.95; }
          50%     { transform: scale(1.06); opacity: 1; }
        }

        @keyframes waveText{
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        @keyframes indeterminate{
          0%   { left: -40%; }
          50%  { left: 60%; }
          100% { left: 120%; }
        }

        @media (prefers-reduced-motion: reduce){
          .stage-toast{ animation:none; }
          .spinnerWrap{ animation:none; }
          .spinnerIcon{ animation:none; }
          .key-value{
            animation:none;
            color: rgba(30,41,59,0.85);
            background: none;
            -webkit-background-clip: initial;
            background-clip: initial;
          }
          :global(.dark) .key-value{ color: rgba(226,232,240,0.8); }
          .bar::before{ animation:none; left:0; width:35%; opacity:0.5; }
        }
      `}</style>
    </div>
  )
}

/* ---------- Chat window ---------- */

function ChatWindow({ onMinimize, onDragStart }) {
  const [messages, setMessages] = useState(() => {
    const saved = readPersistedJson('chatMessages')
    return Array.isArray(saved) ? saved : []
  })

  const [sessionId] = useState(() => {
    let id = storageSafeGet('chatSessionId') || migrateSessionStorageValue('chatSessionId')
    if (!id) {
      id = generateUUID()
      storageSafeSet('chatSessionId', id)
    }
    return id
  })

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [endpoint, setEndpoint] = useState('') // optional debug

  const scrollRef = useRef(null)
  const ragEndpointRef = useRef(null)
  const abortRef = useRef(null)
  const bucketReadyRef = useRef(false)
  const uploadTimersRef = useRef([])
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ id: generateUUID(), role: 'assistant', content: 'Hi! How can I help you today?' }])
    }
  }, [])

  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = 'auto'
    return () => { root.style.pointerEvents = 'none' }
  }, [])

  useEffect(() => {
    storageSafeSet('chatMessages', JSON.stringify(messages))
    storageSafeSet('chatSessionLastActive', String(Date.now()))
  }, [messages])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const ep = await resolveRagEndpoint()
      if (!mounted) return
      ragEndpointRef.current = ep
      setEndpoint(ep)

      try {
        const u = new URL(ep, window.location.origin)
        const res = await fetchWithTimeout(new URL('/health', u.origin), { method: 'GET' }, 3000)
        if (!res.ok) logger.warn('Health check non-OK:', res.status, res.statusText)
      } catch (e) {
        logger.warn('Health check error:', e?.message || e)
      }
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => () => {
    if (abortRef.current) {
      try { abortRef.current.abort() } catch {}
      abortRef.current = null
    }
    uploadTimersRef.current.forEach((timerId) => clearTimeout(timerId))
  }, [])

  const ensureBucketExists = async () => {
    if (bucketReadyRef.current) return true

    const { error, data } = await supabase.storage.getBucket(UPLOAD_BUCKET)

    if (error && error?.message?.toLowerCase().includes('not found')) {
      const { error: createError } = await supabase.storage.createBucket(UPLOAD_BUCKET, {
        public: false,
        fileSizeLimit: 20 * 1024 * 1024,
      })

      if (createError) {
        logger.error('Failed to create bucket', createError)
        return false
      }
    } else if (error) {
      logger.error('Failed to fetch bucket', error)
      return false
    }

    if (!data) {
      const { error: createError } = await supabase.storage.createBucket(UPLOAD_BUCKET, {
        public: false,
        fileSizeLimit: 20 * 1024 * 1024,
      })

      if (createError) {
        logger.error('Bucket creation failed', createError)
        return false
      }
    }

    bucketReadyRef.current = true
    return true
  }

  const scheduleAutoDelete = (filePath) => {
    const timerId = setTimeout(async () => {
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove([filePath])
      if (error) logger.warn('Failed to auto-delete upload', error)
    }, UPLOAD_TTL_MS)

    uploadTimersRef.current.push(timerId)
  }

  const handleFileUpload = async (file) => {
    if (!file) return
    setUploadError('')
    setUploading(true)

    const bucketReady = await ensureBucketExists()
    if (!bucketReady) {
      setUploadError('Unable to access upload storage right now.')
      setUploading(false)
      return
    }

    const uniquePath = `${sessionId || generateUUID()}/${Date.now()}-${file.name}`

    const { error: uploadErrorResp } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .upload(uniquePath, file, { upsert: false })

    if (uploadErrorResp) {
      logger.error('Upload failed', uploadErrorResp)
      setUploadError('Upload failed. Please try again.')
      setUploading(false)
      return
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .createSignedUrl(uniquePath, Math.floor(UPLOAD_TTL_MS / 1000))

    if (signedUrlError || !signedUrlData?.signedUrl) {
      logger.error('Signed URL creation failed', signedUrlError)
      setUploadError('Could not create download link.')
      setUploading(false)
      return
    }

    setMessages((prev) => [
      ...prev,
      {
        id: generateUUID(),
        role: 'user',
        content: `Uploaded file: ${file.name}\n${signedUrlData.signedUrl}`,
      },
    ])

    scheduleAutoDelete(uniquePath)
    setUploading(false)
  }

  const setStage = (assistantId, stage, obj = {}, meta) => {
    const title = formatStageTitle(stage, obj?.message)
    const keyInfo = summarizePayloadContentOnly(stage, obj?.payload, meta)

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
            ...m,
            thinkingNow: {
              id: `${stage}-${Date.now()}`,
              stage,
              title,
              keyInfo, // ✅ content-only
              ts: Date.now(),
            },
          }
          : m
      )
    )
  }

  const clearStage = (assistantId) => {
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, thinkingNow: null } : m)))
  }

  const finalizeAssistant = (assistantId, rawFinal, onFinal) => {
    const processed = formatGuideText(rawFinal || '')
    const looksHtml = /<\w+[^>]*>|<\/\w+>/.test(processed)
    const finalContent = looksHtml ? sanitizeHtml(processed) : processed

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? { ...m, content: finalContent, isHtml: looksHtml, streaming: false, thinkingNow: null }
          : m
      )
    )

    onFinal?.(finalContent)
  }

  const startRagSSE = async ({ text, assistantId, onFinal }) => {
    const base = ragEndpointRef.current || (await resolveRagEndpoint())
    const streamUrl = ragStreamUrl(base)

    const controller = new AbortController()
    abortRef.current = controller

    let answerBuf = ''
    let finalized = false

    setStage(assistantId, 'start', { payload: { ts: Date.now() } })

    await postSSE(
      streamUrl,
      { question: text, sessionId },
      {
        signal: controller.signal,
        onEvent: (evt) => {
          const obj = safeJsonParse(evt.data) || {}
          const stage = obj.stage || evt.event || 'message'

          if (stage === 'answer_delta') {
            const delta = typeof obj.payload === 'string' ? obj.payload : ''
            if (delta) {
              answerBuf += delta
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: answerBuf, streaming: true } : m))
              )
            }
            setStage(assistantId, 'answer_delta', obj, { answerLen: answerBuf.length })
            return
          }

          if (stage === 'answer_final') {
            finalized = true
            clearStage(assistantId)
            finalizeAssistant(assistantId, typeof obj.payload === 'string' ? obj.payload : answerBuf, onFinal)
            return
          }

          if (stage !== 'answer_delta' && stage !== 'answer_final') {
            setStage(assistantId, stage, obj)
          }
        },
      }
    )

    if (!finalized && answerBuf) {
      clearStage(assistantId)
      finalizeAssistant(assistantId, answerBuf, onFinal)
    }
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    if (abortRef.current) {
      try { abortRef.current.abort() } catch {}
      abortRef.current = null
    }

    setLoading(true)
    setMessages((prev) => [...prev, { id: generateUUID(), role: 'user', content: text }])
    setInput('')

    const assistantId = generateUUID()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', streaming: true, thinkingNow: null },
    ])

    const finalizeAndPersist = async (finalAnswer) => {
      try {
        await supabase.from('Chat').insert([{ question: text, answer: finalAnswer }])
      } catch (dbErr) {
        logger.warn('Supabase insert failed', dbErr)
      }
      setLoading(false)
    }

    try {
      await startRagSSE({ text, assistantId, onFinal: finalizeAndPersist })
    } catch (err) {
      logger.error('SSE failed:', err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: '⚠️ Failed to contact assistant.', streaming: false, thinkingNow: null }
            : m
        )
      )
      setLoading(false)
    }
  }

  return (
    <div className="bot-container relative mb-6 flex flex-col h-[80vh] w-screen md:w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900 dark:ring-gray-700">
      <header
        className="bot-header flex items-center justify-between border-b border-gray-200 px-2 py-2 dark:border-gray-700"
        onMouseDown={onDragStart}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-100">
          <img src="/assets/images/chatbot_pot_thinking.gif" alt="Chat Bot" className="w-6 h-6" />
          Mr.Pot
        </div>
        <button
          type="button"
          aria-label="Minimize chat"
          className="shrink-button rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={onMinimize}
        >
          <Minus className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="bot-messages flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            {m.role === 'assistant' && m.isHtml ? (
              <div
                className="bot-message max-w-[320px] md:max-w-[420px] rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-900 shadow border border-gray-200/80 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-100"
                dangerouslySetInnerHTML={{ __html: m.content }}
              />
            ) : (
              <div
                className={
                  m.role === 'user'
                    ? 'user-message max-w-[320px] md:max-w-[420px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white shadow border border-blue-700/80'
                    : 'bot-message max-w-[320px] md:max-w-[420px] rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-900 shadow border border-gray-200/80 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-100'
                }
              >
                {m.role === 'assistant' && m.streaming && m.thinkingNow ? (
                  <StageToast step={m.thinkingNow} />
                ) : null}

                {m.streaming
                  ? m.content === ''
                    ? <TypingIndicator />
                    : <><span>{renderTextWithLinks(m.content)}</span><StreamingCursor /></>
                  : renderTextWithLinks(m.content)}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={sendMessage} className="border-t border-gray-200 bg-white px-2 py-3">
        <div className="bot-actions flex items-center gap-3 border border-gray-300 bg-white px-3 py-2">
          <button
            type="button"
            aria-label="Upload file"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="upload-button h-10 w-10 flex items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : '+'}
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder=""
            rows={1}
            className="bot-input flex-1 resize-none bg-transparent px-2 text-sm text-gray-900 outline-none"
            aria-label="Message input"
          />

          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="send-button h-10 w-10 flex items-center justify-center rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => {
              handleFileUpload(e.target.files?.[0])
              e.target.value = ''
            }}
            className="hidden"
          />
        </div>
        {uploadError ? <p className="mt-2 text-xs text-red-600">{uploadError}</p> : null}
      </form>

      <style jsx global>{`
        .bot-message, .user-message {
          overflow-wrap: anywhere;
          word-break: break-word;
          white-space: pre-wrap;
        }

        .bot-message h1,
        .bot-message h2,
        .bot-message h3 {
          font-size: 14px !important;
          line-height: 1.35 !important;
          font-weight: 650 !important;
          margin: 8px 0 6px !important;
        }
        .bot-message h4,
        .bot-message h5,
        .bot-message h6 {
          font-size: 13px !important;
          line-height: 1.35 !important;
          font-weight: 650 !important;
          margin: 6px 0 5px !important;
        }
        .bot-message p { margin: 6px 0 !important; }
        .bot-message ul, .bot-message ol { margin: 6px 0 !important; padding-left: 18px !important; }
        .bot-message li { margin: 4px 0 !important; }
        .bot-message a { word-break: break-all; }
        .bot-message a.chat-link {
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .bot-message a.chat-link:hover {
          opacity: 0.85;
        }

        .bot-message pre, .bot-message code {
          white-space: pre-wrap !important;
          overflow-wrap: anywhere !important;
          word-break: break-word !important;
        }
        .bot-message img, .bot-message video {
          max-width: 100% !important;
          height: auto !important;
        }
        .bot-message table {
          width: 100% !important;
          max-width: 100% !important;
          display: block !important;
          overflow-x: auto !important;
          border-collapse: collapse !important;
        }
      `}</style>
    </div>
  )
}

/** Minimized launcher button */
function LauncherButton({ onOpen, onDragStart }) {
  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = 'auto'
  }, [])

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseDown={onDragStart}
      className="launch-button relative flex items-center rounded-full mb-2 px-5 py-4 shadow-xl ring-1 ring-gray-200 backdrop-blur hover:shadow-2xl"
    >
      <span className="relative flex items-center justify-center rounded-full bg-blue-600" style={{ width: 60, height: 60 }}>
        <Image src="/assets/images/chatPot.png" alt="Chat Bot" width={48} height={48} priority />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white" />
      </span>
      <span className="ml-2 text-sm font-medium text-gray-900 dark:text-gray-100">Mr.Pot</span>
    </button>
  )
}

/** Main ChatWidget export */
export default function ChatWidget() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chatWidgetOffset')
      if (saved) return JSON.parse(saved)
    }
    return { x: 0, y: 0 }
  })

  const rootRef = useRef(null)
  const offsetRef = useRef(offset)
  const dragRef = useRef({ dragging: false })

  useEffect(() => {
    const el = ensureRoot()
    rootRef.current = el
    el.style.pointerEvents = 'auto'
    el.style.transform = `translate(${offset.x}px, ${offset.y}px)`
  }, [])

  useEffect(() => {
    offsetRef.current = offset
    if (rootRef.current) {
      rootRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`
      localStorage.setItem('chatWidgetOffset', JSON.stringify(offset))
    }
  }, [offset])

  useEffect(() => {
    if (!router?.isReady) return
    const openChatParam = router.query?.openChat
    if (!openChatParam) return

    if (router.pathname !== '/') {
      router.replace({ pathname: '/', query: { openChat: openChatParam } }, undefined, { shallow: true })
      return
    }

    setOpen(true)

    const { openChat, ...rest } = router.query || {}
    router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true })
  }, [router])

  const startDrag = (e) => {
    dragRef.current.dragging = false
    const point = e.touches ? e.touches[0] : e
    const startX = point.clientX
    const startY = point.clientY
    const { x, y } = offsetRef.current
    const moveEvent = e.touches ? 'touchmove' : 'mousemove'
    const upEvent = e.touches ? 'touchend' : 'mouseup'

    const onMove = (ev) => {
      const mp = ev.touches ? ev.touches[0] : ev
      const dx = mp.clientX - startX
      const dy = mp.clientY - startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.dragging = true
      setOffset({ x: x + dx, y: y + dy })
    }
    const onUp = () => {
      window.removeEventListener(moveEvent, onMove)
      window.removeEventListener(upEvent, onUp)
    }
    window.addEventListener(moveEvent, onMove)
    window.addEventListener(upEvent, onUp)
  }

  const handleOpen = () => {
    if (dragRef.current.dragging) {
      dragRef.current.dragging = false
      return
    }
    setOpen(true)
  }

  const container = rootRef.current || ensureRoot()
  rootRef.current = container
  if (!container) return null

  return createPortal(
    open ? (
      <Fragment>
        <Overlay onClick={() => setOpen(false)} />
        <ChatWindow onMinimize={() => setOpen(false)} onDragStart={startDrag} />
      </Fragment>
    ) : (
      <LauncherButton onOpen={handleOpen} onDragStart={startDrag} />
    ),
    container
  )
}
