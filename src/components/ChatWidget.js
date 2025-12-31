"use client"

import { createPortal } from "react-dom"
import { useState, useEffect, useRef, Fragment } from "react"
import { Minus, ArrowUpRight, Loader2, FileText, X } from "lucide-react"
import Image from "next/image"
import { supabase } from "../supabase/supabaseClient" // <-- adjust if your path differs
import { useRouter } from "next/router"

/* ============================================================
   ChatWidget — POST SSE for /api/rag/answer/stream
   + Attachments (2 max, progress bar, chips in msg)
   ✅ NEW: send uploaded file URLs via request body: { fileUrls: [...] }
   ✅ No hard-coded stage list: stages come from backend stream payload
   ============================================================ */

const logger = {
  info: (...a) => console.log("[ChatWidget]", ...a),
  warn: (...a) => console.warn("[ChatWidget]", ...a),
  error: (...a) => console.error("[ChatWidget]", ...a),
}

/* ───────── WYSIWYG HTML sanitizer (DOMParser-first) ───────── */
const sanitizeHtmlRegexFallback = (html) =>
  String(html || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'")

function sanitizeWysiwygHtml(html) {
  const raw = String(html || "")
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return sanitizeHtmlRegexFallback(raw)
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(raw, "text/html")

    doc.querySelectorAll("script, iframe, object, embed, link, meta").forEach((n) => n.remove())

    const all = doc.body.querySelectorAll("*")
    all.forEach((el) => {
      ;[...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase()
        const value = String(attr.value || "")

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name)
          return
        }

        if (name === "href" || name === "src" || name === "xlink:href") {
          const v = value.trim().replace(/\s+/g, "")
          if (/^javascript:/i.test(v) || /^data:text\/html/i.test(v)) {
            el.removeAttribute(attr.name)
            return
          }
        }

        if (name === "style") {
          if (/expression\s*\(|url\s*\(\s*['"]?\s*javascript:/i.test(value) || /behavior\s*:/i.test(value)) {
            el.removeAttribute("style")
            return
          }
        }
      })

      if (el.tagName === "A") {
        const href = el.getAttribute("href") || ""
        if (href && !href.startsWith("#")) {
          el.setAttribute("target", "_blank")
          el.setAttribute("rel", "noreferrer noopener")
        }
      }
    })

    return doc.body.innerHTML
  } catch (e) {
    logger.warn("DOMParser sanitize failed, fallback to regex:", e?.message || e)
    return sanitizeHtmlRegexFallback(raw)
  }
}

/* ───────── linkify plain URLs (for non-HTML answers) ───────── */
const URL_RE = /\bhttps?:\/\/[^\s<]+/gi

function splitTrailingPunct(url) {
  const m = url.match(/^(.*?)([)\].,!?:;。，“”，！？、》》】】]+)?$/)
  return { href: m?.[1] || url, tail: m?.[2] || "" }
}

function renderTextWithLinks(text) {
  const s = String(text || "")
  const out = []
  let last = 0

  s.replace(URL_RE, (match, offset) => {
    const idx = Number(offset)
    if (idx > last) out.push(s.slice(last, idx))

    const { href, tail } = splitTrailingPunct(match)
    out.push(
      <a key={`${idx}-${href}`} href={href} target="_blank" rel="noreferrer noopener" className="chat-link">
        {href}
      </a>,
    )
    if (tail) out.push(tail)

    last = idx + match.length
    return match
  })

  if (last < s.length) out.push(s.slice(last))
  return out
}

const SESSION_TTL_MS = 15 * 60 * 1000

// ✅ bucket name from your Supabase dashboard link: .../buckets/chat
const UPLOAD_BUCKET = "chat"
const UPLOAD_TTL_MS = 2 * 60 * 1000
const MAX_FILES_PER_MESSAGE = 2

const storageSafeGet = (key) => {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch (err) {
    logger.warn("localStorage get failed", err)
    return null
  }
}

const storageSafeSet = (key, value) => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch (err) {
    logger.warn("localStorage set failed", err)
  }
}

const migrateSessionStorageValue = (key) => {
  if (typeof window === "undefined") return null
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
  const lastActive = Number(storageSafeGet("chatSessionLastActive") || 0)
  return Number.isFinite(lastActive) && Date.now() - lastActive < SESSION_TTL_MS
}

