"use client"

import { createPortal } from "react-dom"
import { useState, useEffect, useRef, Fragment } from "react"
import { Minus, ArrowUpRight, Loader2, FileText, X, ChevronDown, Check, Copy, Zap, Brain, Circle } from "lucide-react"
import Image from "next/image"
import { supabase } from "../supabase/supabaseClient" // <-- adjust if your path differs
import { useRouter } from "next/router"

// Markdown + code highlight + LaTeX math rendering (ChatGPT-like)
// Math rendering uses MathJax v3 (loaded from CDN) so you do NOT need KaTeX.
// For syntax highlighting styles, import a highlight.js theme globally (optional).
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
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

// ─── Page-context extraction (yuqi.site only) ───────────────────────────────
const ALLOWED_HOSTS = ["yuqi.site", "www.yuqi.site", "localhost", "127.0.0.1"]

function isAllowedHost() {
  if (typeof window === "undefined") return false
  return ALLOWED_HOSTS.some(h => window.location.hostname === h || window.location.hostname.endsWith("." + h))
}

/**
 * Per-page-type structured extractors — limits token usage.
 * Keys are Next.js router.pathname patterns (bracket form).
 */
const PAGE_EXTRACTORS = {
  "/": () => {
    const sections = []
    const about = document.querySelector("#about-section .profile-box .text")
    if (about) sections.push("About: " + about.innerText.replace(/\s+/g, " ").trim().slice(0, 400))
    document.querySelectorAll("#resume-section .history-item").forEach(el => {
      sections.push(el.innerText.replace(/\s+/g, " ").trim().slice(0, 120))
    })
    document.querySelectorAll("#Blog-section .archive-item .desc").forEach((el, i) => {
      if (i < 4) sections.push("Blog: " + el.innerText.replace(/\s+/g, " ").trim().slice(0, 100))
    })
    return sections.join(" | ")
  },
  "/blog": () => {
    const items = []
    document.querySelectorAll(".archive-item .desc").forEach((el, i) => {
      if (i < 8) items.push(el.innerText.replace(/\s+/g, " ").trim().slice(0, 120))
    })
    return items.join(" | ")
  },
  "/work-single/[id]": () => {
    // Dynamic route: extract project title + content
    const title = document.querySelector("h1,h2,.project-title")?.innerText?.trim() || ""
    const content = document.querySelector(".text[dangerouslySetInnerHTML], .text, article, main")
    const text = content ? content.innerText.replace(/\s+/g, " ").trim().slice(0, 800) : ""
    return [title, text].filter(Boolean).join(" | ")
  },
  "/#market-weather-dashboard": () => {
    const el = document.querySelector("#market-weather-dashboard")
    return el ? el.innerText.replace(/\s+/g, " ").trim().slice(0, 600) : ""
  },
}

/**
 * Extract pre-processed page context.
 * Returns null if not on an allowed host, or if no meaningful content found.
 * @param {string} routerPathname - Next.js router.pathname (bracket form, e.g. "/work-single/[id]")
 */
function extractPageContext(routerPathname) {
  if (typeof window === "undefined" || !isAllowedHost()) return null

  const pageTitle = document.title || routerPathname
  let text = ""

  // Try registered extractor by Next.js pathname pattern
  const extractor = PAGE_EXTRACTORS[routerPathname]
  if (extractor) {
    try { text = extractor() } catch {}
  }

  // Generic fallback: use main/article content, skip nav/footer/chat
  if (!text) {
    const main = document.querySelector("main") || document.querySelector("article") || document.body
    const clone = main.cloneNode(true)
    clone.querySelectorAll("nav,footer,script,style,header,.bot-container").forEach(n => n.remove())
    text = clone.innerText
  }

  // Pre-process: collapse whitespace, deduplicate lines, cap at 1500 chars
  const seen = new Set()
  text = text
    .split(/[\n\r]+/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 10 && !seen.has(l) && seen.add(l))
    .join("\n")
    .slice(0, 1500)

  if (!text) return null

  return {
    url: window.location.href,
    pagePattern: routerPathname,  // e.g. "/work-single/[id]" — stable across all work-single pages
    text,
    pageTitle,
  }
}

/**
 * Detect if text is primarily CJK (Chinese/Japanese/Korean).
 */
function isCJKText(text) {
  if (!text) return false
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length
  return cjkChars > text.length * 0.3
}

/**
 * Parse and extract the [KEYWORDS_EN]...[/KEYWORDS_EN] section from LLM response.
 * Also handles plain "term:" lines at the end of text (not wrapped in tags).
 * Returns { cleanedText, keywords } where keywords is { term: { original, en } }.
 * Handles both "term: Name: explanation" and "term: Name - explanation" formats.
 */
function parseKeywordsEN(text) {
  if (!text) return { cleanedText: text, keywords: {} }
  
  let cleanedText = text
  const keywords = {}
  
  // 1. Try tagged format: [KEYWORDS_EN]...[/KEYWORDS_EN]
  const taggedRegex = /\[KEYWORDS_EN\]([\s\S]*?)\[\/KEYWORDS_EN\]/
  const taggedMatch = text.match(taggedRegex)
  
  if (taggedMatch) {
    const keywordsBlock = taggedMatch[1].trim()
    cleanedText = text.replace(taggedRegex, "").trim()
    
    const lines = keywordsBlock.split("\n").filter(l => l.trim())
    for (const line of lines) {
      // Try colon separator first, then dash
      let colonIdx = line.indexOf(":")
      let separator = ":"
      if (colonIdx < 0) {
        colonIdx = line.indexOf("-")
        separator = "-"
      }
      if (colonIdx > 0) {
        const term = line.slice(0, colonIdx).trim()
        const explanation = line.slice(colonIdx + 1).trim()
        if (term && explanation) {
          keywords[term.toLowerCase()] = { original: term, en: explanation }
        }
      }
    }
    
    // Fallback: comma-separated on single line
    if (Object.keys(keywords).length === 0 && lines.length === 1) {
      const terms = lines[0].split(",").map(t => t.trim()).filter(Boolean)
      for (const term of terms) {
        keywords[term.toLowerCase()] = { original: term, en: term }
      }
    }
  }
  
  // 2. Also strip plain "term:" lines at the end of text (LLM sometimes outputs without tags)
  // Match lines starting with "term:" followed by a name and either colon or dash definition
  // Format: "term: Name - definition" or "term: Name: definition"
  const termLineRegex = /\n\s*term:\s*[^:\-\n]+[\:\-]\s*[^\n]+/gi
  const termMatches = cleanedText.match(termLineRegex)
  if (termMatches) {
    for (const termLine of termMatches) {
      // Parse "term: Name - Definition" or "term: Name: Definition" format
      const withoutPrefix = termLine.replace(/^\n\s*term:\s*/i, "").trim()
      // Find first colon or dash as separator
      const colonIdx = withoutPrefix.indexOf(":")
      const dashIdx = withoutPrefix.indexOf(" - ")
      let sepIdx = -1
      let sepLen = 1
      if (dashIdx >= 0 && (colonIdx < 0 || dashIdx < colonIdx)) {
        sepIdx = dashIdx
        sepLen = 3 // " - " is 3 chars
      } else if (colonIdx >= 0) {
        sepIdx = colonIdx
        sepLen = 1
      }
      if (sepIdx > 0) {
        const term = withoutPrefix.slice(0, sepIdx).trim()
        const explanation = withoutPrefix.slice(sepIdx + sepLen).trim()
        if (term && explanation && !keywords[term.toLowerCase()]) {
          keywords[term.toLowerCase()] = { original: term, en: explanation }
        }
      }
    }
    // Remove all "term:" lines from the displayed text
    cleanedText = cleanedText.replace(termLineRegex, "").trim()
  }
  
  return { cleanedText, keywords }
}

/**
 * Find sentences from pageText that appear (or closely match) in responseText.
 * Returns array of { phrase, context } for highlighting.
 * Works for both English and Chinese/CJK languages.
 * Also matches proper nouns (names, companies) for cross-language scenarios.
 */
function findPageMatches(responseText, pageText, question) {
  if (!responseText || !pageText) return []
  const resp = responseText.toLowerCase()
  const qLower = (question || "").toLowerCase()
  
  const matches = []
  const seen = new Set()
  
  // Meta/profile terms that are not useful keywords to highlight
  // These are site navigation, user profile info, or generic structural terms
  const FILTER_TERMS = new Set([
    "yuqi", "guo", "yuqi guo",  // User name (customizable per site)
    "about", "contact", "home", "portfolio", "projects", "blog", "work", "life", "experience",
    "page", "site", "profile", "section", "menu", "navigation", "footer", "header",
    "education", "background", "resume", "cv", "linkedin", "github"
  ])
  
  // 1. Extract proper nouns from pageText (names, companies, etc.)
  // These are language-agnostic and should match across translations
  // Skip nouns that appear in the question or are meta/profile terms
  const properNouns = pageText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || []
  const uniqueNouns = [...new Set(properNouns.filter(n => n.length >= 4))]
  
  for (const noun of uniqueNouns) {
    const nounLower = noun.toLowerCase()
    
    // Skip if filtered meta term
    if (FILTER_TERMS.has(nounLower)) continue
    
    // Skip if the noun (or any part of it) appears in the question
    const nounParts = nounLower.split(/\s+/)
    const inQuestion = nounParts.some(part => part.length >= 3 && qLower.includes(part))
    if (inQuestion) continue
    
    if (resp.includes(nounLower) && !seen.has(nounLower)) {
      // Find context sentence containing this noun
      const sentences = pageText.split(/[.。!！?？\n]+/).filter(s => s.includes(noun))
      const context = sentences[0]?.trim() || noun
      matches.push({ phrase: noun, context })
      seen.add(nounLower)
    }
  }
  
  // 2. Split pageText into sentences for substring matching
  // Determine min match length per sentence based on its own language, not the response
  const sentences = pageText
    .split(/[.。!！?？\n]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 4)

  for (const sentence of sentences) {
    const sentenceIsCJK = isCJKText(sentence)
    const MIN_MATCH = sentenceIsCJK ? 3 : 15
    const MAX_MATCH = sentenceIsCJK ? 30 : 80
    const lower = sentence.toLowerCase()
    
    for (let len = Math.min(lower.length, MAX_MATCH); len >= MIN_MATCH; len--) {
      let found = false
      for (let start = 0; start <= lower.length - len; start++) {
        const fragment = lower.slice(start, start + len)
        // For non-CJK fragments, require word boundary (no partial word matches like "ing")
        if (!sentenceIsCJK && !/^[a-z]/.test(fragment.charAt(0) === ' ' ? fragment.charAt(1) : fragment.charAt(0))) continue
        if (!sentenceIsCJK && fragment.length < 15) continue  // Hard floor for English fragments
        if (resp.includes(fragment) && !seen.has(fragment)) {
          matches.push({ phrase: sentence.slice(start, start + len), context: sentence })
          seen.add(fragment)
          found = true
          break
        }
      }
      if (found) break
    }
  }
  
  return matches.slice(0, 5)
}

/**
 * Highlight matching phrases on the actual webpage (outside the chat widget).
 * Wraps matching text in <mark class="cw-page-highlight"> and exposes helpers so
 * chat-side keyword clicks can jump to the corresponding page highlight.
 * Highlights persist until explicitly cleaned up.
 */
