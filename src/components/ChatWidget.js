'use client'

import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, Fragment } from 'react'
import { Minus, ArrowUpRight, Loader2 } from 'lucide-react'
import Image from 'next/image'
import { supabase } from '../supabase/supabaseClient'
import { useRouter } from 'next/router'

/* ============================================================
   ChatWidget — streaming-ready for new backend API (Aug 2025)
   - English comments only
   - Uses SSE streaming via GET /api/chat/stream (EventSource)
   - Falls back to JSON POST /api/chat on failure
   - Health check against /health (updated; was /healthz)
   - Structured logger + retries for non-streaming fallback
   - Stores final Q&A to Supabase chat_history
   ============================================================ */

/* ───────── structured logger ───────── */
const logger = {
  info: (...a) => console.log('[ChatWidget]', ...a),
  warn: (...a) => console.warn('[ChatWidget]', ...a),
  error: (...a) => console.error('[ChatWidget]', ...a),
  time: (label) => console.time(`[ChatWidget] ${label}`),
  timeEnd: (label) => console.timeEnd(`[ChatWidget] ${label}`),
}

/* ───────── minimal sanitizer ───────── */
const sanitizeHtml = (html) =>
  html
    // strip <script>
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // strip inline handlers like onclick="..."
    .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // neutralize javascript: URLs
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

/** Small helper: sleep */
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

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

/** Normalize to /api/chat if caller passed an origin or arbitrary path */
function normalizeChatUrl(raw) {
  if (!raw) return ''
  const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  if (!/\/api\/chat\/?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/$/, '') + '/api/chat'
  }
  return u.toString().replace(/\/$/, '')
}

/** Build the streaming GET URL from a base /api/chat URL */
function toStreamUrl(chatUrl, query) {
  const base = new URL(chatUrl, window.location.origin)
  base.pathname = base.pathname.replace(/\/api\/chat\/?$/, '/api/chat/stream')
  const url = new URL(base.toString())
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }
  return url.toString()
}

/** Resolve the chat endpoint based on env + health check.
 *  - If NEXT_PUBLIC_ASSIST_API is set, normalize to /api/chat and probe ORIGIN:/health
 *  - Fallback to relative '/api/chat'
 */
async function resolveChatEndpoint() {
  const primaryRaw = process.env.NEXT_PUBLIC_ASSIST_API || ''
  const primary = primaryRaw ? normalizeChatUrl(primaryRaw) : ''
  const fallback = '/api/chat'

  const candidates = []
  if (primary) candidates.push(primary)
  candidates.push(fallback)

  for (const ep of candidates) {
    try {
      const u = new URL(ep, window.location.origin)
      const healthUrl = new URL('/health', u.origin).toString() // updated: /health
      const res = await fetchWithTimeout(healthUrl, { method: 'GET' }, 3000)
      if (res.ok) return u.toString().replace(/\/$/, '')
    } catch (e) {
      logger.warn('Health probe failed:', e?.message || e)
    }
  }
  return candidates[0]
}

/** UUID generator */
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
    ).toString(16)
  )
}

/** Non-streaming POST with tiny retry */
async function postOnce(url, body, maxRetries = 1) {
  let attempt = 0
  while (attempt <= maxRetries) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          mode: 'cors',
        },
        30000
      )
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? ' — ' + txt.slice(0, 200) : ''}`)
      }
      const ct = res.headers.get('content-type') || ''
      if (!/application\/json/i.test(ct)) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Expected JSON, got ${ct || 'unknown'}${txt ? ' — ' + txt.slice(0, 120) : ''}`)
      }
      return await res.json()
    } catch (e) {
      if (attempt === maxRetries) throw e
      await delay(600 * (attempt + 1))
      attempt++
    }
  }
}

/** Typing animation component */
function TypingIndicator() {
  return (
    <div className="typing">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  )
}

/** Blinking cursor shown during streaming */
function StreamingCursor() {
  return <span className="blinking-cursor" />
}

const stageBlueprint = [
  { key: 'start', label: 'Start' },
  { key: 'redis', label: 'History' },
  { key: 'rag', label: 'Retrieval' },
  { key: 'answer', label: 'Answer' },
]