/** Ensure there's a root container for the chat widget */
const ensureRoot = () => {
  let el = document.getElementById("__chat_widget_root")
  if (!el) {
    el = document.createElement("div")
    el.id = "__chat_widget_root"
    document.body.appendChild(el)
    Object.assign(el.style, {
      position: "fixed",
      bottom: "0",
      right: "0",
      zIndex: "2147483647",
      pointerEvents: "auto",
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
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
  )
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function compactText(s, max = 220) {
  if (s == null) return ""
  const t = String(s)
  return t.length > max ? t.slice(0, max) + "…" : t
}

function safeShort(s, max) {
  return compactText(String(s ?? ""), max).replace(/\s+/g, " ").trim()
}

function looksLikeHtml(s) {
  return /<\/?[a-z][\s\S]*>/i.test(String(s || ""))
}

/* ---------- RAG endpoint helpers ---------- */

function normalizeRagBaseUrl(raw) {
  if (!raw) return ""
  const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://localhost")
  u.hash = ""
  u.search = ""
  u.pathname = u.pathname.replace(/\/api\/rag\/answer\/stream\/?$/, "/api/rag/answer")
  if (!/\/api\/rag\/answer\/?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/$/, "") + "/api/rag/answer"
  }
  return u.toString().replace(/\/$/, "")
}

function ragStreamUrl(ragBaseUrl) {
  const u = new URL(ragBaseUrl, window.location.origin)
  u.pathname = u.pathname.replace(/\/api\/rag\/answer\/?$/, "/api/rag/answer/stream")
  return u.toString()
}

async function resolveRagEndpoint() {
  const primaryRaw = process.env.NEXT_PUBLIC_ASSIST_API || process.env.NEXT_PUBLIC_RAG_API || ""
  const primary = primaryRaw ? normalizeRagBaseUrl(primaryRaw) : ""
  const fallback = "/api/rag/answer"

  const candidates = []
  if (primary) candidates.push(primary)
  candidates.push(fallback)

  for (const ep of candidates) {
    try {
      const u = new URL(ep, window.location.origin)
      const healthUrl = new URL("/health", u.origin).toString()
      const res = await fetchWithTimeout(healthUrl, { method: "GET" }, 3000)
      if (res.ok) return u.toString().replace(/\/$/, "")
    } catch (e) {
      logger.warn("Health probe failed:", e?.message || e)
    }
  }
  return candidates[0]
}

/* ---------- SSE parsing (POST fetch stream) ---------- */

function parseSSEBlock(block) {
  const lines = block.split(/\r?\n/)
  let event = "message"
  const dataLines = []
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith("event:")) event = line.slice(6).trim()
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
  }
  return { event, data: dataLines.join("\n") }
}

async function postSSE(url, body, { onEvent, signal }) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    mode: "cors",
    signal,
  })

  if (!res.ok) {
    const t = await res.text().catch(() => "")
    throw new Error(`SSE HTTP ${res.status} ${res.statusText}${t ? " — " + t.slice(0, 160) : ""}`)
  }
  if (!res.body) throw new Error("ReadableStream not supported")

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buf = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "")
      const evt = parseSSEBlock(raw)
      if (evt?.data != null) onEvent?.(evt)
    }
  }
}

/* ============================================================
   ✅ No hard-coded stage list: use backend stream fields directly
   ============================================================ */

function extractPayloadText(payload) {
  if (payload == null) return ""
  if (typeof payload === "string") return payload

  if (Array.isArray(payload)) {
    const parts = payload
      .slice(0, 4)
      .map((it) => {
        if (it == null) return ""
        if (typeof it === "string") return it
        if (typeof it === "object") {
          const t = it.content ?? it.preview ?? it.text ?? it.message ?? it.title ?? it.name ?? it.url
          if (t != null && String(t).trim()) return String(t)
          try {
            return JSON.stringify(it)
          } catch {
            return String(it)
          }
        }
        return String(it)
      })
      .filter(Boolean)
    return parts.join("  ·  ")
  }

  if (typeof payload === "object") {
    const t = payload.content ?? payload.preview ?? payload.text ?? payload.message ?? payload.title ?? payload.name
    if (t != null && String(t).trim()) return String(t)
    if (payload.ts != null) return `ts=${payload.ts}`
    try {
      return JSON.stringify(payload)
    } catch {
      return String(payload)
    }
  }

  return String(payload)
}

function summarizePayload(payload, max = 180) {
  const t = extractPayloadText(payload)
  return safeShort(t, max)
}

function formatStageTitle(stage, message) {
  const msg = typeof message === "string" ? message.trim() : ""
  if (msg) return msg
  const s = typeof stage === "string" ? stage.trim() : ""
  return s || "Stage"
}

/* ---------- UI bits ---------- */

