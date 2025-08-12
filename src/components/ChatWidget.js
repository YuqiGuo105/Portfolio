'use client'

import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, Fragment } from 'react'
import { Minus, ArrowUpRight, Loader2 } from 'lucide-react'
import Image from 'next/image'
import { supabase } from '../supabase/supabaseClient'

/* ───────── minimal sanitizer ───────── */
const sanitizeHtml = (html) =>
  html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')

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
    })
    if (window.innerWidth < 640) {
      Object.assign(el.style, {
        width: '100%',
        left: '0',
        right: '0',
      })
    }
  } else if (window.innerWidth < 640) {
    Object.assign(el.style, {
      width: '100%',
      left: '0',
      right: '0',
    })
  }
  return el
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

/** Dark backdrop overlay */
function Overlay({ onClick }) {
  return (
    <div
      className="fixed inset-0 z-[2147483646] bg-gray-900/40 backdrop-blur-sm transition-opacity sm:hidden"
      onClick={onClick}
    />
  )
}

/** UUID generator */
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4))).toString(16)
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
  const scrollRef = useRef(null)
  const apiUrl = process.env.NEXT_PUBLIC_ASSIST_API || '/api/chat'
  const streamUrl =
    process.env.NEXT_PUBLIC_ASSIST_STREAM_API || `${apiUrl.replace(/\/$/, '')}/stream`

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

  const sendMessage = async (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setLoading(true)
    setMessages(prev => [...prev, { id: generateUUID(), role: 'user', content: text }])
    setInput('')

    const botId = generateUUID()
    let fullText = ''
    let firstChunk = true

    try {
      const res = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false
      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (readerDone) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        for (const part of parts) {
          let event = ''
          let data = ''
          for (const line of part.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (event === 'message' && data) {
            const payload = JSON.parse(data)
            if (payload.delta) {
              fullText += payload.delta
              if (firstChunk) {
                firstChunk = false
                setLoading(false)
                setMessages(prev => [...prev, { id: botId, role: 'assistant', content: payload.delta }])
              } else {
                setMessages(prev =>
                  prev.map(m => (m.id === botId ? { ...m, content: fullText } : m))
                )
              }
            }
          } else if (event === 'done') {
            done = true
          }
        }
      }

      if (firstChunk) setLoading(false)
      const isHtml = /^\s*</.test(fullText) || /<\/[a-z][\s\S]*>/i.test(fullText)
      const content = isHtml ? sanitizeHtml(fullText) : fullText
      setMessages(prev =>
        prev.map(m => (m.id === botId ? { ...m, content, isHtml } : m))
      )
      await supabase.from('Chat').insert([{ question: text, answer: content }])
    } catch (err) {
      console.error(err)
      setLoading(false)
      setMessages(prev => [
        ...prev,
        { id: generateUUID(), role: 'assistant', content: '⚠️ Something went wrong. Please try again later.' },
      ])
    }
  }

  return (
    <div className="bot-container relative mb-6 flex flex-col h-[80vh] w-full max-w-full sm:max-w-full md:w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900 dark:ring-gray-700">
      <header
        className="bot-header flex items-center justify-between border-b border-gray-200 px-2 py-2 dark:border-gray-700"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
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
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            {m.role === 'assistant' && m.isHtml ? (
              <div
                className="bot-message max-w-[260px] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100"
                dangerouslySetInnerHTML={{ __html: m.content }}
              />
            ) : (
              <div
                className={
                  m.role === 'user'
                    ? 'user-message max-w-[260px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white shadow'
                    : 'bot-message max-w-[260px] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100'
                }
              >
                {m.content}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bot-message max-w-[260px] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100">
              <TypingIndicator />
            </div>
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} className="border-t border-gray-200 bg-gray-50/60 px-2 py-2">
        <div className="bot-actions flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
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
      onTouchStart={onDragStart}
      className="launch-button relative flex items-center rounded-full mb-2 px-5 py-4 shadow-xl ring-1 ring-gray-200 backdrop-blur hover:shadow-2xl"
    >
      <span
        className="relative flex items-center justify-center rounded-full bg-blue-600"
        style={{ width: 60, height: 60 }}
      >
        <Image src="/assets/images/chatPot.png" alt="Chat Bot" width={48} height={48} priority />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white" />
      </span>
      <span className="ml-2 text-sm font-medium text-gray-900 dark:text-gray-100">
        Mr.Pot
      </span>
    </button>
  )
}

/** Main ChatWidget export */
export default function ChatWidget() {
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

  const startDrag = (e) => {
    e.preventDefault()
    dragRef.current.dragging = false
    const point = 'touches' in e ? e.touches[0] : e
    const startX = point.clientX
    const startY = point.clientY
    const { x, y } = offsetRef.current
    const moveEvent = 'touches' in e ? 'touchmove' : 'mousemove'
    const upEvent = 'touches' in e ? 'touchend' : 'mouseup'

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