function StageTimeline({ stages }) {
  return (
    <div className="mb-3 text-[11px] text-gray-400">
      <div className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">
        <span className="relative inline-flex h-3 w-3 items-center justify-center">
          <span className="absolute inline-flex h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-transparent" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gray-400" />
        </span>
        Logic chain
      </div>
      <div className="flex flex-col gap-1 pl-4">
        {stages.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className="relative h-2.5 w-2.5">
              {s.status === 'active' && (
                <span className="absolute inset-[-6px] animate-ping rounded-full border border-blue-300/70" />
              )}
              <span
                className={`relative block h-2.5 w-2.5 rounded-full border transition-colors ${
                  s.status === 'done'
                    ? 'border-emerald-500 bg-emerald-500'
                    : s.status === 'active'
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-gray-300 bg-gray-200'
                }`}
              />
            </div>
            <div
              className={`flex items-center gap-2 text-[11px] transition-colors ${
                s.status === 'done'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : s.status === 'active'
                    ? 'text-blue-600 dark:text-blue-300'
                    : 'text-gray-400'
              }`}
            >
              <span className="font-medium">{s.label}</span>
              {s.detail ? <span className="text-[10px] text-gray-400">{s.detail}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Dark backdrop overlay */
function Overlay({ onClick }) {
  return (
    <div
      className="fixed inset-0 z-[2147483646] bg-gray-900/40 backdrop-blur-sm transition-opacity sm:hidden"
      onClick={onClick}
    />
  )
}

/** Chat window UI */
function ChatWindow({ onMinimize, onDragStart }) {
  const [messages, setMessages] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('chatMessages')
      return saved ? JSON.parse(saved) : []
    }
    return []
  })

  const [stages, setStages] = useState(() => stageBlueprint.map((s) => ({ ...s, status: 'idle', detail: '' })))

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
  const [endpoint, setEndpoint] = useState('')
  const scrollRef = useRef(null)
  const chatEndpointRef = useRef(null)
  const esRef = useRef(null) // active EventSource

  // Smaller latency path: let backend decide caching (false means allow cache)
  const SKIP_CACHE_DEFAULT = false

  const resetTimeline = () => setStages(stageBlueprint.map((s) => ({ ...s, status: 'idle', detail: '' })))
  const markStage = (key, detail) => {
    const index = stageBlueprint.findIndex((s) => s.key === key)
    if (index === -1) return
    setStages((prev) =>
      prev.map((s, i) => ({
        ...s,
        status: i < index ? 'done' : i === index ? 'active' : 'idle',
        detail: s.key === key && detail ? detail : s.detail,
      }))
    )
  }
  const completeTimeline = () => setStages((prev) => prev.map((s) => ({ ...s, status: s.status === 'idle' ? 'idle' : 'done' })))

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        { id: generateUUID(), role: 'assistant', content: 'Hi! How can I help you today?' },
      ])
    }
  }, [])

  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = 'auto'
    return () => {
      root.style.pointerEvents = 'none'
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem('chatMessages', JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  // Resolve endpoint and check health on mount
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const ep = await resolveChatEndpoint()
      if (!mounted) return
      chatEndpointRef.current = ep
      setEndpoint(ep)

      try {
        const u = new URL(ep, window.location.origin)
        const res = await fetchWithTimeout(new URL('/health', u.origin), { method: 'GET' }, 3000)
        if (!res.ok) logger.warn('Health check non-OK:', res.status, res.statusText)
      } catch (e) {
        logger.warn('Health check error:', e?.message || e)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // Clean up the active stream when minimizing/unmounting
  useEffect(() => () => {
    if (esRef.current) {
      try { esRef.current.close() } catch {}
      esRef.current = null
    }
  }, [])

  const parseEventData = (ev) => {
    if (!ev?.data) return {}
    try {
      return JSON.parse(ev.data)
    } catch {
      return { payload: ev.data }
    }
  }

  const startSSE = ({ text, onFinal }) => {
    // Build GET /api/chat/stream?message=...&skip_cache=...
    const base = chatEndpointRef.current || '/api/chat'
    const streamUrl = toStreamUrl(base, {
      message: text,
      skip_cache: SKIP_CACHE_DEFAULT ? 'true' : 'false',
      // Note: GET version on server ignores session_id; caching is cross-user
    })

    const es = new EventSource(streamUrl)
    esRef.current = es

    resetTimeline()
    markStage('start', 'Init')

    // create placeholder assistant message
    const assistantId = generateUUID()
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', streaming: true }])

    let buffer = ''

    const finalize = () => {
      buffer = formatGuideText(buffer)
      // decide if buffer looks like HTML
      const looksHtml = /<\w+[^>]*>|<\/\w+>/.test(buffer)
      const finalContent = looksHtml ? sanitizeHtml(buffer) : buffer
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId ? { ...m, content: finalContent, isHtml: looksHtml, streaming: false } : m
      )))
      onFinal?.(finalContent)
    }

    es.addEventListener('meta', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}')
      } catch {}
    })

    es.addEventListener('start', (ev) => {
      const data = parseEventData(ev)
      markStage('start', data?.message || 'Init')
    })

    es.addEventListener('redis', (ev) => {
      const data = parseEventData(ev)
      markStage('redis', data?.message || 'History')
    })

    es.addEventListener('rag', (ev) => {
      const data = parseEventData(ev)
      markStage('rag', data?.message || 'Retrieval')
    })

    es.addEventListener('answer_final', (ev) => {
      const data = parseEventData(ev)
      const finalPayload = data?.payload ?? data?.delta ?? ''
      buffer = finalPayload || buffer
      completeTimeline()
      try { es.close() } catch {}
      if (esRef.current === es) esRef.current = null
      finalize()
    })

    es.addEventListener('answer_delta', (ev) => {
      const data = parseEventData(ev)
      const delta = data?.payload ?? data?.delta ?? ''
      if (!delta) return
      markStage('answer', data?.message || 'Generating')
      buffer += delta
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId ? { ...m, content: buffer, streaming: true } : m
      )))
    })

    es.addEventListener('message', (ev) => {
      // data should be a JSON like { delta: '...' } but also accept raw text
      let delta = ''
      try {
        const d = JSON.parse(ev.data)
        delta = d?.delta ?? ''
      } catch {
        delta = ev.data || ''
      }
      if (!delta) return
      markStage('answer', 'Generating')
      buffer += delta
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId ? { ...m, content: buffer, streaming: true } : m
      )))
    })

    es.addEventListener('done', () => {
      try { es.close() } catch {}
      if (esRef.current === es) esRef.current = null
      completeTimeline()
      finalize()
    })

    es.onerror = (err) => {
      try { es.close() } catch {}
      if (esRef.current === es) esRef.current = null
      // Mark streaming bubble as failed and fallback
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId ? { ...m, streaming: false } : m
      )))
      // Fallback to non-streaming POST
      fallbackJson({ text, assistantId, onFinal })
    }
  }

  const fallbackJson = async ({ text, assistantId, onFinal }) => {
    // POST /api/chat
    const base = chatEndpointRef.current || (await resolveChatEndpoint())
    const url = new URL(base, window.location.origin).toString()
    try {
      const payload = { message: text, session_id: sessionId, skip_cache: SKIP_CACHE_DEFAULT }
      const json = await postOnce(url, payload)
      const raw = json?.answer ?? ''
      const processed = formatGuideText(raw)
      const looksHtml = /<\w+[^>]*>|<\/\w+>/.test(processed)
      const finalContent = looksHtml ? sanitizeHtml(processed) : processed
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId ? { ...m, content: finalContent, isHtml: looksHtml, streaming: false } : m
      )))
      completeTimeline()
      onFinal?.(finalContent)
    } catch (err) {
      logger.error('Fallback POST failed:', err)
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId ? { ...m, content: '⚠️ Failed to contact assistant.', streaming: false } : m
      )))
      completeTimeline()
    }
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    // If a previous stream is open, close it
    if (esRef.current) {
      try { esRef.current.close() } catch {}
      esRef.current = null
    }

    resetTimeline()

    setLoading(true)
    setMessages((prev) => [...prev, { id: generateUUID(), role: 'user', content: text }])
    setInput('')

    const finalizeAndPersist = async (finalAnswer) => {
      try {
        await supabase.from('Chat').insert([{ question: text, answer: finalAnswer }])
      } catch (dbErr) {
        logger.warn('Supabase insert failed', dbErr)
      }
      setLoading(false)
    }

    // Prefer streaming via EventSource
    try {
      startSSE({ text, onFinal: finalizeAndPersist })
    } catch (err) {
      logger.error('Failed to start SSE:', err)
      // Fallback to JSON POST immediately
      const assistantId = generateUUID()
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', streaming: true }])
      await fallbackJson({ text, assistantId, onFinal: finalizeAndPersist })
    }
  }

  return (
    <div className="bot-container relative mb-6 flex flex-col h-[80vh] w-screen md:w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900 dark:ring-gray-700">
      <header
        className="bot-header flex items-center justify-between border-b border-gray-200 px-2 py-2 dark:border-gray-700"
        onMouseDown={onDragStart}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-100">
          <img src="/assets/images/chatbot_pot_thinking.gif" alt="Chat Bot" className="w-6 h-6"/>
          Mr.Pot
        </div>
        <button
          type="button"
          aria-label="Minimize chat"
          className="shrink-button rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={onMinimize}
        >
          <Minus className="h-4 w-4"/>
        </button>
      </header>

      <div className="px-3 pt-3">
        <StageTimeline stages={stages} />
      </div>

      <div ref={scrollRef} className="bot-messages flex-1 space-y-2 overflow-y-auto px-3 pb-3">
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
            {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <ArrowUpRight className="h-4 w-4"/>}
          </button>
        </div>
      </form>
    </div>
  )
}

/** Minimized launcher button */
function LauncherButton({onOpen, onDragStart}) {
  const [animating, setAnimating] = useState(true)

  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = 'auto'
    const timer = setTimeout(() => setAnimating(false), 3000)
    return () => clearTimeout(timer)
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

  // Auto-open the widget when the URL contains ?openChat=1 (or any truthy value)
  useEffect(() => {
    if (!router?.isReady) return

    const openChatParam = router.query?.openChat
    if (!openChatParam) return

    // Ensure we land on the homepage with the param preserved during the redirect
    if (router.pathname !== '/') {
      router.replace({ pathname: '/', query: { openChat: openChatParam } }, undefined, { shallow: true })
      return
    }

    setOpen(true)

    // Clean up the URL so it doesn't keep re-opening when navigating back
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

  // Ensure container exists
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