function TypingIndicator() {
  return (
    <div className="typing">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
      <style jsx>{`
        .typing {
          display: flex;
          gap: 6px;
          align-items: center;
          padding: 2px 0;
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(107, 114, 128, 0.85);
          animation: bounce 1s infinite;
        }
        .dot:nth-child(2) {
          animation-delay: 0.15s;
        }
        .dot:nth-child(3) {
          animation-delay: 0.3s;
        }
        @keyframes bounce {
          0%,
          80%,
          100% {
            transform: translateY(0);
            opacity: 0.55;
          }
          40% {
            transform: translateY(-4px);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .dot {
            animation: none;
          }
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
          display: inline-block;
          width: 8px;
          height: 14px;
          margin-left: 3px;
          background: currentColor;
          opacity: 0.45;
          animation: blink 1s step-end infinite;
          transform: translateY(2px);
          border-radius: 2px;
        }
        @keyframes blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .blinking-cursor {
            animation: none;
            opacity: 0.35;
          }
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

/* ---------- Stage toast ---------- */
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
        .stage-toast {
          animation: stageIn 180ms ease-out;
        }
        .stage-card {
          position: relative;
          border-radius: 12px;
          border: 1px solid rgba(229, 231, 235, 0.9);
          background: rgba(248, 250, 252, 0.92);
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
          padding: 12px 14px 14px;
          max-height: 92px;
          overflow: hidden;
        }
        :global(.dark) .stage-card,
        :global(body.dark-skin) .stage-card {
          border-color: rgba(55, 65, 81, 0.7);
          background: rgba(15, 23, 42, 0.55);
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.25);
        }
        .row1 {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .spinnerWrap {
          width: 18px;
          height: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          filter: drop-shadow(0 2px 6px rgba(15, 23, 42, 0.16));
          animation: pulseSoft 1.2s ease-in-out infinite;
        }
        .spinnerIcon {
          width: 18px;
          height: 18px;
          color: rgba(75, 85, 99, 0.95);
          animation: spinFast 0.75s linear infinite;
        }
        :global(.dark) .spinnerIcon,
        :global(body.dark-skin) .spinnerIcon {
          color: rgba(226, 232, 240, 0.85);
          filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.35));
        }
        .stage-text {
          font-size: 18px;
          font-weight: 500;
          color: rgba(17, 24, 39, 0.95);
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        :global(.dark) .stage-text,
        :global(body.dark-skin) .stage-text {
          color: rgba(248, 250, 252, 0.92);
        }
        .row2 {
          margin-top: 8px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          min-width: 0;
        }
        .key-label {
          font-size: 12px;
          color: rgba(100, 116, 139, 0.9);
          flex-shrink: 0;
          line-height: 1.2;
        }
        :global(.dark) .key-label,
        :global(body.dark-skin) .key-label {
          color: rgba(226, 232, 240, 0.7);
        }
        .key-value {
          font-size: 12px;
          line-height: 1.25;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
            monospace;
          min-width: 0;

          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          white-space: pre-wrap;
          word-break: break-word;

          color: transparent;
          background-image: linear-gradient(
            90deg,
            rgba(30, 41, 59, 0.35) 0%,
            rgba(59, 130, 246, 0.95) 35%,
            rgba(236, 72, 153, 0.85) 55%,
            rgba(16, 185, 129, 0.85) 75%,
            rgba(30, 41, 59, 0.35) 100%
          );
          background-size: 220% 100%;
          background-position: 0% 50%;
          -webkit-background-clip: text;
          background-clip: text;
          animation: waveText 1.6s ease-in-out infinite;
        }
        .bar {
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 10px;
          height: 2px;
          border-radius: 999px;
          overflow: hidden;
          opacity: 0.55;
          background: rgba(148, 163, 184, 0.25);
        }
        .bar::before {
          content: "";
          position: absolute;
          left: -40%;
          top: 0;
          height: 100%;
          width: 40%;
          border-radius: 999px;
          background: rgba(100, 116, 139, 0.7);
          animation: indeterminate 1.2s ease-in-out infinite;
        }
        @keyframes stageIn {
          from {
            opacity: 0;
            transform: translateY(6px) scale(0.99);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes spinFast {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes pulseSoft {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.95;
          }
          50% {
            transform: scale(1.06);
            opacity: 1;
          }
        }
        @keyframes waveText {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        @keyframes indeterminate {
          0% {
            left: -40%;
          }
          50% {
            left: 60%;
          }
          100% {
            left: 120%;
          }
        }
      `}</style>
    </div>
  )
}

/* ----------------- upload helpers (FIXED InvalidKey) ----------------- */

function sanitizeFilenameForStorageKey(name) {
  const original = String(name || "upload").trim()

  const dot = original.lastIndexOf(".")
  const ext = dot >= 0 ? original.slice(dot) : ""
  const base = dot >= 0 ? original.slice(0, dot) : original

  const safeBase =
    base
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "file"

  const safeExt = ext.normalize("NFKD").replace(/[^a-zA-Z0-9.]+/g, "").slice(0, 10)

  return safeBase + safeExt
}

function buildUploadPath({ sessionId, file }) {
  const safeName = sanitizeFilenameForStorageKey(file?.name)
  return {
    safeName,
    path: `${sessionId}-${Date.now()}-${generateUUID()}-${safeName}`,
  }
}

function prettyStorageError(err) {
  const msg = String(err?.message || err || "")
  if (/unauthorized|forbidden|permission/i.test(msg)) {
    return "Upload blocked (permission denied). Check your Supabase Storage policies for bucket “chat”."
  }
  if (/bucket/i.test(msg) && /not found/i.test(msg)) {
    return "Upload failed: bucket “chat” not found. Create it in Supabase Storage."
  }
  return msg || "Upload failed. Please try again."
}

/**
 * Upload with progress (XHR) to Supabase Storage REST endpoint.
 * Uses user access_token if available, else anon key.
 */
