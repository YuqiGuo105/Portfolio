'use client'

import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, Fragment } from 'react'
import { Minus, ArrowUpRight, Loader2 } from 'lucide-react'
import Image from 'next/image'
import { supabase } from '../supabase/supabaseClient'
import { useRouter } from 'next/router'

/* ============================================================
   ChatWidget — POST SSE for /api/rag/answer/stream
   - ChatGPT-like thinking stage (only current stage, fixed height)
   - Stage text is clamped (no bubble explosion)
   - Stage has smoother animation + indeterminate loading bar
   - When final answer arrives: hide thinking immediately, keep answer
   ============================================================ */

const logger = {
  info: (...a) => console.log('[ChatWidget]', ...a),
  warn: (...a) => console.warn('[ChatWidget]', ...a),
  error: (...a) => console.error('[ChatWidget]', ...a),
}

/* ───────── minimal sanitizer ───────── */
const sanitizeHtml = (html) =>
  html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'")

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

function safeJsonParse(s) {
  try { return JSON.parse(s) } catch { return null }
}

function compactText(s, max = 220) {
  if (!s) return ''
  const t = String(s)
  return t.length > max ? t.slice(0, max) + '…' : t
}

function summarizeStageDetail(stage, dataObj) {
  const msg = dataObj?.message ? String(dataObj.message) : ''
  const payload = dataObj?.payload

  if (stage === 'start') {
    const ts = payload?.ts ? `ts=${payload.ts}` : ''
    return compactText([msg, ts].filter(Boolean).join(' '))
  }

  if (stage === 'redis') {
    const n = Array.isArray(payload) ? payload.length : 0
    return compactText(`${msg}${msg ? ' — ' : ''}messages=${n}`)
  }

  if (stage === 'rag') {
    if (Array.isArray(payload) && payload.length) {
      const top = payload[0]
      const preview = top?.preview ? compactText(top.preview, 240) : ''
      const score = typeof top?.score === 'number' ? top.score.toFixed(3) : ''
      return compactText(`${msg}${msg ? ' — ' : ''}top1 score=${score}\n${preview}`, 280)
    }
    return compactText(msg || 'Retrieval')
  }

  if (stage === 'answer_delta') return 'Generating…'
  return compactText(msg || stage)
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
        @media (prefers-reduced-motion: reduce) {
          .dot { animation: none; }
        }
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
 * ChatGPT-like thinking stage
 * - Only current stage is shown (previous disappears)
 * - Fixed height
 * - Title 1 line ellipsis, detail clamped
 * - Smoother animation + indeterminate bar
 */
function StageToast({ step }) {
  if (!step) return null

  return (
    <div key={step.id} className="stage-toast mb-2">
      <div className="stage-inner flex items-start gap-2 rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/40">
        <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-gray-500" />

        <div className="min-w-0 flex-1">
          <div className="stage-title text-[13px] font-medium text-gray-800 dark:text-gray-100">
            {step.title}
          </div>
          {step.detail ? (
            <div className="stage-detail mt-0.5 text-[13px] text-gray-600/70 dark:text-gray-300/70">
              {step.detail}
            </div>
          ) : null}
        </div>

        <div className="stage-bar" aria-hidden="true" />
      </div>

      <style jsx>{`
        .stage-toast {
          animation: stageIn 180ms ease-out;
        }

        .stage-inner {
          position: relative;
          max-height: 76px;          /* fixed length container */
          overflow: hidden;
        }

        /* title: 1-line ellipsis */
        .stage-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          animation: textIn 180ms ease-out;
        }

        /* detail: clamp lines, keep newlines */
        .stage-detail {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;     /* max lines shown */
          overflow: hidden;
          white-space: pre-wrap;
          word-break: break-word;
          animation: textIn 220ms ease-out;
        }

        /* indeterminate loading bar */
        .stage-bar {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 8px;
          height: 2px;
          overflow: hidden;
          border-radius: 999px;
          opacity: 0.55;
          background: rgba(148,163,184,0.25);
        }
        .stage-bar::before {
          content: '';
          position: absolute;
          left: -40%;
          top: 0;
          height: 100%;
          width: 40%;
          border-radius: 999px;
          background: rgba(100,116,139,0.7);
          animation: indeterminate 1.2s ease-in-out infinite;
        }

        @keyframes stageIn {
          from { opacity: 0; transform: translateY(6px) scale(0.99); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes textIn {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes indeterminate {
          0%   { transform: translateX(0); left: -40%; }
          50%  { transform: translateX(0); left: 60%;  }
          100% { transform: translateX(0); left: 120%; }
        }

        @media (prefers-reduced-motion: reduce) {
          .stage-toast, .stage-title, .stage-detail { animation: none; }
          .stage-bar::before { animation: none; left: 0; width: 35%; opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

/* ---------- Chat window ---------- */

function ChatWindow({ onMinimize, onDragStart }) {
  const [messages, setMessages] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('chatMessages')
      return saved ? JSON.parse(saved) : []
    }
    return []
  })

  const [sessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      let id = sessionStorage.getItem('chatSessionId')
      if (!id) {
        id = generateUUID()
        sessionStorage.setItem('chatSessionId', id)
      }
      return id
    }
    return ''
  })

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [endpoint, setEndpoint] = useState('') // optional debug

  const scrollRef = useRef(null)
  const ragEndpointRef = useRef(null)
  const abortRef = useRef(null)

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
    sessionStorage.setItem('chatMessages', JSON.stringify(messages))
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
  }, [])

  const setStage = (assistantId, stage, obj) => {
    const stageTitleMap = {
      start: 'Init',
      redis: 'History',
      rag: 'Retrieval',
      answer_delta: 'Generating',
    }
    const title = stageTitleMap[stage] || stage
    const detail = summarizeStageDetail(stage, obj)

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
            ...m,
            thinkingNow: {
              id: `${stage}-${Date.now()}`, // stage change triggers remount animation
              stage,
              title,
              detail,
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

    // Final: show answer only (no logic chain)
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

    setStage(assistantId, 'start', { message: 'Init', payload: { ts: Date.now() } })

    await postSSE(
      streamUrl,
      { question: text, sessionId },
      {
        signal: controller.signal,
        onEvent: (evt) => {
          const obj = safeJsonParse(evt.data) || {}
          const stage = obj.stage || evt.event || 'message'

          if (stage === 'answer_delta') {
            setStage(assistantId, 'answer_delta', obj)
            const delta = typeof obj.payload === 'string' ? obj.payload : ''
            if (delta) {
              answerBuf += delta
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: answerBuf, streaming: true } : m))
              )
            }
            return
          }

          if (stage === 'answer_final') {
            finalized = true
            clearStage(assistantId)
            finalizeAssistant(assistantId, typeof obj.payload === 'string' ? obj.payload : answerBuf, onFinal)
            return
          }

          if (stage === 'start' || stage === 'redis' || stage === 'rag') {
            setStage(assistantId, stage, obj)
          }
        },
      }
    )

    // If stream ends without answer_final, best-effort finalize
    if (!finalized && answerBuf) {
      clearStage(assistantId)
      finalizeAssistant(assistantId, answerBuf, onFinal)
    }
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    // abort previous stream
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
                {/* Thinking stage: fixed height + clamped text */}
                {m.role === 'assistant' && m.streaming && m.thinkingNow ? (
                  <StageToast step={m.thinkingNow} />
                ) : null}

                {/* Answer stream */}
                {m.streaming
                  ? m.content === ''
                    ? <TypingIndicator />
                    : <><span>{m.content}</span><StreamingCursor /></>
                  : m.content}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={sendMessage} className="border-t border-gray-200 bg-gray-50/60 px-2 py-2">
        <div className="bot-actions flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="bot-input h-10 flex-1 rounded-md border-transparent bg-transparent px-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="send-button rounded-md bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
          </button>
        </div>
      </form>
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

  // Auto-open when URL has ?openChat=1
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