function highlightPageContent(matches) {
  if (!matches?.length || typeof document === "undefined") {
    return {
      cleanup: () => {},
      scrollToPhrase: () => false,
      hasHighlights: false,
    }
  }
  
  const highlightedNodes = []
  const phraseToMarks = new Map()
  const phraseToContext = new Map() // Store context for each phrase
  const main = document.querySelector("main") || document.querySelector("article") || document.body
  
  // Build phrase -> context lookup
  for (const { phrase, context } of matches) {
    phraseToContext.set(phrase.toLowerCase(), context)
  }
  
  // Skip chat widget container
  const chatContainer = document.querySelector(".bot-container, .launch-button")
  
  // Walk text nodes in main content
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip nodes inside chat widget
      if (chatContainer?.contains(node)) return NodeFilter.FILTER_REJECT
      // Skip script/style/nav/footer
      const parent = node.parentElement
      if (parent?.closest("script, style, nav, footer, .bot-container")) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const nodesToReplace = []
  let textNode
  while ((textNode = walker.nextNode())) {
    for (const { phrase } of matches) {
      const idx = textNode.textContent.toLowerCase().indexOf(phrase.toLowerCase())
      if (idx >= 0) {
        nodesToReplace.push({ node: textNode, phrase, idx })
        break // One match per text node
      }
    }
  }

  let firstMark = null
  for (const { node, phrase, idx } of nodesToReplace) {
    const parent = node.parentNode
    if (!parent) continue
    
    const before = document.createTextNode(node.textContent.slice(0, idx))
    const mark = document.createElement("mark")
    mark.className = "cw-page-highlight"
    mark.dataset.cwPhrase = phrase
    mark.dataset.cwContext = phraseToContext.get(phrase.toLowerCase()) || phrase
    mark.textContent = node.textContent.slice(idx, idx + phrase.length)
    const after = document.createTextNode(node.textContent.slice(idx + phrase.length))
    
    parent.replaceChild(after, node)
    parent.insertBefore(mark, after)
    parent.insertBefore(before, mark)
    
    highlightedNodes.push({ mark, before, after, originalText: node.textContent, parent })

    const phraseKey = phrase.toLowerCase()
    const existing = phraseToMarks.get(phraseKey) || []
    existing.push(mark)
    phraseToMarks.set(phraseKey, existing)

    if (!firstMark) firstMark = mark
  }

  const pulseMark = (mark) => {
    if (!mark) return false
    mark.classList.remove("cw-page-highlight-pulse")
    void mark.offsetWidth
    mark.classList.add("cw-page-highlight-pulse")
    mark.scrollIntoView({ behavior: "smooth", block: "center" })
    return true
  }

  // Scroll to first highlighted element with smooth animation
  if (firstMark) {
    setTimeout(() => {
      pulseMark(firstMark)
    }, 300)
  }

  // Create Wikipedia-style popup for page highlights
  let activePopup = null
  const removePopup = () => {
    if (activePopup) {
      activePopup.remove()
      activePopup = null
    }
  }

  const showPagePopup = (mark) => {
    removePopup()
    const phrase = mark.dataset.cwPhrase || ""
    const context = mark.dataset.cwContext || phrase
    const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(context)
    
    const rect = mark.getBoundingClientRect()
    const popup = document.createElement("div")
    popup.className = "cw-page-highlight-popup"
    popup.innerHTML = `
      <div class="cw-php-content">
        <div class="cw-php-term">${phrase}</div>
        <div class="cw-php-context">${context}</div>
      </div>
    `
    
    // Position popup (appears below the highlight like Wikipedia)
    const safeX = Math.min(Math.max(10, rect.left), window.innerWidth - 320)
    const safeY = rect.bottom + 8 > window.innerHeight - 150 
      ? rect.top - 120 
      : rect.bottom + 8
    popup.style.cssText = `position:fixed;left:${safeX}px;top:${safeY}px;z-index:2147483647;`
    
    document.body.appendChild(popup)
    activePopup = popup
    
    // Close on outside click
    const closeOnOutside = (e) => {
      if (!popup.contains(e.target) && e.target !== mark) {
        removePopup()
        document.removeEventListener("click", closeOnOutside)
      }
    }
    setTimeout(() => document.addEventListener("click", closeOnOutside), 10)
  }

  // Add click handlers to all marks
  const markClickHandlers = new Map()
  for (const { mark } of highlightedNodes) {
    const handler = (e) => {
      e.stopPropagation()
      showPagePopup(mark)
    }
    mark.addEventListener("click", handler)
    mark.style.cursor = "pointer"
    markClickHandlers.set(mark, handler)
  }

  console.log("[PageAwareness] Highlighted", highlightedNodes.length, "elements on page")

  return {
    hasHighlights: highlightedNodes.length > 0,
    scrollToPhrase: (phrase) => {
      const phraseKey = String(phrase || "").toLowerCase()
      const candidates = phraseToMarks.get(phraseKey) || []
      if (candidates.length > 0) return pulseMark(candidates[0])

      for (const [key, marks] of phraseToMarks.entries()) {
        if (phraseKey.includes(key) || key.includes(phraseKey)) {
          return pulseMark(marks[0])
        }
      }
      return false
    },
    cleanup: () => {
      // Remove any active popup
      removePopup()
      
      // Remove click handlers from all marks
      for (const [mark, handler] of markClickHandlers.entries()) {
        try {
          mark.removeEventListener("click", handler)
        } catch {}
      }
      markClickHandlers.clear()
      
      // Restore original text nodes
      for (const { mark, before, after, originalText, parent } of highlightedNodes) {
        try {
          if (!mark.parentNode) continue
          const textNode = document.createTextNode(originalText)
          // Safe cleanup: only replace nodes still attached to this parent
          if (before.parentNode === parent) parent.replaceChild(textNode, before)
          else parent.insertBefore(textNode, mark)
          mark.remove()
          if (after.parentNode === parent) after.remove()
        } catch (e) {
          // DOM may have changed (React re-render), skip gracefully
          console.warn("[PageAwareness] cleanup skip:", e.message)
        }
      }
    },
  }
}

/* ───────── linkify plain URLs ───────── */
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

const storageSafeRemove = (key) => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
  } catch (err) {
    logger.warn("localStorage remove failed", err)
  }
  try {
    window.sessionStorage.removeItem(key)
  } catch {}
}