async function uploadToSupabaseWithProgress({ bucket, path, file, onProgress }) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!baseUrl || !anonKey) throw new Error("Supabase env vars missing")

  const { data } = await supabase.auth.getSession()
  const bearer = data?.session?.access_token || anonKey

  const url = `${baseUrl}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url, true)
    xhr.setRequestHeader("apikey", anonKey)
    xhr.setRequestHeader("Authorization", `Bearer ${bearer}`)
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    xhr.setRequestHeader("x-upsert", "false")

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return
      const pct = Math.max(0, Math.min(100, Math.round((e.loaded / e.total) * 100)))
      onProgress?.(pct)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(true)
      else reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText || ""}`))
    }
    xhr.onerror = () => reject(new Error("Upload failed (network error)"))
    xhr.send(file)
  })
}

/**
 * Build a PUBLIC URL for a public bucket.
 * Example: https://xxx.supabase.co/storage/v1/object/public/chat/<path>
 */
function buildPublicFileUrl(bucket, objectPath) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!baseUrl) return ""
  return `${baseUrl}/storage/v1/object/public/${bucket}/${encodeURIComponent(objectPath)}`
}

/* ---------- Attachment UI (CSS only) ---------- */

function AttachmentChip({ name, href, status, progress, onRemove }) {
  const content = (
    <span className="cw-chip-inner">
      <FileText className="cw-chip-ico" />
      <span className="cw-chip-name" title={name}>
        {name}
      </span>
      {status === "uploading" ? <span className="cw-chip-meta">{progress}%</span> : null}
      {status === "error" ? <span className="cw-chip-meta cw-chip-err">failed</span> : null}
    </span>
  )

  return (
    <div className="cw-chip">
      {href ? (
        <a className="cw-chip-link" href={href} target="_blank" rel="noreferrer noopener">
          {content}
        </a>
      ) : (
        content
      )}

      {onRemove ? (
        <button type="button" className="cw-chip-x" onClick={onRemove} aria-label="Remove file">
          <X className="cw-chip-x-ico" />
        </button>
      ) : null}
    </div>
  )
}

