'use client'

import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, useCallback, Fragment, useMemo } from 'react'
import { Bot, Minus, ArrowUpRight, Loader2 } from 'lucide-react'
import Image from 'next/image'
import { supabase } from '../supabase/supabaseClient'

/* ───────── minimal sanitizer ───────── */
const sanitizeHtml = (html) =>
  html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')

/**
 * @typedef {Object} ChatRequest
 * @property {string} message
 * @property {string} [session_id]
 *
 * @typedef {Object} ChatResponse
 * @property {string} answer
 */
/* -------------------------------------------------
 * utilities – mount a dedicated, fixed root element
 * ------------------------------------------------*/
const ensureRoot = () => {
  let el = document.getElementById('__chat_widget_root')
  if (!el) {
    el = document.createElement('div')
    el.id = '__chat_widget_root'
    el.className = 'bot-contain'
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
 * Typing animation component
 * ------------------------------------------------*/
function TypingIndicator() {
  return (
    <div className="typing">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  )
}

/* -------------------------------------------------
 * Overlay – darkened backdrop behind the chat window
 * ------------------------------------------------*/
function Overlay({ onClick }) {
  return (
    <div
      className="fixed inset-0 z-[2147483646] bg-gray-900/40 backdrop-blur-sm transition-opacity sm:hidden"
      onClick={onClick}
    />
  )
}

/* =============================================================
 * ChatWindow – the expanded chat UI
 * ===========================================================*/
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

function ChatWindow({ onMinimize, className = '' }) {
  const [messages, setMessages] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('chatMessages');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [sessionId, setSessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      let id = sessionStorage.getItem('chatSessionId');
      if (!id) {
        id = generateUUID();
        sessionStorage.setItem('chatSessionId', id);
      }
      return id;
    }
    return '';
  });
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)

  const apiUrl = process.env.NEXT_PUBLIC_ASSIST_API || '/api/chat'

  useEffect(() => {
    if (messages.length === 0) {
      const welcomeMessage = {
        id: generateUUID(),
        role: 'assistant',
        content: 'Hi! How can I help you today?'
      }
      setMessages([welcomeMessage])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = 'auto'
    return () => {
      root.style.pointerEvents = 'none'
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('chatMessages', JSON.stringify(messages));
    }
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  const sendMessage = useCallback(
    async (e) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || loading) return;

      const newMessage = { id: generateUUID(), role: 'user', content: text };
      setMessages((prev) => [...prev, newMessage]);
      setInput('');
      setLoading(true);

      try {
        const payload = { message: text, session_id: sessionId };
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        /** @type {ChatResponse} */
        const { answer } = await res.json();

        /* detect HTML */
        const isHtml = /^\s*</.test(answer) || /<\/[a-z][\s\S]*>/i.test(answer);
        const safe   = isHtml ? sanitizeHtml(answer) : answer;

        const botMessage = { id: generateUUID(), role: 'assistant', content: safe, isHtml };
        setMessages((prev) => [...prev, botMessage]);

        try {
          await supabase.from('Chat').insert([{ question: text, answer: safe }]);
        } catch (dbErr) {
          console.error('Supabase insert error:', dbErr);
        }
      } catch (err) {
        console.error(err);
        setMessages((prev) => [
          ...prev,
          { id: generateUUID(), role: 'assistant', content: '⚠️ Something went wrong. Please try again later.' }
        ]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, sessionId]
  );

  return (
    <div className="bot-container relative mb-6 flex flex-col h-[80vh] w-full max-w-full sm:max-w-full md:w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:bg-gray-900 dark:ring-gray-700 sm:px-0">
      {/* header */}
      <header className="bot-header flex items-center justify-between border-b border-gray-200 px-2 py-2 dark:border-gray-700">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-100">
          <img
            src="/assets/images/chatbot_pot_thinking.gif"
            alt="Chat Bot"
            className="object-contain w-4 h-4 sm:w-6 sm:h-6 md:w-8 md:h-8"
          />
          Mr.Pot
        </div>
        <button
          type="button"
          aria-label="Minimize chat"
          className="shrink-button rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          onClick={onMinimize}
        >
          <Minus className="h-4 w-4"/>
        </button>
      </header>

      {/* messages */}
      <div ref={scrollRef} className="bot-messages flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            {m.role === 'assistant' && m.isHtml ? (
              <div
                className="bot-message max-w-[260px] rounded-lg bg-gray-100 px-3 sm:px-1 py-2 text-sm text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100"
                style={{ width: 'fit-content', maxWidth: '100%' }}
                dangerouslySetInnerHTML={{ __html: m.content }}
              />
            ) : (
              <div
                className={
                  m.role === 'user'
                    ? 'user-message max-w-[260px] rounded-lg bg-blue-600 px-3 sm:px-1 py-2 text-sm text-white shadow'
                    : 'bot-message max-w-[260px] rounded-lg bg-gray-100 px-3 sm:px-1 py-2 text-sm text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100 whitespace-pre-line'
                }
                style={{ width: 'fit-content', maxWidth: '100%' }}
              >
                {m.content}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bot-message max-w-[260px] rounded-lg bg-gray-100 px-3 sm:px-1 py-2 text-sm text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100" style={{ width: 'fit-content', maxWidth: '100%' }}>
              <TypingIndicator />
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <form onSubmit={sendMessage} className="border-t border-gray-200 bg-gray-50/60 px-2 py-2">
        <div className="bot-actions flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="bot-input peer h-10 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm placeholder-gray-400 outline-none transition focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="send-button rounded-md bg-blue-600 p-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <ArrowUpRight className="h-4 w-4"/>}
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
  const [animating, setAnimating] = useState(true)

  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = 'auto'
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setAnimating(false), 3000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex items-center rounded-full mb-2 px-5 py-4 shadow-xl ring-1 ring-gray-200 backdrop-blur transition hover:shadow-2xl supports-[backdrop-filter]:bg-white/75 dark:bg-gray-900 dark:ring-gray-700 launch-button"
    >
      <span className="relative flex h-15 w-15 items-center justify-center rounded-full bg-blue-600">
        <Image
          src="/assets/images/chatPot.png"
          alt="Chat Bot"
          width={32}
          height={32}
          priority
          className={`w-8 h-8 object-contain pot-image ${animating ? 'shake' : ''}`}
        />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white dark:ring-gray-900"/>
      </span>
      <span className="hidden flex-col items-start pr-2 text-left xs:flex">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Mr.Pot</span>
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
  root.style.pointerEvents = 'auto'

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