const clearChatPersistence = () => {
  storageSafeRemove("chatMessages")
  storageSafeRemove("chatSessionLastActive")
  storageSafeRemove("chatSessionId")
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
      bottom: "25px",
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

// Strip [QA], 【QA】, or similar markers from the beginning of content
function stripQAPrefix(text) {
  if (!text) return text
  // Match [QA], 【QA】, [QA], 【QA】, and variations with optional whitespace
  return String(text).replace(/^\s*(\[QA\]|【QA】|\[QA]|【QA】|\[QA：\]|【QA：】)\s*/gi, "")
}

function compactText(s, max = 220) {
  if (s == null) return ""
  const t = String(s)
  return t.length > max ? t.slice(0, max) + "…" : t
}

function safeShort(s, max) {
  return compactText(String(s ?? ""), max).replace(/\s+/g, " ").trim()
}



// ---------- MathJax v3 loader (CDN) ----------
// We load MathJax dynamically so LaTeX delimiters like \( ... \), \[ ... \], $$...$$ render like ChatGPT.
// This avoids KaTeX auto-render bundling/CSS issues in some Next.js setups.
let __mathjaxPromise = null

function ensureMathJaxLoaded() {
  if (typeof window === "undefined") return Promise.resolve(false)
  if (window.MathJax && typeof window.MathJax.typesetPromise === "function") return Promise.resolve(true)
  if (__mathjaxPromise) return __mathjaxPromise

  __mathjaxPromise = new Promise((resolve) => {
    try {
      // Configure once BEFORE loading the script.
      if (!window.MathJax) {
        window.MathJax = {
          // Load chemistry extension so \ce{...} works (mhchem)
          loader: { load: ["[tex]/mhchem"] },
          tex: {
            // Support both $...$ and \(...\) for inline math
            inlineMath: [["$", "$"], ["\\(", "\\)"]],
            // Support both $$...$$ and \[...\] for display math
            displayMath: [["$$", "$$"], ["\\[", "\\]"]],
            processEscapes: true,
            packages: { "[+]": ["mhchem"] },
          },
          chtml: {
            linebreaks: { automatic: true, width: "container" },
          },
          options: {
            // Don't typeset inside code blocks
            skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"],
          },
        }}

      const existing = document.querySelector('script[data-mathjax="v3"]')
      if (existing) {
        if (window.MathJax && typeof window.MathJax.typesetPromise === "function") return resolve(true)
        existing.addEventListener("load", () => resolve(true))
        existing.addEventListener("error", () => resolve(false))
        return
      }

      const script = document.createElement("script")
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"
      script.async = true
      script.dataset.mathjax = "v3"
      script.onload = () => resolve(true)
      script.onerror = () => resolve(false)
      document.head.appendChild(script)
    } catch {
      resolve(false)
    }
  })

  return __mathjaxPromise
}


// --- Fix: keep LaTeX delimiters after react-markdown parsing ---
// ReactMarkdown/CommonMark may treat \[ \] \( \) as escapes and drop the backslash.
// We double-escape them (outside fenced code blocks and inline code) so the final DOM
// still contains \[...\], \(...\) and MathJax can typeset them.
function escapeMathDelimitersOutsideCode(md) {
  const s = String(md || "")

  // 1) Protect fenced code blocks ```...```
  const fenceRe = /```[\s\S]*?```/g

  // 2) Protect inline code `...`
  const inlineCodeRe = /`[^`]*`/g

  // Helper: count consecutive backslashes ending at position `pos` (exclusive)
  const countTrailingBackslashes = (str, pos) => {
    let count = 0
    while (pos > 0 && str[pos - 1] === "\\") {
      count++
      pos--
    }
    return count
  }

  // Escape a delimiter only if preceded by an EVEN number of backslashes
  // (even = not escaped, odd = already escaped by a preceding backslash)
  const escapeDelimiter = (str, openDelim, closeDelim) => {
    let result = ""
    let i = 0
    while (i < str.length) {
      // Check for delimiter (either open or close)
      let matched = null
      if (str.startsWith(openDelim, i)) {
        matched = openDelim
      } else if (str.startsWith(closeDelim, i)) {
        matched = closeDelim
      }

      if (matched) {
        const backslashCount = countTrailingBackslashes(str, i)
        if (backslashCount % 2 === 0) {
          // Even backslashes: delimiter is NOT escaped, add extra backslash
          result += "\\" + matched
        } else {
          // Odd backslashes: delimiter IS escaped, keep as-is
          result += matched
        }
        i += matched.length
      } else {
        result += str[i]
        i++
      }
    }
    return result
  }

  const transformDelims = (chunk) => {
    // Process \( \) then \[ \]
    let out = escapeDelimiter(chunk, "\\(", "\\)")
    out = escapeDelimiter(out, "\\[", "\\]")
    return out
  }

  const transformText = (textChunk) => {
    // Split by inline code spans; transform only non-code segments
    let out = ""
    let last = 0
    let m
    while ((m = inlineCodeRe.exec(textChunk)) !== null) {
      out += transformDelims(textChunk.slice(last, m.index))
      out += m[0]
      last = m.index + m[0].length
    }
    out += transformDelims(textChunk.slice(last))
    return out
  }

  let out = ""
  let last = 0
  let m
  while ((m = fenceRe.exec(s)) !== null) {
    out += transformText(s.slice(last, m.index))
    out += m[0] // keep code fence untouched
    last = m.index + m[0].length
  }
  out += transformText(s.slice(last))
  return out
}


// --- Streaming optimization: only re-typeset when NEW math expressions become complete ---
function stripCodeForMathScan(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
}

function countOrderedPairs(s, openToken, closeToken) {
  let i = 0
  let open = 0
  let pairs = 0
  while (i < s.length) {
    if (s.startsWith(openToken, i)) {
      open++
      i += openToken.length
      continue
    }
    if (s.startsWith(closeToken, i)) {
      if (open > 0) {
        pairs++
        open--
      }
      i += closeToken.length
      continue
    }
    i++
  }
  return pairs
}

function countSingleDollarPairs(s) {
  // Remove $$ first to avoid double counting.
  const t = String(s || "").replace(/\$\$/g, "")
  let open = false
  let pairs = 0
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === "$" && (i === 0 || t[i - 1] !== "\\") && t[i + 1] !== "$") {
      open = !open
      if (!open) pairs++
    }
  }
  return pairs
}

function getMathPairStats(md) {
  const s = stripCodeForMathScan(md)

  // Block math: $$...$$ and \[...\]
  const dbl = [...s.matchAll(/\$\$/g)].length
  const blockDollars = Math.floor(dbl / 2)

  // During rendering we may "double-escape" delimiters (\[ \] \( \)).
  // Prefer counting the double-escaped form if present, otherwise count the normal form.
  const hasDoubleBrackets = s.includes("\\[") || s.includes("\\]")
  const blockBrackets = hasDoubleBrackets
    ? countOrderedPairs(s, "\\[", "\\]")
    : countOrderedPairs(s, "\[", "\]")

  const hasDoubleParens = s.includes("\\(") || s.includes("\\)")
  const inlineParens = hasDoubleParens
    ? countOrderedPairs(s, "\\(", "\\)")
    : countOrderedPairs(s, "\(", "\)")

  // Inline dollars: $...$ (single)
  const inlineDollars = countSingleDollarPairs(s)

  return {
    blockPairs: blockDollars + blockBrackets,
    inlinePairs: inlineParens + inlineDollars,
  }
}

// --- Streaming helper: avoid showing half-written math blocks (looks like gibberish during SSE) ---
function maskIncompleteMathBlocks(md) {
  let s = String(md || "")

  // Incomplete $$...$$ blocks
  const dbl = [...s.matchAll(/\$\$/g)]
  if (dbl.length % 2 === 1) {
    const idx = dbl[dbl.length - 1].index ?? 0
    return s.slice(0, idx) + "\n\n(公式生成中…)\n\n"
  }

  // Incomplete \[...\] display math blocks (after escaping: \\[ and \\])
  const openBracket = s.lastIndexOf("\\\\[")
  const closeBracket = s.lastIndexOf("\\\\]")
  if (openBracket !== -1 && openBracket > closeBracket) {
    return s.slice(0, openBracket) + "\n\n(公式生成中…)\n\n"
  }

  // Incomplete \(...\) inline math blocks (after escaping: \\( and \\))
  const openParen = s.lastIndexOf("\\\\(")
  const closeParen = s.lastIndexOf("\\\\)")
  if (openParen !== -1 && openParen > closeParen) {
    return s.slice(0, openParen) + "\n\n(公式生成中…)\n\n"
  }

  // Incomplete $...$ inline math (single dollar)
  // Count unescaped single $ (not part of $$)
  const withoutDoubleDollar = s.replace(/\$\$/g, "\x00\x00") // placeholder
  let dollarCount = 0
  for (let i = 0; i < withoutDoubleDollar.length; i++) {
    if (withoutDoubleDollar[i] === "$" && (i === 0 || withoutDoubleDollar[i - 1] !== "\\")) {
      dollarCount++
    }
  }
  if (dollarCount % 2 === 1) {
    // Find the last unmatched $
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === "$" && (i === 0 || s[i - 1] !== "\\") && (i === s.length - 1 || s[i + 1] !== "$") && (i === 0 || s[i - 1] !== "$")) {
        return s.slice(0, i) + "\n\n(公式生成中…)\n\n"
      }
    }
  }

  return s
}

// --- Post-process MathJax output: reduce whitespace and prevent overflow beyond bubble edge ---
function tuneMathJaxLayout(root) {
  if (!root) return
  // Clear previous tags
  root.querySelectorAll("p.cw-math-only").forEach((p) => p.classList.remove("cw-math-only"))

  const containers = root.querySelectorAll("mjx-container")
  containers.forEach((c) => {
    // Prevent painting outside bubble; allow horizontal scroll if needed.
    c.style.maxWidth = "100%"
    c.style.overflowX = "auto"
    c.style.overflowY = "hidden"
    c.style.webkitOverflowScrolling = "touch"

    // Display equations behave better as blocks inside narrow bubbles.
    if (c.getAttribute("display") === "true") {
      c.style.display = "block"
      c.style.margin = "0.25em 0"
    }

    // Reduce extra margins created by Markdown wrapping the formula in a <p>.
    const p = c.parentElement
    if (p && p.tagName === "P") {
      const elChildren = Array.from(p.children || [])
      const onlyMath = elChildren.length === 1 && elChildren[0].tagName === "MJX-CONTAINER"
      if (onlyMath) p.classList.add("cw-math-only")
    }
  })
}

// ---------- Markdown renderer (MathJax + copyable code blocks) ----------
function MarkdownMessage({ content, streaming = false }) {
  const rootRef = useRef(null)
  const lastMathStatsRef = useRef({ blockPairs: 0, inlinePairs: 0 })
  const lastTypesetTimeRef = useRef(0)
  const pendingTypesetRef = useRef(null)

  const raw = escapeMathDelimitersOutsideCode(content)

  // In streaming mode, hide incomplete trailing block-math so the UI doesn't look garbled.
  const md = streaming ? maskIncompleteMathBlocks(raw) : raw

  // Cleanup MathJax modifications before React tries to update the DOM
  // This prevents "removeChild" errors when React reconciles
  useEffect(() => {
    const el = rootRef.current
    return () => {
      if (el && window.MathJax?.typesetClear) {
        try {
          window.MathJax.typesetClear([el])
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  }, [])

  useEffect(() => {
    if (!rootRef.current) return

    // In streaming mode: only typeset when NEW math expressions become complete.
    const stats = getMathPairStats(md)
    const last = lastMathStatsRef.current
    const hasNewMath = stats.blockPairs > last.blockPairs || stats.inlinePairs > last.inlinePairs
    
    // Skip if no new math and still streaming
    if (streaming && !hasNewMath) return

    const doTypeset = async () => {
      const ok = await ensureMathJaxLoaded()
      if (!rootRef.current || !ok) return

      const mj = window.MathJax
      if (!mj || typeof mj.typesetPromise !== "function") return

      try {
        // Add fade class before typesetting for smooth transition
        rootRef.current.classList.add("cw-math-rendering")
        
        mj.typesetClear?.([rootRef.current])
        await mj.typesetPromise([rootRef.current])
        
        // Update stats after successful typeset
        lastMathStatsRef.current = {
          blockPairs: Math.max(lastMathStatsRef.current.blockPairs, stats.blockPairs),
          inlinePairs: Math.max(lastMathStatsRef.current.inlinePairs, stats.inlinePairs),
        }
        lastTypesetTimeRef.current = Date.now()
        tuneMathJaxLayout(rootRef.current)
        
        // Remove rendering class after brief delay for fade-in effect
        requestAnimationFrame(() => {
          rootRef.current?.classList.remove("cw-math-rendering")
        })
      } catch {
        // keep silent
      }
    }

    // Clear any pending typeset
    if (pendingTypesetRef.current) {
      cancelAnimationFrame(pendingTypesetRef.current)
      pendingTypesetRef.current = null
    }

    if (!streaming) {
      // Not streaming: typeset immediately with short delay for DOM to settle
      const t = setTimeout(doTypeset, 50)
      return () => clearTimeout(t)
    }

    // Streaming mode: use throttle approach (typeset at most every 80ms)
    const now = Date.now()
    const elapsed = now - lastTypesetTimeRef.current
    const THROTTLE_MS = 80

    if (elapsed >= THROTTLE_MS) {
      // Enough time passed, typeset on next animation frame
      pendingTypesetRef.current = requestAnimationFrame(doTypeset)
    } else {
      // Schedule typeset after remaining throttle time
      const delay = THROTTLE_MS - elapsed
      const t = setTimeout(() => {
        pendingTypesetRef.current = requestAnimationFrame(doTypeset)
      }, delay)
      return () => {
        clearTimeout(t)
        if (pendingTypesetRef.current) {
          cancelAnimationFrame(pendingTypesetRef.current)
        }
      }
    }

    return () => {
      if (pendingTypesetRef.current) {
        cancelAnimationFrame(pendingTypesetRef.current)
      }
    }
  }, [md, streaming])

  const Pre = ({ children }) => {
    const preRef = useRef(null)
    const [copied, setCopied] = useState(false)

    const codeEl = Array.isArray(children) ? children[0] : children
    const className = codeEl?.props?.className || ""
    const lang = (className.match(/language-([a-z0-9_-]+)/i) || [])[1] || "text"

    // ✅ rehype-highlight 可能把代码拆成很多 <span> 节点，直接读 props.children 会变成 [object Object]
    // 所以复制时从 DOM 的 textContent 取“用户看到的纯文本”。
    const getCodeText = () => String(preRef.current?.textContent || "").replace(/\n$/, "")

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(getCodeText())
        setCopied(true)
        setTimeout(() => setCopied(false), 900)
      } catch {}
    }

    return (
      <div className="cw-codeblock">
        <div className="cw-codeblock-head">
          <span className="cw-code-lang">{lang}</span>
          <button type="button" className="cw-code-copy" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre ref={preRef} className="cw-pre">
        {children}
      </pre>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="cw-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: Pre }}>
        {String(md || "")}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Wraps MarkdownMessage and highlights phrases that matched page content.
 * Only rendered when pageMatches is non-empty (i.e. backend confirmed page relevance).
 */
function HighlightedMarkdown({ content, streaming, pageMatches, keywordsEN = {}, onPhraseClick }) {
  const rootRef = useRef(null)

  useEffect(() => {
    if (!rootRef.current || !pageMatches?.length || streaming) return

    // Walk text nodes and wrap matched phrases in <mark class="cw-page-ref">
    const walker = document.createTreeWalker(rootRef.current, NodeFilter.SHOW_TEXT)
    const nodesToReplace = []

    let node
    while ((node = walker.nextNode())) {
      for (const { phrase, context } of pageMatches) {
        const idx = node.textContent.toLowerCase().indexOf(phrase.toLowerCase())
        if (idx >= 0) {
          nodesToReplace.push({ node, phrase, context, idx })
          break
        }
      }
    }

    const markedNodes = []
    for (const { node, phrase, context, idx } of nodesToReplace) {
      const parent = node.parentNode
      if (!parent || !parent.contains(node)) continue  // Skip if node is no longer in DOM
      
      try {
        const before = document.createTextNode(node.textContent.slice(0, idx))
        const mark = document.createElement("mark")
        mark.className = "cw-page-ref"
        mark.dataset.context = context
        mark.dataset.phrase = phrase  // Store phrase for keyword lookup
        mark.textContent = node.textContent.slice(idx, idx + phrase.length)
        const after = document.createTextNode(node.textContent.slice(idx + phrase.length))
        
        // Replace original node with before + mark + after
        parent.replaceChild(after, node)
        parent.insertBefore(mark, after)
        parent.insertBefore(before, mark)
        markedNodes.push({ mark, before, after, originalText: node.textContent, parent })
      } catch (e) {
        console.warn("[HighlightedMarkdown] DOM replace skip:", e.message)
      }
    }

    // Cleanup on unmount or re-render
    return () => {
      for (const { mark, before, after, originalText, parent } of markedNodes) {
        try {
          if (!mark.parentNode) continue
          const textNode = document.createTextNode(originalText)
          if (before.parentNode === parent) parent.replaceChild(textNode, before)
          else parent.insertBefore(textNode, mark)
          mark.remove()
          if (after.parentNode === parent) after.remove()
        } catch (e) {
          // React may have already replaced the DOM
        }
      }
    }
  }, [content, streaming, pageMatches])

  const handleMarkClick = (e) => {
    const mark = e.target.closest(".cw-page-ref")
    if (!mark) return
    const phrase = mark.dataset.phrase
    // Only scroll to page highlight, no popup
    onPhraseClick?.(phrase)
  }

  return (
    <div ref={rootRef} onClick={handleMarkClick}>
      <MarkdownMessage content={content} streaming={streaming} />
    </div>
  )
}

/**
 * Popup card showing the matched page excerpt with visual styling.
 * Page Preview (页面预览) card - displays matched keywords with context from current page.
 * Detects language (CJK vs EN) and shows appropriate label.
 * Also displays English explanations (Keywords EN) for non-English terms.
 * Similar to Wikipedia link preview / tooltip cards.
 */
function PageRefPopup({ context, phrase, keywordsEN = {}, x, y, onClose }) {
  const isCJK = isCJKText(context)
  const label = isCJK ? "🔗 页面预览" : "🔗 Page Preview"
  const closeLabel = isCJK ? "关闭" : "Close"
  
  // Look up English explanation for this phrase
  const phraseLower = (phrase || "").toLowerCase()
  const keywordMatch = keywordsEN[phraseLower] || 
    // Try partial match if exact match fails
    Object.entries(keywordsEN).find(([key]) => 
      phraseLower.includes(key) || key.includes(phraseLower)
    )?.[1]
  
  // Calculate safe position
  const safeX = typeof window !== "undefined" 
    ? Math.min(Math.max(10, x - 140), window.innerWidth - 300) 
    : x
  const safeY = typeof window !== "undefined"
    ? Math.min(Math.max(80, y - 160), window.innerHeight - 240)
    : y - 120

  return (
    <div
      className="cw-page-popup"
      style={{
        position: "fixed",
        left: safeX,
        top: safeY,
        zIndex: 2147483647,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header bar with icon */}
      <div className="cw-page-popup-header">
        <span className="cw-page-popup-icon">🔗</span>
        <span>{label}</span>
        <button
          className="cw-page-popup-close"
          onClick={onClose}
          title={closeLabel}
        >
          ✕
        </button>
      </div>
      
      {/* Content area with quote styling */}
      <div className="cw-page-popup-content">
        <blockquote className="cw-page-popup-quote">
          {context}
        </blockquote>
        
        {/* English explanation section (Wikipedia-style) */}
        {keywordMatch && (
          <div className="cw-page-popup-en-section">
            <div className="cw-page-popup-en-header">
              <span>🌐</span>
              <span>{isCJK ? "英文释义" : "English"}</span>
            </div>
            <div className="cw-page-popup-en-term">
              {keywordMatch.original}
            </div>
            <div className="cw-page-popup-en-explanation">
              {keywordMatch.en}
            </div>
          </div>
        )}
      </div>
      
      {/* Footer with hint */}
      <div className="cw-page-popup-footer">
        {isCJK ? "💡 AI回答引用了此页面内容" : "💡 AI response referenced this page content"}
      </div>
    </div>
  )
}

/* ---------- RAG endpoint helpers ---------- */

function normalizeRagBaseUrl(raw) {
  if (!raw) return ""
  const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://localhost")
  u.hash = ""
  u.search = ""
  // Strip trailing /answer/stream or /answer to get base
  u.pathname = u.pathname.replace(/\/answer(\/stream)?\/?$/, "")
  return u.toString().replace(/\/$/, "")
}

function ragStreamUrl(ragBaseUrl) {
  const u = new URL(ragBaseUrl, window.location.origin)
  // Ensure path ends with /answer/stream
  u.pathname = u.pathname.replace(/\/$/, "") + "/answer/stream"
  return u.toString()
}

async function resolveRagEndpoint() {
  const primaryRaw = process.env.NEXT_PUBLIC_ASSIST_API || process.env.NEXT_PUBLIC_RAG_API || ""
  const primary = primaryRaw ? normalizeRagBaseUrl(primaryRaw) : ""
  const fallback = "/api/rag"

  // If external API is configured (starts with http), use it directly without health check
  if (primary && primary.startsWith("http")) {
    return primary
  }

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
  let res
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      mode: "cors",
      signal,
    })
  } catch (fetchErr) {
    throw fetchErr
  }

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
    // Task 1: Enhanced stage information display - handle specific fields
    const enhancedParts = []
    
    // Handle docsFound or docCount fields
    if (payload.docsFound != null) {
      enhancedParts.push(`found ${payload.docsFound} docs`)
    } else if (payload.docCount != null) {
      enhancedParts.push(`found ${payload.docCount} docs`)
    }
    
    // Handle score field
    if (payload.score != null) {
      const scoreVal = typeof payload.score === "number" ? payload.score.toFixed(2) : payload.score
      enhancedParts.push(`score: ${scoreVal}`)
    }
    
    // Handle relevance field
    if (payload.relevance != null) {
      enhancedParts.push(`relevance: ${payload.relevance}`)
    }
    
    // Handle chunks/results count
    if (payload.chunksFound != null) {
      enhancedParts.push(`${payload.chunksFound} chunks`)
    }
    if (payload.resultsCount != null) {
      enhancedParts.push(`${payload.resultsCount} results`)
    }
    
    // Handle history hits
    if (payload.historyHits != null) {
      enhancedParts.push(`${payload.historyHits} history hits`)
    }
    if (payload.cacheHit != null) {
      enhancedParts.push(payload.cacheHit ? "cache hit" : "cache miss")
    }
    
    // If we found enhanced fields, return them
    if (enhancedParts.length > 0) {
      return enhancedParts.join("  ·  ")
    }
    
    // Fallback to existing generic extraction logic
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

/* ---------- TodoList for deep_plan_done ---------- */
function TodoList({ subtasks, expanded = false }) {
  const [isExpanded, setIsExpanded] = useState(expanded)
  const completed = subtasks.filter(t => typeof t === 'object' ? t.status === 'complete' : false).length
    
  return (
    <div className="todo-container">
      <div className="todo-header" onClick={() => setIsExpanded(!isExpanded)}>
        <ChevronDown className={`todo-chevron ${isExpanded ? "expanded" : ""}`} />
        <span>Todos ({completed}/{subtasks.length})</span>
      </div>
      {isExpanded && (
        <div className="todo-list">
          {subtasks.map((task, idx) => {
            const isComplete = typeof task === 'object' ? task.status === 'complete' : false
            const taskText = typeof task === 'object' ? (task.text || task.name || JSON.stringify(task)) : String(task)
            return (
              <div key={idx} className={`todo-item ${isComplete ? 'completed' : ''}`}>
                {isComplete ? <Check className="todo-icon done" /> : <Circle className="todo-icon pending" />}
                <span className="todo-text">{taskText}</span>
              </div>
            )
          })}
        </div>
      )}
      <style jsx>{`
        .todo-container {
          margin-bottom: 12px;
          border-radius: 10px;
          border: 1px solid rgba(229, 231, 235, 0.9);
          background: rgba(248, 250, 252, 0.95);
          overflow: hidden;
        }
        :global(.dark) .todo-container,
        :global(body.dark-skin) .todo-container {
          border-color: rgba(55, 65, 81, 0.7);
          background: rgba(15, 23, 42, 0.6);
        }
        .todo-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: rgba(17, 24, 39, 0.9);
          transition: background 0.15s ease;
        }
        .todo-header:hover {
          background: rgba(0, 0, 0, 0.04);
        }
        :global(.dark) .todo-header,
        :global(body.dark-skin) .todo-header {
          color: rgba(248, 250, 252, 0.9);
        }
        :global(.dark) .todo-header:hover,
        :global(body.dark-skin) .todo-header:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .todo-chevron {
          width: 16px;
          height: 16px;
          transition: transform 0.2s ease;
          flex-shrink: 0;
        }
        .todo-chevron.expanded {
          transform: rotate(180deg);
        }
        .todo-list {
          border-top: 1px solid rgba(229, 231, 235, 0.6);
          padding: 8px 0;
        }
        :global(.dark) .todo-list,
        :global(body.dark-skin) .todo-list {
          border-top-color: rgba(55, 65, 81, 0.5);
        }
        .todo-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 6px 12px;
          font-size: 12px;
          line-height: 1.4;
          color: rgba(55, 65, 81, 0.95);
        }
        :global(.dark) .todo-item,
        :global(body.dark-skin) .todo-item {
          color: rgba(226, 232, 240, 0.9);
        }
        .todo-item.completed .todo-text {
          text-decoration: line-through;
          opacity: 0.6;
        }
        .todo-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .todo-icon.done {
          color: #10b981;
        }
        .todo-icon.pending {
          color: rgba(156, 163, 175, 0.8);
        }
        .todo-text {
          flex: 1;
          min-width: 0;
          word-break: break-word;
        }
      `}</style>
    </div>
  )
}

/* ---------- Stage toast ---------- */
function StageToast({ step }) {
  if (!step) return null
  
  // Extract a simple, user-friendly summary from rawPayload
  const getPayloadSummary = () => {
    const { rawPayload } = step
    
    if (!rawPayload) return null
    
    // Handle array of tasks/subtasks
    if (Array.isArray(rawPayload)) {
      // Check if it's an array of task objects
      const tasks = rawPayload.filter(item => 
        item && typeof item === "object" && (item.title || item.name || item.text)
      )
      if (tasks.length > 0) {
        return { type: "tasks", tasks }
      }
      return null
    }
    
    if (typeof rawPayload !== "object") return null
    
    // Check if rawPayload itself is a single task object
    if (rawPayload.title && (rawPayload.id || rawPayload.order != null)) {
      return { type: "tasks", tasks: [rawPayload] }
    }
    
    // Check for tasks/subtasks array inside the object
    const taskArray = rawPayload.tasks ?? rawPayload.subtasks ?? rawPayload.steps ?? rawPayload.plan
    if (Array.isArray(taskArray) && taskArray.length > 0) {
      const tasks = taskArray.filter(item => 
        item && typeof item === "object" && (item.title || item.name || item.text)
      )
      if (tasks.length > 0) {
        return { type: "tasks", tasks }
      }
    }
    
    // Look for document/result counts
    const docCount = rawPayload.docsFound ?? rawPayload.docCount ?? rawPayload.count ?? rawPayload.total ?? rawPayload.resultsCount
    if (docCount != null && typeof docCount === "number") {
      return { type: "text", text: `Found ${docCount} document${docCount !== 1 ? "s" : ""}` }
    }
    
    // Look for chunks
    if (rawPayload.chunksFound != null) {
      return { type: "text", text: `Found ${rawPayload.chunksFound} chunk${rawPayload.chunksFound !== 1 ? "s" : ""}` }
    }
    
    // Look for history hits
    if (rawPayload.historyHits != null) {
      return { type: "text", text: `Found ${rawPayload.historyHits} relevant message${rawPayload.historyHits !== 1 ? "s" : ""}` }
    }
    
    return null
  }
  
  const summary = getPayloadSummary()
  
  // Render tasks as a simple numbered list
  const renderTasks = (tasks) => {
    const maxShow = 4
    const shown = tasks.slice(0, maxShow)
    const remaining = tasks.length - maxShow
    
    return (
      <div className="task-list">
        {shown.map((task, idx) => {
          const title = task.title || task.name || task.text || "Task"
          const num = task.order ?? idx + 1
          const done = task.completed || task.done
          return (
            <div key={task.id || idx} className={`task-item ${done ? "done" : ""}`}>
              <span className="task-num">{num}.</span>
              <span className="task-title">{title}</span>
              {done && <Check className="task-check" />}
            </div>
          )
        })}
        {remaining > 0 && (
          <div className="task-more">+{remaining} more</div>
        )}
      </div>
    )
  }
  
  return (
    <div key={step.id} className="stage-toast mb-2">
      <div className="stage-card">
        <div className="row1">
          <span className="spinnerWrap" aria-hidden="true">
            <Loader2 className="spinnerIcon" />
          </span>
          <div className="stage-text">{step.title}</div>
        </div>

        {summary?.type === "text" && (
          <div className="row2">
            <span className="key-value">{summary.text}</span>
          </div>
        )}
        
        {summary?.type === "tasks" && renderTasks(summary.tasks)}

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
          padding: 12px 14px 18px;
          max-height: 180px;
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
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          /* Gradient animation */
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
        .row2 {
          margin-top: 6px;
          min-width: 0;
        }
        .key-value {
          font-size: 13px;
          line-height: 1.3;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
            monospace;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;

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
          background: linear-gradient(90deg, #3b82f6, #ec4899, #10b981);
          animation: indeterminate 1.2s ease-in-out infinite;
        }
        .task-list {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .task-item {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          font-size: 13px;
          line-height: 1.4;
          color: rgba(30, 41, 59, 0.85);
        }
        :global(.dark) .task-item,
        :global(body.dark-skin) .task-item {
          color: rgba(226, 232, 240, 0.85);
        }
        .task-item.done {
          opacity: 0.6;
        }
        .task-item.done .task-title {
          text-decoration: line-through;
        }
        .task-num {
          font-weight: 600;
          color: rgba(59, 130, 246, 0.9);
          min-width: 18px;
          flex-shrink: 0;
        }
        .task-title {
          line-height: 1.4;
          min-width: 0;
        }
        .task-check {
          width: 14px;
          height: 14px;
          color: rgba(16, 185, 129, 0.9);
          flex-shrink: 0;
        }
        .task-more {
          font-size: 12px;
          color: rgba(100, 116, 139, 0.7);
          font-style: italic;
          margin-left: 24px;
        }
        :global(.dark) .task-more,
        :global(body.dark-skin) .task-more {
          color: rgba(226, 232, 240, 0.5);
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

function stripTrailingSlash(s) {
  return String(s || "").replace(/\/+$/, "")
}

// keep "/" separators; encode each segment safely
function encodeStoragePath(path) {
  return String(path || "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")
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

  const url = `${stripTrailingSlash(baseUrl)}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`

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
  return `${stripTrailingSlash(baseUrl)}/storage/v1/object/public/${bucket}/${encodeStoragePath(objectPath)}`
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

function ChatWindow({ onMinimize, onDragStart, routerPathname, pageHighlightRef }) {
  const [messages, setMessages] = useState(() => {
    // If the widget has been inactive for a while, start fresh (no old history).
    if (!isSessionFresh()) {
      clearChatPersistence()
      return []
    }
    const saved = readPersistedJson("chatMessages")
    return Array.isArray(saved) ? saved : []
  })

  const [sessionId, setSessionId] = useState(() => {
    const fresh = isSessionFresh()
    let id = storageSafeGet("chatSessionId") || migrateSessionStorageValue("chatSessionId")
    if (!fresh || !id) {
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
  const MODE_KEY = "cw:mode"
  const [mode, setMode] = useState(() => {
    const saved = storageSafeGet(MODE_KEY)
    return saved === "thinking" ? "thinking" : "regular"
  })
  const isThinking = mode === "thinking"
  const [modeOpen, setModeOpen] = useState(false)

  // composer attachments (max 2 per outgoing message)
  const [composerFiles, setComposerFiles] = useState([])
  // { id, file, name(original), status: "uploading"|"ready"|"error", progress, storagePath, publicUrl }

  // --- Desktop resize (PC only) ---
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

  const [desktopResizable, setDesktopResizable] = useState(false)
  const DEFAULT_WIDGET_SIZE = { w: 520, h: 576 }
  const getDefaultWidgetSize = () => {
    if (typeof window === "undefined") return DEFAULT_WIDGET_SIZE
    const maxW = Math.min(900, window.innerWidth - 24)
    const maxH = Math.min(900, window.innerHeight - 40)
    return {
      w: clamp(DEFAULT_WIDGET_SIZE.w, 360, maxW),
      h: clamp(DEFAULT_WIDGET_SIZE.h, 420, maxH),
    }
  }

  const [widgetSize, setWidgetSize] = useState(() => getDefaultWidgetSize())

  const resizeRef = useRef({
    active: false,
    dir: "both",
    startX: 0,
    startY: 0,
    startW: widgetSize.w,
    startH: widgetSize.h,
    rafId: 0,
    nextW: widgetSize.w,
    nextH: widgetSize.h,
  })

  const scrollRef = useRef(null)
  const ragEndpointRef = useRef(null)
  const abortRef = useRef(null)
  const uploadTimersRef = useRef([])
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const modeWrapRef = useRef(null)
  const touchSession = () => {
    storageSafeSet("chatSessionLastActive", String(Date.now()))
  }

  const resetChatSession = () => {
    // Stop any active stream before wiping.
    if (abortRef.current) {
      try {
        abortRef.current.abort()
      } catch {}
      abortRef.current = null
    }

    clearChatPersistence()

    const newId = generateUUID()
    storageSafeSet("chatSessionId", newId)
    storageSafeSet("chatSessionLastActive", String(Date.now()))
    setSessionId(newId)

    setInput("")
    setComposerFiles([])
    setErrorToast("")
    setLoading(false)
    setUploading(false)
    setMessages([])
  }

  const triggerSiteTour = () => {
    try {
      window.dispatchEvent(new CustomEvent("cw:site-tour:start"))
    } catch {}
  }

  useEffect(() => {
    storageSafeSet(MODE_KEY, mode)
  }, [mode])

  useEffect(() => {
    const onDown = (e) => {
      if (!modeOpen) return
      const el = modeWrapRef.current
      if (el && !el.contains(e.target)) setModeOpen(false)
    }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("touchstart", onDown)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("touchstart", onDown)
    }
  }, [modeOpen])

  useEffect(() => {
    if (errorToast) {
      const timer = setTimeout(() => setErrorToast(""), 3000)
      return () => clearTimeout(timer)
    }
  }, [errorToast])
  // Auto-clean chat history if inactive for > SESSION_TTL_MS (default: 10 minutes).
  useEffect(() => {
    touchSession()

    const tick = setInterval(() => {
      if (loading || uploading) return
      if (!isSessionFresh()) resetChatSession()
    }, 30 * 1000)

    return () => clearInterval(tick)
  }, [loading, uploading])


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
      setMessages([
        {
          id: generateUUID(),
          role: "assistant",
          content: "Welcome! I can start a quick web guide or answer any questions.",
          showGuideCta: true,
        },
      ])
    }
  }, [messages.length])

  useEffect(() => {
    const root = ensureRoot()
    root.style.pointerEvents = "auto"
    return () => {
      root.style.pointerEvents = "none"
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const mq = window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)")

    const sync = () => setDesktopResizable(!!mq.matches)
    sync()

    if (mq.addEventListener) mq.addEventListener("change", sync)
    else mq.addListener(sync)

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", sync)
      else mq.removeListener(sync)
    }
  }, [])

  useEffect(() => {
    if (!desktopResizable) return
    setWidgetSize(getDefaultWidgetSize())
  }, [desktopResizable])

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
      try {
        pageHighlightRef.current?.cleanup?.()
      } catch {}
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

  const startResize = (e, dir) => {
    if (!desktopResizable) return
    e.preventDefault()
    e.stopPropagation()

    resizeRef.current = {
      active: true,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      startW: widgetSize.w,
      startH: widgetSize.h,
      rafId: 0,
      nextW: widgetSize.w,
      nextH: widgetSize.h,
    }

    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor =
      dir === "w" || dir === "e" ? "ew-resize" : dir === "h" ? "ns-resize" : "nwse-resize"

    const onMove = (ev) => {
      const { startX, startY, startW, startH } = resizeRef.current
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY

      let nextW = startW
      let nextH = startH

      if (dir === "w" || dir === "both") nextW = startW - dx
      if (dir === "e") nextW = startW + dx
      if (dir === "h" || dir === "both") nextH = startH - dy

      const maxW = Math.min(900, window.innerWidth - 24)
      const maxH = Math.min(900, window.innerHeight - 40)

      nextW = clamp(nextW, 360, maxW)
      nextH = clamp(nextH, 420, maxH)

      resizeRef.current.nextW = nextW
      resizeRef.current.nextH = nextH

      if (!resizeRef.current.rafId) {
        resizeRef.current.rafId = window.requestAnimationFrame(() => {
          resizeRef.current.rafId = 0
          setWidgetSize({ w: resizeRef.current.nextW, h: resizeRef.current.nextH })
        })
      }
    }

    const onUp = () => {
      resizeRef.current.active = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)

      if (resizeRef.current.rafId) {
        window.cancelAnimationFrame(resizeRef.current.rafId)
        resizeRef.current.rafId = 0
      }

      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
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
              rawPayload: obj?.payload,
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
    const finalContent = String(rawFinal || "")

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, content: finalContent, isHtml: false, streaming: false, thinkingNow: null, planPayload: m.planPayload } : m,
      ),
    )

    onFinal?.(finalContent)
  }

  const startRagSSE = async ({ question, fileUrls, assistantId, onFinal, requestMode, currentSessionId, pageContext }) => {
    const base = ragEndpointRef.current || (await resolveRagEndpoint())
    const streamUrl = ragStreamUrl(base)

    const controller = new AbortController()
    abortRef.current = controller

    let answerBuf = ""
    let finalized = false
    let pageRelevanceResult = null  // Store page relevance from answer_final
    
    // Use the passed requestMode to determine DEEPTHINKING vs FAST
    const useDeepThinking = requestMode === "thinking"

    setStage(assistantId, "start", { message: "Init", payload: { ts: Date.now() } })

    const body = {
      question,
      sessionId: currentSessionId,
      mode: useDeepThinking ? "DEEPTHINKING" : "FAST",
      scopeMode: useDeepThinking ? "GENERAL" : "OWNER_ONLY",
      ...(Array.isArray(fileUrls) && fileUrls.length > 0 ? { fileUrls } : {}),
      // Send pageContext inside ext map — no backend schema change needed
      ...(pageContext ? { ext: { currentPageUrl: pageContext.url, currentPagePattern: pageContext.pagePattern, pageContextText: pageContext.text, pageTitle: pageContext.pageTitle } } : {}),
    }

    await postSSE(streamUrl, body, {
      signal: controller.signal,
      onEvent: (evt) => {
        const obj = safeJsonParse(evt.data) || {}
        const stage = obj.stage || evt.event || "message"

        if (stage === "answer_delta") {
          // Backend sends { payload: { delta: "..." } }
          const delta = typeof obj.payload?.delta === "string" ? obj.payload.delta : ""
          if (delta) {
            answerBuf += delta
            // Strip [QA] prefix markers and [KEYWORDS_EN] section before displaying
            let cleanContent = stripQAPrefix(answerBuf)
            // Hide [KEYWORDS_EN]...[/KEYWORDS_EN] and partial tags during streaming
            cleanContent = cleanContent.replace(/\[KEYWORDS_EN\][\s\S]*?(\[\/KEYWORDS_EN\]|$)/g, "").trim()
            // Hide plain "term:" lines (LLM sometimes outputs without tags) - handles both ":" and " - " separators
            cleanContent = cleanContent.replace(/\n\s*term:\s*[^:\-\n]+[\:\-][^\n]*/gi, "").trim()
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: cleanContent, streaming: true } : m)))
          }
          // Don't update stage display for answer_delta - just accumulate content
          return
        }

        if (stage === "answer_final") {
          finalized = true
          clearStage(assistantId)
          // Backend sends { payload: { answer: "..." } }
          const rawFinalAnswer = typeof obj.payload?.answer === "string" ? obj.payload.answer : answerBuf
          // Strip [QA] prefix markers from final answer
          const strippedQA = stripQAPrefix(rawFinalAnswer)
          
          // Parse and extract [KEYWORDS_EN] section (bilingual keyword explanations)
          const { cleanedText: finalAnswer, keywords: keywordsEN } = parseKeywordsEN(strippedQA)
          if (Object.keys(keywordsEN).length > 0) {
            console.log("[PageAwareness] Extracted keywords:", keywordsEN)
          }
          
          // Read pageRelevance from backend (informational, not required for highlighting)
          pageRelevanceResult = obj.payload?.pageRelevance || null
          
          // Trigger page highlight if we have page context — find matching text regardless of KB results
          // The highlighting is based on text matching between LLM response and current page content
          if (pageContext?.text) {
            const matches = findPageMatches(finalAnswer, pageContext.text, question)
            // Only update if we found actual matches
            if (matches.length > 0) {
              console.log("[PageAwareness] Found", matches.length, "matches to highlight", matches)
              
              // 1. Highlight text in chat response (include keywordsEN for popup)
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, pageMatches: matches, pageContextText: pageContext.text, keywordsEN }
                  : m
              ))
              
              // 2. Highlight matching content on the actual webpage and keep it persistent
              try {
                pageHighlightRef.current?.cleanup?.()
              } catch {}
              pageHighlightRef.current = highlightPageContent(matches)
            }
          }
          
          finalizeAssistant(assistantId, finalAnswer, onFinal)

          return
        }

        // Task 3: Handle deep_plan_done stage with subtasks for TodoList
        if (stage === "deep_plan_done") {
          if (obj.payload?.subtasks) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      planPayload: {
                        subtasks: obj.payload.subtasks,
                        status: obj.payload.status,
                        subtaskCount: obj.payload.subtaskCount,
                        displayType: obj.payload.displayType,
                      },
                    }
                  : m,
              ),
            )
          }
        }

        // Task 2: Ensure all stages including History/redis are processed
        // Do not filter out any stage names - pass all to setStage
        setStage(assistantId, stage, obj)
      },
    })

    if (!finalized && answerBuf) {
      clearStage(assistantId)
      finalizeAssistant(assistantId, answerBuf, onFinal)
    }
  }

  const jumpToHighlightedPhrase = (phrase) => {
    return pageHighlightRef.current?.scrollToPhrase?.(phrase)
  }

  const sendMessage = async (e) => {
    e?.preventDefault?.()
    touchSession()

    try {
      pageHighlightRef.current?.cleanup?.()
    } catch {}
    pageHighlightRef.current = { cleanup: () => {}, scrollToPhrase: () => false, hasHighlights: false }

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

    const baseQuestion = visibleText
    const requestMode = mode
    const fileUrls = readyFiles.map((f) => f.url)
    
    // Capture page context at send time
    const pageCtx = extractPageContext(routerPathname || "/")

    const finalizeAndPersist = async (finalAnswer) => {
      try {
        const dbMode = requestMode === "thinking" ? "deepthinking" : "regular"
        await supabase.from("Chat").insert([{ question: baseQuestion, answer: finalAnswer, mode: dbMode }])
      } catch (dbErr) {
        logger.warn("Supabase insert failed", dbErr)
      }
      setLoading(false)
    }

    try {
      await startRagSSE({ question: baseQuestion, fileUrls, assistantId, requestMode, currentSessionId: sessionId, onFinal: finalizeAndPersist, pageContext: pageCtx })
    } catch (err) {
      console.error("[ChatWidget] SSE failed:", err)
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
    <div
      className="bot-container relative mb-6 flex flex-col w-screen md:w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900 dark:ring-gray-700"
      style={
        desktopResizable
          ? {
            width: `${widgetSize.w}px`,
            height: `${widgetSize.h}px`,
            maxWidth: `${widgetSize.w}px`,
            maxHeight: "none",
          }
          : undefined
      }
    >
      {desktopResizable ? (
        <>
          <div className="cw-resize-handle cw-resize-left" onMouseDown={(e) => startResize(e, "w")} />
          <div className="cw-resize-handle cw-resize-right" onMouseDown={(e) => startResize(e, "e")} />
          <div className="cw-resize-handle cw-resize-top" onMouseDown={(e) => startResize(e, "h")} />
          <div className="cw-resize-handle cw-resize-corner" onMouseDown={(e) => startResize(e, "both")} />
        </>
      ) : null}
      <header
        className="bot-header shrink-0 flex items-center justify-between border-b border-gray-200 px-2 py-2 dark:border-gray-700"
        onMouseDown={onDragStart}
      >
        <div className="cw-header-left">
          <div
            className="cw-brand"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <img src="/assets/images/chatbot_pot_thinking.gif" alt="Chat Bot" />
            <span className="cw-title">Mr Pot</span>
          </div>

          <div ref={modeWrapRef} className="cw-mode-wrap">
            <button
              type="button"
              className={"cw-mode-pill " + (isThinking ? "deep" : "fast")}
              onClick={() => setModeOpen((v) => !v)}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              aria-haspopup="menu"
              aria-expanded={modeOpen ? "true" : "false"}
            >
              {isThinking ? <Brain className="cw-mode-ico" /> : <Zap className="cw-mode-ico" />}
              <span className="cw-mode-pill-label">{isThinking ? "Deep" : "Fast"}</span>
              <ChevronDown className={"cw-chev " + (modeOpen ? "open" : "")} />
            </button>

            {modeOpen ? (
              <div className="cw-mode-menu" role="menu">
                <button
                  type="button"
                  className="cw-mode-item"
                  role="menuitem"
                  onClick={() => {
                    setMode("regular")
                    setModeOpen(false)
                  }}
                >
                  <span className="cw-mode-item-head">
                    <Zap className="cw-mode-item-ico" />
                    <span className="cw-mode-left">
                      <span className="cw-mode-name">Fast</span>
                      <span className="cw-mode-desc">Faster / fewer resources</span>
                    </span>
                  </span>
                  {mode === "regular" ? <Check className="cw-check" /> : null}
                </button>

                <button
                  type="button"
                  className="cw-mode-item"
                  role="menuitem"
                  onClick={() => {
                    setMode("thinking")
                    setModeOpen(false)
                  }}
                >
                  <span className="cw-mode-item-head">
                    <Brain className="cw-mode-item-ico" />
                    <span className="cw-mode-left">
                      <span className="cw-mode-name">Deep</span>
                      <span className="cw-mode-desc">Deeper reasoning / more tool steps</span>
                    </span>
                  </span>
                  {mode === "thinking" ? <Check className="cw-check" /> : null}
                </button>
              </div>
            ) : null}
          </div>
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
          <div key={m.id} className={m.role === "user" ? "cw-msg-row cw-user" : "cw-msg-row cw-bot"}>
            <div
              className={m.role === "user" ? "user-message cw-bubble cw-bubble-user" : "bot-message cw-bubble cw-bubble-bot"}
            >
              {m.role === "user" && Array.isArray(m.attachments) && m.attachments.length > 0 ? (
                <div className="cw-msg-files">
                  {m.attachments.map((f) => (
                    <AttachmentChip key={f.url || f.name} name={f.name} href={f.url} status="ready" />
                  ))}
                </div>
              ) : null}

              {m.role === "assistant" && m.streaming && m.thinkingNow ? <StageToast step={m.thinkingNow} /> : null}

              {/* Task 3: Render TodoList when planPayload with subtasks is present */}
              {m.role === "assistant" && m.planPayload?.subtasks?.length > 0 ? (
                <TodoList subtasks={m.planPayload.subtasks} expanded={true} />
              ) : null}

              {m.showGuideCta ? (
                <div className="cw-guide-message">
                  <p className="cw-guide-title">Hi! How can I help you today?</p>
                  <p className="cw-guide-copy">
                    I'm Mr. Pot, Yuqi's web AI agent.
                  </p>
                  <div className="cw-guide-actions">
                    <button type="button" className="cw-guide-btn" onClick={triggerSiteTour}>
                      Start web guide
                      <ArrowUpRight className="cw-guide-ico" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : m.role === "assistant" ? (
                m.streaming ? (
                  m.content === "" ? (
                    <TypingIndicator />
                  ) : (
                    <>
                      <MarkdownMessage key={`${m.id}-streaming`} content={m.content} streaming />
                      <StreamingCursor />
                    </>
                  )
                ) : (
                  m.pageMatches?.length > 0
                    ? <HighlightedMarkdown key={`${m.id}-final`} content={m.content} streaming={false} pageMatches={m.pageMatches} keywordsEN={m.keywordsEN} onPhraseClick={jumpToHighlightedPhrase} />
                    : <MarkdownMessage key={`${m.id}-final`} content={m.content} />
                )
              ) : (
                renderTextWithLinks(m.content)
              )}
            </div>
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
            onChange={(e) => {
              setInput(e.target.value)
              touchSession()
            }}
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
              touchSession()
              pickFiles(e.target.files)
              e.target.value = ""
            }}
            hidden
          />
        </div>
      </form>

      <style jsx global>{`
        #__chat_widget_root .bot-container {
          height: min(68vh, 576px);
          max-height: 576px;
        }



        /* ===== MathJax / Markdown tuning ===== */
        #__chat_widget_root .cw-md {
          line-height: 1.55;
        }
        #__chat_widget_root .cw-md.cw-math-rendering mjx-container {
          opacity: 0.7;
          transition: opacity 150ms ease-out;
        }
        #__chat_widget_root .cw-md mjx-container {
          opacity: 1;
          transition: opacity 150ms ease-out;
        }
        #__chat_widget_root .cw-md p {
          margin: 0.55em 0;
        }
        #__chat_widget_root .cw-md p:first-child {
          margin-top: 0;
        }
        #__chat_widget_root .cw-md p:last-child {
          margin-bottom: 0;
        }
        #__chat_widget_root .cw-md p.cw-math-only {
          margin: 0.25em 0;
        }
        
        /* Headings */
        #__chat_widget_root .cw-md h1,
        #__chat_widget_root .cw-md h2,
        #__chat_widget_root .cw-md h3,
        #__chat_widget_root .cw-md h4,
        #__chat_widget_root .cw-md h5,
        #__chat_widget_root .cw-md h6 {
          margin: 0.8em 0 0.4em 0;
          font-weight: 600;
          line-height: 1.3;
        }
        #__chat_widget_root .cw-md h1:first-child,
        #__chat_widget_root .cw-md h2:first-child,
        #__chat_widget_root .cw-md h3:first-child {
          margin-top: 0;
        }
        #__chat_widget_root .cw-md h1 { font-size: 1.3em; }
        #__chat_widget_root .cw-md h2 { font-size: 1.2em; }
        #__chat_widget_root .cw-md h3 { font-size: 1.1em; }
        #__chat_widget_root .cw-md h4 { font-size: 1em; }
        #__chat_widget_root .cw-md h5 { font-size: 0.95em; }
        #__chat_widget_root .cw-md h6 { font-size: 0.9em; }
        
        /* Lists */
        #__chat_widget_root .cw-md ul,
        #__chat_widget_root .cw-md ol {
          margin: 0.5em 0;
          padding-left: 1.5em;
        }
        #__chat_widget_root .cw-md li {
          margin: 0.25em 0;
        }
        #__chat_widget_root .cw-md li > ul,
        #__chat_widget_root .cw-md li > ol {
          margin: 0.2em 0;
        }
        #__chat_widget_root .cw-md ul {
          list-style-type: disc;
        }
        #__chat_widget_root .cw-md ol {
          list-style-type: decimal;
        }
        #__chat_widget_root .cw-md li::marker {
          color: #6b7280;
        }
        :global(body.dark-skin) #__chat_widget_root .cw-md li::marker,
        :global(.dark) #__chat_widget_root .cw-md li::marker {
          color: #9ca3af;
        }
        
        /* Inline styles */
        #__chat_widget_root .cw-md strong {
          font-weight: 600;
        }
        #__chat_widget_root .cw-md em {
          font-style: italic;
        }
        
        /* Blockquote */
        #__chat_widget_root .cw-md blockquote {
          margin: 0.5em 0;
          padding: 0.3em 0.8em;
          border-left: 3px solid #d1d5db;
          background: rgba(0, 0, 0, 0.03);
          color: #4b5563;
        }
        :global(body.dark-skin) #__chat_widget_root .cw-md blockquote,
        :global(.dark) #__chat_widget_root .cw-md blockquote {
          border-left-color: #4b5563;
          background: rgba(255, 255, 255, 0.05);
          color: #d1d5db;
        }
        
        /* Horizontal rule */
        #__chat_widget_root .cw-md hr {
          margin: 0.8em 0;
          border: none;
          border-top: 1px solid #e5e7eb;
        }
        :global(body.dark-skin) #__chat_widget_root .cw-md hr,
        :global(.dark) #__chat_widget_root .cw-md hr {
          border-top-color: #374151;
        }
        
        /* Tables */
        #__chat_widget_root .cw-md table {
          border-collapse: collapse;
          margin: 0.5em 0;
          font-size: 0.9em;
          width: 100%;
        }
        #__chat_widget_root .cw-md th,
        #__chat_widget_root .cw-md td {
          border: 1px solid #d1d5db;
          padding: 0.4em 0.6em;
          text-align: left;
        }
        #__chat_widget_root .cw-md th {
          background: rgba(0, 0, 0, 0.04);
          font-weight: 600;
        }
        :global(body.dark-skin) #__chat_widget_root .cw-md th,
        :global(.dark) #__chat_widget_root .cw-md th {
          background: rgba(255, 255, 255, 0.06);
          border-color: #4b5563;
        }
        :global(body.dark-skin) #__chat_widget_root .cw-md td,
        :global(.dark) #__chat_widget_root .cw-md td {
          border-color: #4b5563;
        }
        
        #__chat_widget_root .cw-md mjx-container {
          max-width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }
        #__chat_widget_root .cw-md mjx-container[display="true"] {
          display: block;
          margin: 0.25em 0 !important;
        }
        #__chat_widget_root .cw-md mjx-container::-webkit-scrollbar {
          height: 6px;
        }
        #__chat_widget_root .cw-md mjx-container::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.55);
          border-radius: 999px;
        }

        /* ===== Desktop resize handles (show on hover only) ===== */
        #__chat_widget_root .cw-resize-handle {
          position: absolute;
          z-index: 60;
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
        }

        #__chat_widget_root .bot-container:hover .cw-resize-handle {
          opacity: 1;
          pointer-events: auto;
        }

        #__chat_widget_root .cw-resize-left {
          left: -6px;
          top: 14px;
          bottom: 14px;
          width: 12px;
          cursor: ew-resize;
        }

        #__chat_widget_root .cw-resize-right {
          right: -6px;
          top: 14px;
          bottom: 14px;
          width: 12px;
          cursor: ew-resize;
        }

        #__chat_widget_root .cw-resize-top {
          top: -6px;
          left: 14px;
          right: 14px;
          height: 12px;
          cursor: ns-resize;
        }

        #__chat_widget_root .cw-resize-corner {
          top: -6px;
          left: -6px;
          width: 14px;
          height: 14px;
          cursor: nwse-resize;
        }

        @media (max-width: 767px), (hover: none), (pointer: coarse) {
          #__chat_widget_root .cw-resize-handle {
            display: none !important;
          }
        }

        :global(body.dark-skin) #__chat_widget_root .bot-container,
        :global(.dark) #__chat_widget_root .bot-container {
          background-color: #0f172a !important;
          border-color: transparent !important;
          box-shadow: none !important;
          color: #e5e7eb;
        }

        :global(body.dark-skin) #__chat_widget_root .bot-header,
        :global(.dark) #__chat_widget_root .bot-header {
          background-color: #0f172a;
          border-color: #1f2937;
          color: #e5e7eb;
        }

        :global(body.dark-skin) #__chat_widget_root .bot-messages,
        :global(.dark) #__chat_widget_root .bot-messages {
          background: linear-gradient(180deg, #0b1220 0%, #0f172a 100%);
        }

        :global(body.dark-skin) #__chat_widget_root .input-area,
        :global(.dark) #__chat_widget_root .input-area {
          border-top-color: rgba(255, 255, 255, 0.12) !important;
        }

        :global(body.dark-skin) #__chat_widget_root,
        :global(.dark) #__chat_widget_root {
          background: transparent !important;
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
          min-height: 0 !important; /* critical for scroll area in flex layouts */
          overflow-y: auto !important;
        }

        #__chat_widget_root .input-area {
          flex: 0 0 auto !important;
          margin-top: auto !important; /* push input area to the bottom */
        }

        @supports (height: 100dvh) {
          #__chat_widget_root .bot-container {
            height: min(68dvh, 576px);
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

        /* ===== Bubble scaling (CSS-only; follows ChatWidget width) ===== */
        #__chat_widget_root {
          --cw-bubble-max: 82%;
        }

        #__chat_widget_root .bot-messages {
          width: 100%;
        }

        #__chat_widget_root .cw-msg-row {
          display: flex;
          width: 100%;
        }
        #__chat_widget_root .cw-msg-row.cw-user {
          justify-content: flex-end;
        }
        #__chat_widget_root .cw-msg-row.cw-bot {
          justify-content: flex-start;
        }

        #__chat_widget_root .cw-bubble {
          box-sizing: border-box;
          /*
            Bubble should align to the side and grow/shrink with ChatWidget width.
            Use max-width as a percentage (scales with widget), but let width shrink-to-content
            to avoid huge empty space for short user messages.
          */
          max-width: var(--cw-bubble-max);
          width: auto;
          display: inline-block;
          flex: 0 1 auto;
          min-width: 0;
        }

        #__chat_widget_root .cw-bubble-user {
          background: #2563eb;
          border: 1px solid rgba(29, 78, 216, 0.8);
          color: #ffffff;
          padding: 8px 12px;
          font-size: 14px;
          line-height: 1.45;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.10);
        }

        #__chat_widget_root .cw-bubble-bot {
          background: #f9fafb;
          border: 1px solid rgba(229, 231, 235, 0.85);
          color: #111827;
          padding: 8px 12px;
          font-size: 14px;
          line-height: 1.45;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-bubble-bot,
        :global(.dark) #__chat_widget_root .cw-bubble-bot {
          background: rgba(31, 41, 55, 0.90);
          border-color: rgba(55, 65, 81, 0.90);
          color: #f3f4f6;
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

        .cw-guide-message {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .cw-guide-title {
          margin: 0;
          font-weight: 700;
          font-size: 14px;
          color: inherit;
        }

        .cw-guide-copy {
          margin: 0;
          font-size: 13px;
          line-height: 1.4;
          color: var(--cw-input-placeholder);
        }

        .cw-guide-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        #__chat_widget_root .cw-guide-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 12px;
          background: linear-gradient(135deg, #2563eb, #22d3ee);
          color: #f8fafc;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.01em;
          border: none;
          cursor: pointer;
          box-shadow: 0 10px 20px rgba(37, 99, 235, 0.25);
          transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
        }

        #__chat_widget_root .cw-guide-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 22px rgba(34, 211, 238, 0.32);
          filter: brightness(1.02);
        }

        #__chat_widget_root .cw-guide-btn:active {
          transform: translateY(0);
          box-shadow: 0 8px 16px rgba(37, 99, 235, 0.2);
        }

        #__chat_widget_root .cw-guide-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.35), 0 10px 20px rgba(34, 211, 238, 0.3);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-guide-btn {
          background: linear-gradient(135deg, #38bdf8, #7c3aed);
          color: #0b1224;
          box-shadow: 0 10px 20px rgba(124, 58, 237, 0.25);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-guide-btn:hover {
          box-shadow: 0 12px 22px rgba(56, 189, 248, 0.3);
        }

        .cw-guide-ico {
          width: 16px;
          height: 16px;
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

        :global(body.dark-skin) #__chat_widget_root,
        :global(.dark) #__chat_widget_root {
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

        /* ===== Mode drawer ===== */
        #__chat_widget_root .cw-mode-wrap {
          position: relative;
        }

        #__chat_widget_root .cw-mode-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          cursor: pointer;
          color: inherit;
        }

        #__chat_widget_root .cw-mode-btn:hover {
          background: rgba(243, 244, 246, 0.9);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-btn:hover {
          background: rgba(31, 41, 55, 0.8);
        }

        #__chat_widget_root .cw-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        #__chat_widget_root .cw-brand {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        #__chat_widget_root .cw-brand img {
          flex: 0 0 auto;
        }

        #__chat_widget_root .cw-mode-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          cursor: pointer;
          color: inherit;
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
          transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
        }

        #__chat_widget_root .cw-mode-pill:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
        }

        #__chat_widget_root .cw-mode-ico {
          width: 16px;
          height: 16px;
          flex: 0 0 auto;
          opacity: 0.95;
        }

        /* Fast (gray) */
        #__chat_widget_root .cw-mode-pill.fast {
          background: rgba(243, 244, 246, 0.9);
        }

        #__chat_widget_root .cw-mode-pill.fast:hover {
          background: rgba(229, 231, 235, 0.95);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.fast {
          background: rgba(31, 41, 55, 0.8);
          color: rgba(248, 250, 252, 0.92);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.fast:hover {
          background: rgba(31, 41, 55, 0.95);
        }

        /* Deep (pill) */
        #__chat_widget_root .cw-mode-pill.deep {
          border-radius: 999px;
          background: rgba(245, 158, 11, 0.14);
          border-color: rgba(245, 158, 11, 0.28);
          color: rgba(217, 119, 6, 0.98);
        }

        #__chat_widget_root .cw-mode-pill.deep:hover {
          background: rgba(245, 158, 11, 0.2);
          border-color: rgba(245, 158, 11, 0.34);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.deep {
          border-radius: 999px;
          background: rgba(245, 158, 11, 0.18);
          border-color: rgba(245, 158, 11, 0.32);
          color: rgba(251, 191, 36, 0.96);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.deep:hover {
          background: rgba(245, 158, 11, 0.24);
          border-color: rgba(245, 158, 11, 0.4);
        }

        #__chat_widget_root .cw-mode-item-head {
          display: inline-flex;
          align-items: flex-start;
          gap: 10px;
          min-width: 0;
        }

        #__chat_widget_root .cw-mode-item-ico {
          width: 16px;
          height: 16px;
          flex: 0 0 auto;
          opacity: 0.9;
          margin-top: 1px;
        }

        #__chat_widget_root .cw-title {
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
          font-size: 22px;
          font-weight: 400;
        }

        #__chat_widget_root .cw-title-fade {
          opacity: 0.55;
          font-weight: 600;
        }

        #__chat_widget_root .cw-chev {
          width: 22px;
          height: 22px;
          opacity: 0.95;
          margin-left: 2px;
          transition: transform 160ms ease, filter 160ms ease;
        }

        #__chat_widget_root .cw-chev.open {
          transform: rotate(180deg);
          filter: drop-shadow(0 0 4px rgba(59, 130, 246, 0.6));
        }

        #__chat_widget_root .cw-mode-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          width: 240px;
          z-index: 200;
          border-radius: 14px;
          border: 1px solid rgba(229, 231, 235, 0.95);
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
          overflow: hidden;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-menu {
          border-color: rgba(55, 65, 81, 0.7);
          background: rgba(15, 23, 42, 0.95);
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.45);
        }

        #__chat_widget_root .cw-mode-item {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          color: inherit;
        }

        #__chat_widget_root .cw-mode-item:hover {
          background: rgba(243, 244, 246, 0.9);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-item:hover {
          background: rgba(31, 41, 55, 0.7);
        }

        #__chat_widget_root .cw-mode-left {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        #__chat_widget_root .cw-mode-name {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.1;
        }

        #__chat_widget_root .cw-mode-desc {
          font-size: 12px;
          opacity: 0.7;
          line-height: 1.2;
        }

        #__chat_widget_root .cw-check {
          width: 16px;
          height: 16px;
          opacity: 0.85;
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

        #__chat_widget_root .cw-tour-cta {
          position: sticky;
          top: 10px;
          z-index: 50;
          display: flex;
          justify-content: flex-end;
          pointer-events: none;
        }

        #__chat_widget_root .cw-tour-btn {
          pointer-events: auto;
          border: 1px solid rgba(229, 231, 235, 0.9);
          background-color: rgb(243, 244, 246);
          box-shadow: 0 .5rem 1rem rgba(0, 0, 0, .15) !important;
          color: rgba(17, 24, 39, 0.95);
          border-radius: 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-tour-btn {
          background: rgba(15, 23, 42, 0.65);
          border-color: rgba(255, 255, 255, 0.18);
          color: rgba(248, 250, 252, 0.92);
        }

        #__chat_widget_root .cw-tour-btn {
          transition: transform 500ms ease, box-shadow 500ms ease, background-color 500ms ease, border-color 500ms ease,
          color 500ms ease;
        }

        #__chat_widget_root .cw-tour-btn:not(:hover) {
          transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease,
          color 180ms ease;
        }


        #__chat_widget_root .cw-tour-btn:hover {
          background-color: rgb(249, 250, 251);
          border-color: rgba(209, 213, 219, 0.95);
          box-shadow: 0 0.75rem 1.4rem rgba(0, 0, 0, 0.18) !important;
          transform: translateY(-1px);
        }

        #__chat_widget_root .cw-tour-btn:active {
          transform: translateY(0px);
          box-shadow: 0 0.55rem 1.1rem rgba(0, 0, 0, 0.16) !important;
        }

        #__chat_widget_root .cw-tour-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35), 0 0.75rem 1.4rem rgba(0, 0, 0, 0.18) !important;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-tour-btn:hover {
          background: rgba(30, 41, 59, 0.72);
          border-color: rgba(255, 255, 255, 0.22);
          box-shadow: 0 0.8rem 1.6rem rgba(0, 0, 0, 0.45) !important;
          transform: translateY(-1px);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-tour-btn:active {
          transform: translateY(0px);
          box-shadow: 0 0.65rem 1.3rem rgba(0, 0, 0, 0.4) !important;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-tour-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(147, 197, 253, 0.35), 0 0.8rem 1.6rem rgba(0, 0, 0, 0.45) !important;
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
           ✅ OPTIONAL markdown/message polish (CSS only; no Tailwind needed)
           1) tune list bullets/margins inside .bot-message
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


        /* ===== Markdown extras: headings, rules, KaTeX, code copy header ===== */
        #__chat_widget_root .bot-message h1,
        #__chat_widget_root .bot-message h2,
        #__chat_widget_root .bot-message h3,
        #__chat_widget_root .bot-message h4,
        #__chat_widget_root .bot-message h5,
        #__chat_widget_root .bot-message h6 {
          margin: 0.6rem 0 0.25rem;
          font-weight: 700;
          line-height: 1.25;
        }

        #__chat_widget_root .bot-message hr {
          border: none;
          border-top: 1px solid rgba(229, 231, 235, 0.9);
          margin: 0.75rem 0;
        }

        :global(.dark) #__chat_widget_root .bot-message hr,
        :global(body.dark-skin) #__chat_widget_root .bot-message hr {
          border-top-color: rgba(55, 65, 81, 0.7);
        }

        #__chat_widget_root .cw-codeblock {
          margin: 0.5rem 0;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(229, 231, 235, 0.9);
        }

        :global(.dark) #__chat_widget_root .cw-codeblock,
        :global(body.dark-skin) #__chat_widget_root .cw-codeblock {
          border-color: rgba(55, 65, 81, 0.7);
        }

        #__chat_widget_root .cw-codeblock-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          font-size: 12px;
          background: rgba(15, 23, 42, 0.06);
        }

        :global(.dark) #__chat_widget_root .cw-codeblock-head,
        :global(body.dark-skin) #__chat_widget_root .cw-codeblock-head {
          background: rgba(0, 0, 0, 0.22);
        }

        #__chat_widget_root .cw-code-copy {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: none;
          background: transparent;
          cursor: pointer;
          opacity: 0.9;
          padding: 4px 8px;
          border-radius: 10px;
        }

        #__chat_widget_root .cw-code-copy:hover {
          opacity: 1;
          background: rgba(148, 163, 184, 0.18);
        }

        #__chat_widget_root .bot-message pre.cw-pre {
          margin: 0;
          border: none;
          border-radius: 0;
          background: transparent;
          padding: 10px 12px;
          overflow-x: auto;
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

        /* Page-context highlighting */
        #__chat_widget_root .cw-page-ref {
          background: rgba(59, 130, 246, 0.2);
          border-radius: 3px;
          cursor: pointer;
          padding: 0 2px;
          transition: background 0.15s;
        }
        #__chat_widget_root .cw-page-ref:hover {
          background: rgba(59, 130, 246, 0.4);
        }
        :global(.dark) #__chat_widget_root .cw-page-ref,
        :global(body.dark-skin) #__chat_widget_root .cw-page-ref {
          background: rgba(59, 130, 246, 0.3);
        }
        :global(.dark) #__chat_widget_root .cw-page-ref:hover,
        :global(body.dark-skin) #__chat_widget_root .cw-page-ref:hover {
          background: rgba(59, 130, 246, 0.5);
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
  const [mounted, setMounted] = useState(false)
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
  const tourCollapsedRef = useRef(false)
  const pageHighlightRef = useRef({ cleanup: () => {}, scrollToPhrase: () => false, hasHighlights: false })

  // Clean up page highlights and close the chat widget
  const handleClose = () => {
    try {
      pageHighlightRef.current?.cleanup?.()
    } catch {}
    pageHighlightRef.current = { cleanup: () => {}, scrollToPhrase: () => false, hasHighlights: false }
    setOpen(false)
  }

  useEffect(() => {
    const el = ensureRoot()
    rootRef.current = el
    el.style.pointerEvents = "auto"
    el.style.transform = `translate(${offset.x}px, ${offset.y}px)`
    setMounted(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const collapseForMobile = () => {
      if (typeof window === "undefined") return
      const isMobile = window.matchMedia?.("(max-width: 767px)")?.matches ?? window.innerWidth < 768
      if (!isMobile) return
      setOpen((prev) => {
        if (prev) tourCollapsedRef.current = true
        return false
      })
    }

    const reopenAfterTour = () => {
      if (typeof window === "undefined") return
      const isMobile = window.matchMedia?.("(max-width: 767px)")?.matches ?? window.innerWidth < 768
      if (!isMobile || !tourCollapsedRef.current) return
      tourCollapsedRef.current = false
      setOpen(true)
    }

    window.addEventListener("cw:site-tour:start", collapseForMobile)
    window.addEventListener("cw:site-tour:end", reopenAfterTour)
    return () => {
      window.removeEventListener("cw:site-tour:start", collapseForMobile)
      window.removeEventListener("cw:site-tour:end", reopenAfterTour)
    }
  }, [])

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

  // Only render portal after component is mounted and container is ready
  if (!mounted || !rootRef.current) return null

  return createPortal(
    open ? (
      <Fragment>
        <Overlay onClick={handleClose} />
        <ChatWindow onMinimize={handleClose} onDragStart={startDrag} routerPathname={router.pathname} pageHighlightRef={pageHighlightRef} />
      </Fragment>
    ) : (
      <LauncherButton onOpen={handleOpen} onDragStart={startDrag} />
    ),
    rootRef.current,
  )
}