function AttachmentProgressRow({ name, progress }) {
  return (
    <div className="cw-prog">
      <div className="cw-prog-top">
        <span className="cw-prog-name" title={name}>
          {name}
        </span>
        <span className="cw-prog-pct">{progress}%</span>
      </div>
      <div className="cw-prog-bar">
        <div className="cw-prog-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

/* ---------- Chat window ---------- */

function ChatWindow({ onMinimize, onDragStart }) {
  const [messages, setMessages] = useState(() => {
    const saved = readPersistedJson("chatMessages")
    return Array.isArray(saved) ? saved : []
  })

  const [sessionId] = useState(() => {
    let id = storageSafeGet("chatSessionId") || migrateSessionStorageValue("chatSessionId")
    if (!id) {
      id = generateUUID()
      storageSafeSet("chatSessionId", id)
    }
    return id
  })

  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [endpoint, setEndpoint] = useState("")
  const [errorToast, setErrorToast] = useState("")

  // composer attachments (max 2 per outgoing message)
  const [composerFiles, setComposerFiles] = useState([])
  // { id, file, name(original), status: "uploading"|"ready"|"error", progress, storagePath, publicUrl }

  const scrollRef = useRef(null)
  const ragEndpointRef = useRef(null)
  const abortRef = useRef(null)
  const uploadTimersRef = useRef([])
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (errorToast) {
      const timer = setTimeout(() => setErrorToast(""), 3000)
      return () => clearTimeout(timer)
    }
  }, [errorToast])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      const scrollHeight = textareaRef.current.scrollHeight
      const maxHeight = 72
      textareaRef.current.style.height = Math.min(scrollHeight, maxHeight) + "px"
    }
  }, [input])

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ id: generateUUID(), role: "assistant", content: "Hi! How can I help you today?" }])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = "auto"
    return () => {
      root.style.pointerEvents = "none"
    }
  }, [])

  useEffect(() => {
    storageSafeSet("chatMessages", JSON.stringify(messages))
    storageSafeSet("chatSessionLastActive", String(Date.now()))
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
        const res = await fetchWithTimeout(new URL("/health", u.origin), { method: "GET" }, 3000)
        if (!res.ok) logger.warn("Health check non-OK:", res.status, res.statusText)
      } catch (e) {
        logger.warn("Health check error:", e?.message || e)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(
    () => () => {
      if (abortRef.current) {
        try {
          abortRef.current.abort()
        } catch {}
        abortRef.current = null
      }
    },
    [],
  )

  const scheduleAutoDelete = (filePath) => {
    const timerId = setTimeout(async () => {
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove([filePath])
      if (error) logger.warn("Failed to auto-delete upload", error)
      uploadTimersRef.current = uploadTimersRef.current.filter((id) => id !== timerId)
    }, UPLOAD_TTL_MS)

    uploadTimersRef.current.push(timerId)
  }

  const pickFiles = async (fileList) => {
    const incoming = Array.from(fileList || [])
    if (!incoming.length) return

    const room = MAX_FILES_PER_MESSAGE - composerFiles.length
    if (room <= 0) {
      setErrorToast(`Max ${MAX_FILES_PER_MESSAGE} files per message.`)
      return
    }

    const chosen = incoming.slice(0, room)
    if (incoming.length > room) setErrorToast(`Only ${MAX_FILES_PER_MESSAGE} files per message.`)

    const newItems = chosen.map((file) => ({
      id: generateUUID(),
      file,
      name: file.name,
      status: "uploading",
      progress: 0,
      storagePath: "",
      publicUrl: "",
    }))

    setComposerFiles((prev) => [...prev, ...newItems])
    setUploading(true)

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setErrorToast("Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.")
      setComposerFiles((prev) =>
        prev.map((x) => (newItems.some((n) => n.id === x.id) ? { ...x, status: "error" } : x)),
      )
      setUploading(false)
      return
    }

    await Promise.all(
      newItems.map(async (item) => {
        const { path: uniquePath } = buildUploadPath({ sessionId: sessionId || generateUUID(), file: item.file })

        setComposerFiles((prev) => prev.map((x) => (x.id === item.id ? { ...x, storagePath: uniquePath } : x)))

        try {
          await uploadToSupabaseWithProgress({
            bucket: UPLOAD_BUCKET,
            path: uniquePath,
            file: item.file,
            onProgress: (pct) => {
              setComposerFiles((prev) => prev.map((x) => (x.id === item.id ? { ...x, progress: pct } : x)))
            },
          })

          scheduleAutoDelete(uniquePath)

          const publicUrl = buildPublicFileUrl(UPLOAD_BUCKET, uniquePath)
          if (!publicUrl) throw new Error("Could not build public URL. Check NEXT_PUBLIC_SUPABASE_URL.")

          setComposerFiles((prev) =>
            prev.map((x) => (x.id === item.id ? { ...x, status: "ready", progress: 100, publicUrl } : x)),
          )
        } catch (e) {
          logger.error("Upload failed", e)
          setComposerFiles((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: "error" } : x)))
          setErrorToast(prettyStorageError(e))
        }
      }),
    )

    setUploading(false)
  }

  const removeComposerFile = (id) => {
    setComposerFiles((prev) => prev.filter((x) => x.id !== id))
  }

  const setStage = (assistantId, stage, obj = {}) => {
    const title = formatStageTitle(stage, obj?.message)
    const keyInfo = summarizePayload(obj?.payload, 180)

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
            ...m,
            thinkingNow: {
              id: `${String(stage || "stage")}-${Date.now()}`,
              stage,
              title,
              keyInfo,
              ts: Date.now(),
            },
          }
          : m,
      ),
    )
  }

  const clearStage = (assistantId) => {
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, thinkingNow: null } : m)))
  }

  const finalizeAssistant = (assistantId, rawFinal, onFinal) => {
    const finalRaw = String(rawFinal || "")
    const html = looksLikeHtml(finalRaw)
    const finalContent = html ? sanitizeWysiwygHtml(finalRaw) : finalRaw

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, content: finalContent, isHtml: html, streaming: false, thinkingNow: null } : m,
      ),
    )

    onFinal?.(finalContent)
  }

  const startRagSSE = async ({ question, fileUrls, assistantId, onFinal }) => {
    const base = ragEndpointRef.current || (await resolveRagEndpoint())
    const streamUrl = ragStreamUrl(base)

    const controller = new AbortController()
    abortRef.current = controller

    let answerBuf = ""
    let finalized = false

    setStage(assistantId, "start", { message: "Init", payload: { ts: Date.now() } })

    const body = {
      question,
      sessionId,
      ...(Array.isArray(fileUrls) && fileUrls.length > 0 ? { fileUrls } : {}),
    }

    await postSSE(streamUrl, body, {
      signal: controller.signal,
      onEvent: (evt) => {
        const obj = safeJsonParse(evt.data) || {}
        const stage = obj.stage || evt.event || "message"

        if (stage === "answer_delta") {
          const delta = typeof obj.payload === "string" ? obj.payload : ""
          if (delta) {
            answerBuf += delta
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: answerBuf, streaming: true } : m)))
          }
          setStage(assistantId, stage, obj)
          return
        }

        if (stage === "answer_final") {
          finalized = true
          clearStage(assistantId)
          finalizeAssistant(assistantId, typeof obj.payload === "string" ? obj.payload : answerBuf, onFinal)
          return
        }

        setStage(assistantId, stage, obj)
      },
    })

    if (!finalized && answerBuf) {
      clearStage(assistantId)
      finalizeAssistant(assistantId, answerBuf, onFinal)
    }
  }

  const sendMessage = async (e) => {
    e?.preventDefault?.()

    const visibleText = input.trim()
    if ((!visibleText && composerFiles.length === 0) || loading) return

    const stillUploading = composerFiles.some((f) => f.status === "uploading")
    if (stillUploading) {
      setErrorToast("Wait for uploads to finish.")
      return
    }

    const readyFiles = composerFiles
      .filter((f) => f.status === "ready" && f.publicUrl)
      .map((f) => ({ name: f.name, url: f.publicUrl }))

    if (abortRef.current) {
      try {
        abortRef.current.abort()
      } catch {}
      abortRef.current = null
    }

    setLoading(true)

    setMessages((prev) => [...prev, { id: generateUUID(), role: "user", content: visibleText, attachments: readyFiles }])
    setInput("")
    setComposerFiles([])

    const assistantId = generateUUID()
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", streaming: true, thinkingNow: null }])

    const baseQuestion = visibleText || "Please use the attached file(s)."
    const fileUrls = readyFiles.map((f) => f.url)

    const finalizeAndPersist = async (finalAnswer) => {
      try {
        await supabase.from("Chat").insert([{ question: baseQuestion, answer: finalAnswer }])
      } catch (dbErr) {
        logger.warn("Supabase insert failed", dbErr)
      }
      setLoading(false)
    }

    try {
      await startRagSSE({ question: baseQuestion, fileUrls, assistantId, onFinal: finalizeAndPersist })
    } catch (err) {
      logger.error("SSE failed:", err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "⚠️ Failed to contact assistant.", streaming: false, thinkingNow: null } : m,
        ),
      )
      setLoading(false)
    }
  }

  return (
    <div className="bot-container relative mb-6 flex flex-col w-screen md:w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900 dark:ring-gray-700">
      <header
        className="bot-header shrink-0 flex items-center justify-between border-b border-gray-200 px-2 py-2 dark:border-gray-700"
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

      {/* ✅ only this area scrolls */}
      <div ref={scrollRef} className="bot-messages flex-1 min-h-0 space-y-2 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {m.role === "assistant" && m.isHtml ? (
              <div
                className="bot-message max-w-[320px] md:max-w-[420px] rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-900 shadow border border-gray-200/80 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-100"
                dangerouslySetInnerHTML={{ __html: m.content }}
              />
            ) : (
              <div
                className={
                  m.role === "user"
                    ? "user-message max-w-[320px] md:max-w-[420px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white shadow border border-blue-700/80"
                    : "bot-message max-w-[320px] md:max-w-[420px] rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-900 shadow border border-gray-200/80 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-100"
                }
              >
                {m.role === "user" && Array.isArray(m.attachments) && m.attachments.length > 0 ? (
                  <div className="cw-msg-files">
                    {m.attachments.map((f) => (
                      <AttachmentChip key={f.url || f.name} name={f.name} href={f.url} status="ready" />
                    ))}
                  </div>
                ) : null}

                {m.role === "assistant" && m.streaming && m.thinkingNow ? <StageToast step={m.thinkingNow} /> : null}

                {m.streaming ? (
                  m.content === "" ? (
                    <TypingIndicator />
                  ) : (
                    <>
                      <span>{renderTextWithLinks(m.content)}</span>
                      <StreamingCursor />
                    </>
                  )
                ) : (
                  renderTextWithLinks(m.content)
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {errorToast && (
        <div
          style={{
            position: "absolute",
            top: "70px",
            left: "16px",
            right: "16px",
            zIndex: 100,
            backgroundColor: "#ef4444",
            color: "white",
            padding: "10px 14px",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            animation: "toastIn 200ms ease-out",
          }}
        >
          {errorToast}
        </div>
      )}

      <form
        onSubmit={sendMessage}
        className="input-area shrink-0 px-3 py-1"
        style={{
          backgroundColor: "var(--cw-input-bg)",
          borderTop: "1px solid var(--cw-input-border)",
          color: "var(--cw-input-text)",
        }}
      >
        {composerFiles.length > 0 ? (
          <div className="cw-tray">
            {composerFiles.map((f) =>
              f.status === "uploading" ? (
                <AttachmentProgressRow key={f.id} name={f.name} progress={f.progress || 0} />
              ) : (
                <AttachmentChip
                  key={f.id}
                  name={f.name}
                  href={f.status === "ready" ? f.publicUrl : undefined}
                  status={f.status}
                  progress={f.progress}
                  onRemove={() => removeComposerFile(f.id)}
                />
              ),
            )}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "12px",
            minHeight: "50px",
            width: "100%",
            border: "none",
            borderRadius: "0",
            backgroundColor: "transparent",
            padding: "0",
            boxSizing: "border-box",
          }}
        >
          {/* Upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || composerFiles.length >= MAX_FILES_PER_MESSAGE}
            aria-label="Upload file"
            style={{
              width: "40px",
              height: "40px",
              minWidth: "40px",
              maxWidth: "40px",
              minHeight: "40px",
              maxHeight: "40px",
              flexShrink: 0,
              flexGrow: 0,
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#f97316",
              color: "white",
              border: "none",
              cursor: "pointer",
              opacity: uploading || composerFiles.length >= MAX_FILES_PER_MESSAGE ? 0.6 : 1,
              padding: 0,
              boxSizing: "border-box",
            }}
            title={composerFiles.length >= MAX_FILES_PER_MESSAGE ? `Max ${MAX_FILES_PER_MESSAGE} files` : "Upload"}
          >
            {uploading ? (
              <Loader2 style={{ width: "18px", height: "18px", color: "white" }} className="animate-spin" />
            ) : (
              <span style={{ fontSize: "22px", lineHeight: 1, color: "white", fontWeight: 300 }}>+</span>
            )}
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                if ((input.trim() || composerFiles.length > 0) && !loading) {
                  sendMessage()
                }
              }
            }}
            placeholder="Type your message..."
            aria-label="Message input"
            rows={1}
            className="cw-textbox"
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              width: "100%",
              minHeight: "40px",
              maxHeight: "72px",
              backgroundColor: "var(--cw-input-bg)",
              padding: "8px",
              fontSize: "16px",
              lineHeight: "24px",
              color: "var(--cw-input-text)",
              border: "1px solid var(--cw-input-border)",
              borderRadius: "10px",
              outline: "none",
              boxSizing: "border-box",
              resize: "none",
              overflowY: "auto",
              fontFamily: "inherit",
            }}
          />

          {/* Send button */}
          <button
            type="submit"
            aria-label="Send message"
            disabled={(!input.trim() && composerFiles.length === 0) || loading}
            style={{
              width: "40px",
              height: "40px",
              minWidth: "40px",
              maxWidth: "40px",
              minHeight: "40px",
              maxHeight: "40px",
              flexShrink: 0,
              flexGrow: 0,
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#f97316",
              color: "white",
              border: "none",
              cursor: "pointer",
              opacity: (!input.trim() && composerFiles.length === 0) || loading ? 0.5 : 1,
              padding: 0,
              boxSizing: "border-box",
            }}
          >
            {loading ? (
              <Loader2 style={{ width: "18px", height: "18px", color: "white" }} className="animate-spin" />
            ) : (
              <ArrowUpRight style={{ width: "18px", height: "18px", color: "white" }} />
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => {
              pickFiles(e.target.files)
              e.target.value = ""
            }}
            hidden
          />
        </div>
      </form>

      <style jsx global>{`
        #__chat_widget_root .bot-container {
          height: min(80vh, 680px);
          max-height: 680px;
        }
        /* === Force the input bar to stay at the bottom === */
        #__chat_widget_root .bot-container {
          display: flex !important;
          flex-direction: column !important;
        }

        #__chat_widget_root .bot-header {
          flex: 0 0 auto !important;
        }

        #__chat_widget_root .bot-messages {
          flex: 1 1 auto !important;
          min-height: 0 !important;     /* critical for scroll area in flex layouts */
          overflow-y: auto !important;
        }

        #__chat_widget_root .input-area {
          flex: 0 0 auto !important;
          margin-top: auto !important;  /* push input area to the bottom */
        }
        @supports (height: 100dvh) {
          #__chat_widget_root .bot-container {
            height: min(80dvh, 680px);
          }
        }

        #__chat_widget_root .bot-messages {
          min-height: 0;
          overflow-y: auto;
        }

        .bot-message,
        .user-message {
          overflow-wrap: anywhere;
          word-break: break-word;
          white-space: pre-wrap;
        }

        .bot-message a.chat-link {
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .bot-message a.chat-link:hover {
          opacity: 0.85;
        }
        .bot-message img,
        .bot-message video {
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

        /* ===== Theme tokens ===== */
        :global(body) #__chat_widget_root {
          --cw-input-bg: #ffffff;
          --cw-input-border: #e5e7eb;
          --cw-input-border-strong: #d1d5db;
          --cw-input-text: #111827;
          --cw-input-placeholder: #6b7280;
          --cw-attachment-border: rgba(229, 231, 235, 0.9);
          --cw-attachment-border-strong: rgba(17, 24, 39, 0.18);
          --cw-attachment-bg: rgba(255, 255, 255, 0.6);
          --cw-progress-surface: rgba(248, 250, 252, 0.9);
          --cw-progress-track: rgba(229, 231, 235, 1);
        }
        :global(body.dark-skin) #__chat_widget_root {
          --cw-input-bg: #0f172a;
          --cw-input-border: rgba(255, 255, 255, 0.28);
          --cw-input-border-strong: rgba(255, 255, 255, 0.72);
          --cw-input-text: #e5e7eb;
          --cw-input-placeholder: #9ca3af;
          --cw-attachment-border: rgba(255, 255, 255, 0.42);
          --cw-attachment-border-strong: rgba(255, 255, 255, 0.6);
          --cw-attachment-bg: rgba(15, 23, 42, 0.35);
          --cw-progress-surface: rgba(15, 23, 42, 0.45);
          --cw-progress-track: rgba(55, 65, 81, 0.9);
        }

        #__chat_widget_root .input-area textarea::placeholder {
          color: var(--cw-input-placeholder);
        }

        @keyframes toastIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* ===== Attachment UI ===== */
        .cw-tray {
          padding: 6px 0 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .cw-msg-files {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }

        .cw-prog {
          border: 1px solid var(--cw-attachment-border-strong);
          background: var(--cw-progress-surface);
          border-radius: 12px;
          padding: 8px 10px;
          color: var(--cw-input-text);
        }
        .cw-prog-top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 12px;
          opacity: 0.9;
        }
        .cw-prog-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 320px;
        }
        .cw-prog-pct {
          min-width: 32px;
          text-align: right;
          color: var(--cw-input-placeholder);
        }
        .cw-prog-bar {
          height: 6px;
          border-radius: 999px;
          background: var(--cw-progress-track);
          overflow: hidden;
          margin-top: 6px;
        }
        .cw-prog-fill {
          height: 100%;
          border-radius: 999px;
          background: #f97316;
          width: 0%;
          transition: width 120ms linear;
        }

        .cw-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid var(--cw-attachment-border-strong);
          background: var(--cw-attachment-bg);
          border-radius: 999px;
          padding: 8px 10px;
          max-width: 100%;
          color: var(--cw-input-text);
        }

        #__chat_widget_root .cw-textbox {
          transition: border-color 120ms ease, box-shadow 120ms ease;
        }
        #__chat_widget_root .cw-textbox:focus {
          border-color: var(--cw-input-border-strong);
          box-shadow: 0 0 0 1px var(--cw-input-border-strong);
        }

        .cw-chip-link {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          color: inherit;
          max-width: 100%;
        }

        .cw-chip-inner {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          max-width: 100%;
          min-width: 0;
        }

        .cw-chip-ico {
          width: 16px;
          height: 16px;
          flex: 0 0 auto;
          opacity: 0.9;
        }

        .cw-chip-name {
          font-size: 13px;
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 260px;
        }

        .cw-chip-meta {
          font-size: 12px;
          opacity: 0.75;
          flex: 0 0 auto;
          color: var(--cw-input-placeholder);
        }
        .cw-chip-err {
          color: #ef4444;
          opacity: 1;
        }

        .cw-chip-x {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 2px;
          border-radius: 8px;
          opacity: 0.8;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .cw-chip-x:hover {
          opacity: 1;
          background: rgba(243, 244, 246, 1);
        }
        :global(.dark) .cw-chip-x:hover,
        :global(body.dark-skin) .cw-chip-x:hover {
          background: rgba(31, 41, 55, 1);
        }
        .cw-chip-x-ico {
          width: 16px;
          height: 16px;
        }

        /* ============================================================
           ✅ OPTIONAL WYSIWYG POLISH (CSS only; no Tailwind needed)
           1) restore list bullets/margins inside .bot-message
           2) override pre/code to avoid inherited white-space: pre-wrap
           ============================================================ */

        #__chat_widget_root .bot-message ul,
        #__chat_widget_root .bot-message ol {
          list-style-position: outside;
          padding-left: 1.25rem;
          margin: 0.5rem 0;
        }
        #__chat_widget_root .bot-message ul {
          list-style-type: disc;
        }
        #__chat_widget_root .bot-message ol {
          list-style-type: decimal;
        }
        #__chat_widget_root .bot-message li {
          margin: 0.25rem 0;
        }

        #__chat_widget_root .bot-message pre {
          white-space: pre;
          word-break: normal;
          overflow-x: auto;

          padding: 10px 12px;
          margin: 0.5rem 0;
          border-radius: 10px;

          background: rgba(15, 23, 42, 0.06);
          border: 1px solid rgba(229, 231, 235, 0.9);
        }
        :global(.dark) #__chat_widget_root .bot-message pre,
        :global(body.dark-skin) #__chat_widget_root .bot-message pre {
          background: rgba(0, 0, 0, 0.25);
          border-color: rgba(55, 65, 81, 0.7);
        }
        #__chat_widget_root .bot-message pre code {
          display: block;
          white-space: inherit;
        }

        #__chat_widget_root .bot-message :not(pre) > code {
          white-space: pre-wrap;
          padding: 0.12em 0.35em;
          border-radius: 6px;
          background: rgba(15, 23, 42, 0.06);
          border: 1px solid rgba(229, 231, 235, 0.9);
        }
        :global(.dark) #__chat_widget_root .bot-message :not(pre) > code,
        :global(body.dark-skin) #__chat_widget_root .bot-message :not(pre) > code {
          background: rgba(0, 0, 0, 0.2);
          border-color: rgba(55, 65, 81, 0.7);
        }
      `}</style>
    </div>
  )
}

/** Minimized launcher button */
function LauncherButton({ onOpen, onDragStart }) {
  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = "auto"
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
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("chatWidgetOffset")
        if (saved) return JSON.parse(saved)
      } catch {}
    }
    return { x: 0, y: 0 }
  })

  const rootRef = useRef(null)
  const offsetRef = useRef(offset)
  const dragRef = useRef({ dragging: false })

  useEffect(() => {
    const el = ensureRoot()
    rootRef.current = el
    el.style.pointerEvents = "auto"
    el.style.transform = `translate(${offset.x}px, ${offset.y}px)`
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    offsetRef.current = offset
    if (rootRef.current) {
      rootRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`
      localStorage.setItem("chatWidgetOffset", JSON.stringify(offset))
    }
  }, [offset])

  useEffect(() => {
    if (!router?.isReady) return
    const openChatParam = router.query?.openChat
    if (!openChatParam) return

    if (router.pathname !== "/") {
      router.replace({ pathname: "/", query: { openChat: openChatParam } }, undefined, { shallow: true })
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
    const moveEvent = e.touches ? "touchmove" : "mousemove"
    const upEvent = e.touches ? "touchend" : "mouseup"

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
    container,
  )
}
