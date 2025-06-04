'use client'

import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { Bot, Minus, ArrowUpRight, Loader2 } from 'lucide-react'

/* -------------------------------------------------
 * utilities – mount a dedicated, fixed root element
 * ------------------------------------------------*/
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
      zIndex: '2147483647', // very high – stays above everything
    })
  }
  return el
}

/* -------------------------------------------------
 * Overlay – darkened backdrop behind the chat window
 * ------------------------------------------------*/
function Overlay({ onClick }) {
  return (
    <div
      className="fixed inset-0 z-[2147483646] bg-gray-900/40 backdrop-blur-sm transition-opacity sm:hidden" // show overlay on mobile; hide on >sm for subtlety
      onClick={onClick}
    />
  )
}

/* =============================================================
 * ChatWindow – the expanded chat UI
 * ===========================================================*/
function ChatWindow({ onMinimize }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = 'auto' // allow interaction while open
    return () => {
      root.style.pointerEvents = 'none'
    }
  }, [])

  // keep latest message in view
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  const sendMessage = useCallback(
    async (e) => {
      e.preventDefault()
      const text = input.trim()
      if (!text || loading) return

      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }])
      setInput('')
      setLoading(true)

      try {
        const res = await fetch('/api/assist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: text }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const { answer = 'Sorry, I have no response.' } = await res.json()
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: answer }])
      } catch (err) {
        console.error(err)
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: '⚠️ Something went wrong. Please try again later.' },
        ])
      } finally {
        setLoading(false)
      }
    },
    [input, loading]
  )

  return (
    <div
      className="relative mb-6 mr-6 flex h-[80vh] w-[96vw] max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:bg-gray-900 dark:ring-gray-700 sm:h-[600px] sm:w-[400px] md:w-[480px]"
    >
      {/* header */}
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-100">
          <Bot className="h-4 w-4 text-blue-600" /> Support Bot
        </div>
        <button
          type="button"
          aria-label="Minimize chat"
          className="rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          onClick={onMinimize}
        >
          <Minus className="h-4 w-4" />
        </button>
      </header>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <span
              className={
                m.role === 'user'
                  ? 'max-w-[260px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white shadow'
                  : 'max-w-[260px] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100'
              }
            >
              {m.content}
            </span>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Assistant is typing…
          </div>
        )}
      </div>

      {/* input */}
      <form onSubmit={sendMessage} className="border-t border-gray-200 bg-gray-50/60 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/60">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="peer h-10 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-blue-500 dark:text-gray-100 dark:placeholder-gray-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="rounded-md bg-blue-600 p-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  )
}

/* =============================================================
 * LauncherButton – minimized state
 * ===========================================================*/
function LauncherButton({ onOpen }) {
  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = 'auto'
  }, [])

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative mb-6 mr-6 flex items-center gap-3 rounded-full bg-white px-3 py-2 shadow-xl ring-1 ring-gray-200 backdrop-blur transition hover:shadow-2xl supports-[backdrop-filter]:bg-white/75 dark:bg-gray-900 dark:ring-gray-700"
    >
      <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
        <Bot className="h-6 w-6" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white dark:ring-gray-900" />
      </span>
      <span className="hidden flex-col items-start pr-2 text-left xs:flex">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Support Bot</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">Online</span>
      </span>
    </button>
  )
}

/* =============================================================
 * ChatWidget – main export
 * ===========================================================*/
export default function ChatWidget() {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const root = ensureRoot()
  root.style.pointerEvents = open ? 'auto' : 'none'

  return createPortal(
    open ? (
      <Fragment>
        <Overlay onClick={() => setOpen(false)} />
        <ChatWindow onMinimize={() => setOpen(false)} />
      </Fragment>
    ) : (
      <LauncherButton onOpen={() => setOpen(true)} />
    ),
    root
  )
}
