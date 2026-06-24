"use client"

import { createPortal } from "react-dom"
import { useState, useEffect, useRef, Fragment } from "react"
import { Minus, ArrowUpRight, Loader2, FileText, X, ChevronDown, Check, Copy, Zap, Brain, Circle, Square, Sparkles, Compass, Search, BookOpen, Wrench, MessageSquare, CheckCircle2, Clock } from "lucide-react"
import Image from "next/image"
import { supabase } from "../supabase/supabaseClient" // <-- adjust if your path differs
import { useRouter } from "next/router"
import LogInDialog from "../components/LogInDialog"
import RelatedLinks from "../components/RelatedLinks"

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
 * Extract generic page context for any route.
 * Returns null if not on an allowed host, or if no meaningful content found.
 * @param {string} routerPathname - Next.js router.pathname (bracket form, e.g. "/work-single/[id]")
 */
function extractPageContext(routerPathname) {
  if (typeof window === "undefined" || !isAllowedHost()) return null

  const pageTitle = document.title || routerPathname
  let text = ""

  // Generic extraction: main/article/.content, skip nav/footer/chat
  const main =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector(".content") ||
    document.body
  const clone = main.cloneNode(true)
  clone.querySelectorAll("nav,footer,script,style,header,.bot-container").forEach(n => n.remove())
  text = clone.innerText

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

function ReasoningChain({ steps, streaming }) {
  const [expanded, setExpanded] = useState(true)
  if (!steps?.length) return null
  const doneCount = steps.filter((s) => s.completed).length
  return (
    <div className="cw-reasoning">
      <button type="button" className="cw-reasoning-toggle" onClick={() => setExpanded((v) => !v)}>
        <Brain className="cw-r-ico" size={14} />
        <span>Reasoning {doneCount}/{steps.length}</span>
        <ChevronDown className={"cw-chev " + (expanded ? "open" : "")} size={13} />
      </button>
      {expanded && (
        <div className="cw-reasoning-steps">
          {steps.map((step, i) => (
            <div key={i} className={"cw-rs " + (step.completed ? "done" : streaming ? "active" : "")}>
              <div className="cw-rs-dot">
                {step.completed ? <CheckCircle2 className="cw-rs-check" size={14} /> : <Circle className="cw-rs-circle" size={14} />}
              </div>
              <div className="cw-rs-body">
                <div className="cw-rs-label">{step.label}</div>
                {step.detail && <div className="cw-rs-detail">{step.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function KeyConceptsBar({ concepts }) {
  if (!concepts?.length) return null
  const colorMap = {
    primary: "#ef4444",
    secondary: "#f59e0b",
    contextual: "#10b981",
    TECH: "#3b82f6",
    PERSON: "#8b5cf6",
    ORG: "#f97316",
    CONCEPT: "#6b7280",
  }
  return (
    <div className="cw-concepts">
      <span className="cw-concepts-label">Key concepts:</span>
      {concepts.map((c, i) => (
        <span
          key={i}
          className="cw-concept-badge"
          style={{ borderColor: colorMap[c.importance] || colorMap[c.type] || "#6b7280" }}
        >
          {c.term}
        </span>
      ))}
    </div>
  )
}

function SourceCardsRow({ cards }) {
  if (!cards?.length) return null
  const badgeLabel = (type) => {
    if (type === "life_blog") return "Life Blog"
    if (type === "tech_blog") return "Tech Blog"
    if (type === "Projects") return "Project"
    return "Article"
  }
  const emoji = (type) => {
    if (type === "life_blog") return "✈️"
    if (type === "tech_blog") return "💡"
    return "🗂️"
  }
  return (
    <div className="cw-source-cards">
      {cards.map((c) => (
        <a
          key={c.id}
          href={c.url}
          className="cw-source-card"
          target="_blank"
          rel="noopener noreferrer"
          title={c.title}
        >
          {c.imageUrl
            ? <img src={c.imageUrl} alt={c.title} className="cw-source-card-img" loading="lazy" />
            : <div className="cw-source-card-img-placeholder">{emoji(c.type)}</div>
          }
          <div className="cw-source-card-body">
            <div className="cw-source-card-badge">{badgeLabel(c.type)}</div>
            <div className="cw-source-card-title">{c.title}</div>
          </div>
        </a>
      ))}
    </div>
  )
}

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

/* ---------- Tool call helpers ---------- */

/**
 * Stage registry — add an entry here to support a new stage type.
 * `match` runs against the lowercased `stage || title`. First match wins.
 * tone keys map to CSS classes (.tone-*) below; add new tones in both
 * ToolCard and StageToast style blocks if introducing one.
 */
const STAGE_REGISTRY = [
  { match: (s) => /plan/.test(s),                              label: "Planning",     tone: "violet",  Icon: Sparkles },
  { match: (s) => /(route|intent|classif)/.test(s),            label: "Routing",      tone: "blue",    Icon: Compass },
  { match: (s) => /(retriev|search|kb|rag|query)/.test(s),     label: "Searching",    tone: "indigo",  Icon: Search },
  { match: (s) => /(doc|chunk|embed|index)/.test(s),           label: "Reading docs", tone: "cyan",    Icon: FileText },
  { match: (s) => /(history|memory|context)/.test(s),          label: "Context",      tone: "amber",   Icon: BookOpen },
  { match: (s) => /(tool|call|invoke|api|fetch)/.test(s),      label: "Tool call",    tone: "emerald", Icon: Wrench },
  { match: (s) => /(generate|compose|answer|reply|stream)/.test(s), label: "Generating", tone: "rose",  Icon: MessageSquare },
  { match: (s) => /(think|reason|reflect|brain)/.test(s),      label: "Thinking",     tone: "violet",  Icon: Brain },
]

const DEFAULT_STAGE_META = { label: "Processing", tone: "slate", Icon: Circle }

function getStageMeta(stage, title) {
  const s = String(stage || title || "").toLowerCase()
  if (!s) return DEFAULT_STAGE_META
  for (const entry of STAGE_REGISTRY) {
    if (entry.match(s)) return entry
  }
  return DEFAULT_STAGE_META
}

// Pull a short one-line summary from a card payload (without huge JSON)
function getCardSummary(step) {
  const p = step?.rawPayload
  if (step?.keyInfo && typeof step.keyInfo === "string") return step.keyInfo
  if (!p) return null
  if (typeof p === "string") return p.length > 80 ? p.slice(0, 77) + "…" : p
  if (typeof p !== "object") return null

  if (Array.isArray(p)) return `${p.length} item${p.length === 1 ? "" : "s"}`

  if (typeof p.docsFound === "number") return `${p.docsFound} doc${p.docsFound === 1 ? "" : "s"}`
  if (typeof p.docCount === "number") return `${p.docCount} doc${p.docCount === 1 ? "" : "s"}`
  if (typeof p.chunksFound === "number")
    return `${p.chunksFound} chunk${p.chunksFound === 1 ? "" : "s"}`
  if (typeof p.historyHits === "number")
    return `${p.historyHits} message${p.historyHits === 1 ? "" : "s"}`
  if (typeof p.count === "number") return `${p.count} result${p.count === 1 ? "" : "s"}`

  const taskArr = p.tasks ?? p.subtasks ?? p.steps ?? p.plan
  if (Array.isArray(taskArr) && taskArr.length > 0)
    return `${taskArr.length} task${taskArr.length === 1 ? "" : "s"}`

  if (typeof p.query === "string") return `"${p.query.slice(0, 60)}${p.query.length > 60 ? "…" : ""}"`
  if (typeof p.message === "string" && p.message.length < 80) return p.message
  return null
}

// Format a millisecond duration as a short readable string (e.g. "1.2s", "340ms", "2m 5s")
function formatDuration(ms) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

// Turn a step's payload into plain-language bullet points a non-technical reader can understand.
// Returns an array of { label, value } pairs; never includes raw JSON.
function humanizeStep(step) {
  const out = []
  const meta = getStageMeta(step?.stage, step?.title)
  const p = step?.rawPayload

  if (p && typeof p === "object" && !Array.isArray(p)) {
    if (typeof p.query === "string" && p.query.trim()) {
      out.push({ label: "What I searched for", value: `“${p.query.trim().slice(0, 200)}”` })
    }
    if (typeof p.intent === "string") out.push({ label: "Topic", value: p.intent })
    if (typeof p.route === "string") out.push({ label: "Route", value: p.route })
    if (typeof p.toolName === "string") out.push({ label: "Tool", value: p.toolName })
    if (typeof p.functionName === "string") out.push({ label: "Tool", value: p.functionName })

    if (typeof p.docsFound === "number")
      out.push({ label: "Found", value: `${p.docsFound} matching document${p.docsFound === 1 ? "" : "s"}` })
    else if (typeof p.docCount === "number")
      out.push({ label: "Found", value: `${p.docCount} matching document${p.docCount === 1 ? "" : "s"}` })
    if (typeof p.chunksFound === "number")
      out.push({ label: "Read", value: `${p.chunksFound} passage${p.chunksFound === 1 ? "" : "s"}` })
    if (typeof p.historyHits === "number")
      out.push({ label: "Recalled", value: `${p.historyHits} earlier message${p.historyHits === 1 ? "" : "s"}` })
    if (typeof p.count === "number" && !out.some((x) => x.label === "Found"))
      out.push({ label: "Result", value: `${p.count} item${p.count === 1 ? "" : "s"}` })

    const taskArr = p.tasks ?? p.subtasks ?? p.steps ?? p.plan
    if (Array.isArray(taskArr) && taskArr.length > 0) {
      const items = taskArr
        .slice(0, 5)
        .map((t) => (typeof t === "string" ? t : t?.title || t?.name || t?.text))
        .filter(Boolean)
      if (items.length) out.push({ label: "My plan", value: items, kind: "list" })
    }

    if (typeof p.message === "string" && p.message.length < 200 && !out.some((x) => x.value === p.message)) {
      out.push({ label: "Note", value: p.message })
    }
    if (typeof p.result === "string" && p.result.length < 300) {
      out.push({ label: "Result", value: p.result })
    }
  } else if (typeof p === "string" && p.trim()) {
    out.push({ label: "Note", value: p.length > 240 ? p.slice(0, 237) + "…" : p })
  } else if (Array.isArray(p)) {
    out.push({ label: "Result", value: `${p.length} item${p.length === 1 ? "" : "s"}` })
  }

  return out
}

/* ---------- Collapsible tool history (timeline) ---------- */
function ToolHistory({ cards }) {
  const [open, setOpen] = useState(false)
  if (!Array.isArray(cards) || cards.length === 0) return null
  const count = cards.length
  return (
    <div className="cw-th mb-2">
      <button
        type="button"
        className={"cw-th-toggle " + (open ? "is-open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open ? "true" : "false"}
      >
        <span className="cw-th-check" aria-hidden="true">
          <Check />
        </span>
        <span className="cw-th-label">
          Used {count} tool{count === 1 ? "" : "s"}
        </span>
        <span className="cw-th-chev" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {open ? (
        <div className="cw-th-body">
          {cards.map((card, idx) => (
            <ToolCard key={card.id} step={card} index={idx} isLast={idx === count - 1} />
          ))}
        </div>
      ) : null}
      <style jsx>{`
        .cw-th {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cw-th-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          align-self: flex-start;
          padding: 5px 10px 5px 6px;
          border-radius: 999px;
          border: 1px solid rgba(16, 185, 129, 0.28);
          background: linear-gradient(
            135deg,
            rgba(16, 185, 129, 0.08),
            rgba(59, 130, 246, 0.06)
          );
          color: #047857;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 120ms ease, background-color 150ms ease, border-color 150ms ease;
        }
        .cw-th-toggle:hover {
          transform: translateY(-1px);
          border-color: rgba(16, 185, 129, 0.5);
        }
        .cw-th-check {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.18);
          color: #059669;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .cw-th-check :global(svg) {
          width: 12px;
          height: 12px;
          stroke-width: 3;
        }
        .cw-th-chev {
          display: inline-flex;
          opacity: 0.6;
          transition: transform 180ms ease;
        }
        .cw-th-chev :global(svg) {
          width: 14px;
          height: 14px;
        }
        .cw-th-toggle.is-open .cw-th-chev {
          transform: rotate(180deg);
        }
        :global(body.dark-skin) .cw-th-toggle,
        :global(.dark) .cw-th-toggle {
          color: #6ee7b7;
          background: linear-gradient(
            135deg,
            rgba(16, 185, 129, 0.16),
            rgba(59, 130, 246, 0.12)
          );
          border-color: rgba(16, 185, 129, 0.4);
        }
        :global(body.dark-skin) .cw-th-check,
        :global(.dark) .cw-th-check {
          background: rgba(16, 185, 129, 0.25);
          color: #6ee7b7;
        }
        .cw-th-body {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 8px;
          animation: thIn 180ms ease-out;
        }
        @keyframes thIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ---------- Completed tool card (in history) ---------- */
function ToolCard({ step }) {
  const [open, setOpen] = useState(false)
  if (!step) return null
  const meta = getStageMeta(step.stage, step.title)
  const StageIcon = meta.Icon || Circle
  const details = humanizeStep(step)
  const hasDetails = details.length > 0
  const duration = step.tsEnd && step.ts ? formatDuration(step.tsEnd - step.ts) : null

  return (
    <div className={`cw-tc tone-${meta.tone}`}>
      <button
        type="button"
        className={"cw-tc-row " + (open ? "is-open" : "") + (hasDetails ? "" : " no-details")}
        onClick={() => hasDetails && setOpen((v) => !v)}
        aria-expanded={open ? "true" : "false"}
        disabled={!hasDetails}
      >
        <span className="cw-tc-icon" aria-hidden="true"><StageIcon /></span>
        <span className="cw-tc-name">{meta.label}</span>
        {duration ? (
          <span className="cw-tc-dur"><Clock /> {duration}</span>
        ) : null}
        <span className="cw-tc-status" aria-hidden="true"><CheckCircle2 /></span>
        {hasDetails ? (
          <span className="cw-tc-chev" aria-hidden="true"><ChevronDown /></span>
        ) : null}
      </button>
      {open && hasDetails ? (
        <div className="cw-tc-detail">
          {details.map((d, i) => (
            d.kind === "list" && Array.isArray(d.value) ? (
              <ol className="cw-tc-list" key={i}>
                {d.value.map((it, j) => <li key={j}>{it}</li>)}
              </ol>
            ) : (
              <div className="cw-tc-line" key={i}>
                <span className="cw-tc-k">{d.label}</span>
                <span className="cw-tc-v">{d.value}</span>
              </div>
            )
          ))}
        </div>
      ) : null}
      <style jsx>{`
        .cw-tc { --tone: 100, 116, 139; }
        .cw-tc.tone-violet  { --tone: 139, 92, 246; }
        .cw-tc.tone-blue    { --tone: 59, 130, 246; }
        .cw-tc.tone-indigo  { --tone: 99, 102, 241; }
        .cw-tc.tone-cyan    { --tone: 6, 182, 212; }
        .cw-tc.tone-amber   { --tone: 245, 158, 11; }
        .cw-tc.tone-emerald { --tone: 16, 185, 129; }
        .cw-tc.tone-rose    { --tone: 244, 63, 94; }
        .cw-tc.tone-slate   { --tone: 100, 116, 139; }

        .cw-tc-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 5px 8px;
          margin: 0 -8px;
          border: none;
          background: transparent;
          border-radius: 6px;
          text-align: left;
          cursor: pointer;
          font-size: 13px;
          line-height: 1.4;
          transition: background 120ms ease;
        }
        .cw-tc-row:hover:not(:disabled) { background: rgba(var(--tone), 0.07); }
        .cw-tc-row.no-details { cursor: default; }
        :global(body.dark-skin) .cw-tc-row:hover:not(:disabled),
        :global(.dark) .cw-tc-row:hover:not(:disabled) { background: rgba(var(--tone), 0.12); }

        .cw-tc-icon {
          flex-shrink: 0;
          display: inline-flex;
          color: rgb(var(--tone));
        }
        .cw-tc-icon :global(svg) { width: 15px; height: 15px; stroke-width: 2; }

        .cw-tc-name {
          flex: 1 1 auto;
          min-width: 0;
          font-weight: 600;
          color: rgba(15, 23, 42, 0.9);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :global(body.dark-skin) .cw-tc-name,
        :global(.dark) .cw-tc-name { color: rgba(226, 232, 240, 0.92); }

        .cw-tc-dur {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 11.5px;
          color: rgba(100, 116, 139, 0.85);
          font-variant-numeric: tabular-nums;
        }
        .cw-tc-dur :global(svg) { width: 11px; height: 11px; }
        :global(body.dark-skin) .cw-tc-dur,
        :global(.dark) .cw-tc-dur { color: rgba(148, 163, 184, 0.85); }

        .cw-tc-status {
          flex-shrink: 0;
          display: inline-flex;
          color: rgb(16, 185, 129);
        }
        .cw-tc-status :global(svg) { width: 14px; height: 14px; }

        .cw-tc-chev {
          flex-shrink: 0;
          display: inline-flex;
          color: rgba(100, 116, 139, 0.5);
          transition: transform 180ms ease;
        }
        .cw-tc-chev :global(svg) { width: 13px; height: 13px; }
        .cw-tc-row.is-open .cw-tc-chev { transform: rotate(180deg); }

        .cw-tc-detail {
          margin: 3px 0 3px 23px;
          padding: 6px 10px;
          border-left: 2px solid rgba(var(--tone), 0.3);
          display: flex;
          flex-direction: column;
          gap: 4px;
          animation: tcOpen 150ms ease-out;
        }
        .cw-tc-line {
          display: flex;
          align-items: baseline;
          gap: 6px;
          font-size: 12.5px;
          line-height: 1.5;
        }
        .cw-tc-k {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: rgb(var(--tone));
          opacity: 0.8;
        }
        .cw-tc-v {
          color: rgba(30, 41, 59, 0.85);
          word-break: break-word;
          min-width: 0;
        }
        :global(body.dark-skin) .cw-tc-v,
        :global(.dark) .cw-tc-v { color: rgba(203, 213, 225, 0.9); }
        .cw-tc-list {
          margin: 1px 0 0 0;
          padding-left: 16px;
          font-size: 12.5px;
          line-height: 1.5;
          color: rgba(30, 41, 59, 0.85);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        :global(body.dark-skin) .cw-tc-list,
        :global(.dark) .cw-tc-list { color: rgba(203, 213, 225, 0.9); }
        .cw-tc-list li { list-style: disc; }

        @keyframes tcOpen {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ---------- Live stage toast (while streaming) ---------- */
function StageToast({ step }) {
  if (!step) return null
  const meta = getStageMeta(step.stage, step.title)
  const StageIcon = meta.Icon || Circle
  const summary = getCardSummary(step)
  const title = step.title || meta.label

  // Extract tasks for the live mini-list (if any)
  const tasks = (() => {
    const p = step.rawPayload
    if (!p) return null
    if (Array.isArray(p)) {
      const t = p.filter((it) => it && typeof it === "object" && (it.title || it.name || it.text))
      return t.length ? t : null
    }
    if (typeof p !== "object") return null
    const arr = p.tasks ?? p.subtasks ?? p.steps ?? p.plan
    if (Array.isArray(arr) && arr.length) {
      const t = arr.filter((it) => it && typeof it === "object" && (it.title || it.name || it.text))
      return t.length ? t : null
    }
    return null
  })()

  return (
    <div key={step.id} className={`cw-st tone-${meta.tone} mb-2`}>
      <div className="cw-st-card">
        <div className="cw-st-head">
          <span className="cw-st-spinner" aria-hidden="true">
            <StageIcon className="cw-st-glyph" />
            <Loader2 className="cw-st-ring" />
          </span>
          <div className="cw-st-info">
            <div className="cw-st-row1">
              <span className="cw-st-tag">{meta.label}</span>
              <span className="cw-st-title">{title}</span>
            </div>
            {summary ? <div className="cw-st-sub">{summary}</div> : null}
          </div>
        </div>

        {tasks ? (
          <ul className="cw-st-tasks">
            {tasks.slice(0, 4).map((t, i) => (
              <li key={t.id || i} className={t.completed || t.done ? "done" : ""}>
                <span className="num">{t.order ?? i + 1}</span>
                <span className="txt">{t.title || t.name || t.text}</span>
                {(t.completed || t.done) ? <Check className="chk" /> : null}
              </li>
            ))}
            {tasks.length > 4 ? <li className="more">+{tasks.length - 4} more</li> : null}
          </ul>
        ) : null}

        <div className="cw-st-bar" aria-hidden="true" />
      </div>

      <style jsx>{`
        .cw-st { --tone: 99, 102, 241; animation: stIn 200ms ease-out; }
        .cw-st.tone-violet  { --tone: 139, 92, 246; }
        .cw-st.tone-blue    { --tone: 59, 130, 246; }
        .cw-st.tone-indigo  { --tone: 99, 102, 241; }
        .cw-st.tone-cyan    { --tone: 6, 182, 212; }
        .cw-st.tone-amber   { --tone: 245, 158, 11; }
        .cw-st.tone-emerald { --tone: 16, 185, 129; }
        .cw-st.tone-rose    { --tone: 244, 63, 94; }
        .cw-st.tone-slate   { --tone: 100, 116, 139; }

        .cw-st-card {
          position: relative;
          border-radius: 10px;
          padding: 11px 14px 15px;
          border: 1px solid rgba(var(--tone), 0.25);
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }
        :global(body.dark-skin) .cw-st-card,
        :global(.dark) .cw-st-card {
          background: rgba(15, 23, 42, 0.55);
          border-color: rgba(var(--tone), 0.38);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        }

        .cw-st-head {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cw-st-spinner {
          position: relative;
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cw-st-glyph {
          position: absolute;
          width: 14px;
          height: 14px;
          color: rgb(var(--tone));
          stroke-width: 2;
          z-index: 1;
        }
        .cw-st-ring {
          position: absolute;
          inset: 0;
          width: 28px;
          height: 28px;
          color: rgba(var(--tone), 0.55);
          stroke-dasharray: 50 22;
          animation: spin 1.1s linear infinite;
        }

        .cw-st-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .cw-st-row1 {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
        }
        .cw-st-tag {
          flex-shrink: 0;
          font-size: 9.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: rgb(var(--tone));
          padding: 2px 5px;
          border-radius: 4px;
          background: rgba(var(--tone), 0.13);
        }
        :global(body.dark-skin) .cw-st-tag,
        :global(.dark) .cw-st-tag { background: rgba(var(--tone), 0.22); }
        .cw-st-title {
          font-size: 13.5px;
          font-weight: 600;
          line-height: 1.25;
          color: transparent;
          background-image: linear-gradient(
            90deg,
            rgba(30, 41, 59, 0.55) 0%,
            rgb(var(--tone)) 30%,
            rgba(236, 72, 153, 0.85) 55%,
            rgb(var(--tone)) 75%,
            rgba(30, 41, 59, 0.55) 100%
          );
          background-size: 220% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          animation: waveText 1.8s ease-in-out infinite;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }
        :global(body.dark-skin) .cw-st-title,
        :global(.dark) .cw-st-title {
          background-image: linear-gradient(
            90deg,
            rgba(226, 232, 240, 0.45) 0%,
            rgb(var(--tone)) 30%,
            rgba(244, 114, 182, 0.9) 55%,
            rgb(var(--tone)) 75%,
            rgba(226, 232, 240, 0.45) 100%
          );
          background-size: 220% 100%;
        }
        .cw-st-sub {
          font-size: 12px;
          line-height: 1.4;
          color: rgba(71, 85, 105, 0.85);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        :global(body.dark-skin) .cw-st-sub,
        :global(.dark) .cw-st-sub { color: rgba(148, 163, 184, 0.9); }

        .cw-st-tasks {
          margin: 9px 0 0 40px;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .cw-st-tasks li {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: rgba(30, 41, 59, 0.85);
        }
        :global(body.dark-skin) .cw-st-tasks li,
        :global(.dark) .cw-st-tasks li { color: rgba(226, 232, 240, 0.85); }
        .cw-st-tasks li.done { opacity: 0.5; }
        .cw-st-tasks li.done .txt { text-decoration: line-through; }
        .cw-st-tasks .num { font-weight: 700; color: rgb(var(--tone)); min-width: 14px; font-size: 11px; }
        .cw-st-tasks .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
        .cw-st-tasks .chk { width: 11px; height: 11px; color: #10b981; stroke-width: 3; flex-shrink: 0; }
        .cw-st-tasks .more { font-size: 11px; color: rgba(100, 116, 139, 0.6); font-style: italic; }

        .cw-st-bar {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 2px;
          overflow: hidden;
          background: rgba(var(--tone), 0.07);
        }
        .cw-st-bar::before {
          content: "";
          position: absolute;
          left: -40%; top: 0;
          height: 100%; width: 40%;
          background: linear-gradient(90deg, transparent, rgb(var(--tone)), transparent);
          animation: indeterminate 1.3s ease-in-out infinite;
        }
        @keyframes stIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes waveText {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes indeterminate {
          0%   { left: -40%; }
          100% { left: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cw-st-ring, .cw-st-title, .cw-st-bar::before { animation: none; }
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

  const BLOG_OWNER_EMAIL = "yuqi.guo17@gmail.com"
  // Matches any phrasing that implies blog creation / mutation
  const BLOG_MGMT_INTENT = /\b(create|write|add|update|edit|modify|delete|remove|publish)\b.{0,60}\b(blog|tech\s+blog|life\s+blog|blog\s+post)\b|\b(list|show)\s+(my\s+)?(tech|life)\s+blog/i
  const [mode, setMode] = useState(() => {
    const saved = storageSafeGet(MODE_KEY)
    return ["thinking"].includes(saved) ? saved : "regular"
  })
  const isThinking = mode === "thinking"
  const [modeOpen, setModeOpen] = useState(false)
  const [showLoginDialog, setShowLoginDialog] = useState(false)

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
  // Assistant message ids whose turn was stopped by the user. Any in-flight
  // setStage / finalize call for these ids becomes a no-op so async work that
  // has already kicked off can't redraw the bubble after the user moved on.
  const stoppedAssistantIdsRef = useRef(new Set())
  const uploadTimersRef = useRef([])
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const modeWrapRef = useRef(null)
  // Holds the most recent CONFIRMATION_REQUIRED envelope so the next user
  // message can be interpreted as "confirm" / "cancel" without re-classifying.
  const pendingActionRef = useRef(null)
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

  // Stages we never want to surface as a "tool call card" — too noisy / not meaningful
  // to the user (lifecycle/heartbeat/init markers). Edit this set to add/remove filters.
  const TRIVIAL_STAGES = new Set([
    "start", "begin", "init", "initialize", "initialized",
    "heartbeat", "ping", "keepalive", "keep_alive",
    "ack", "noop", "open", "close", "connected", "disconnected",
    "answer_delta", "answer_final", "message",
    "complete", "completed", "done", "finished", "finish", "end", "ended", "final", "answer",
  ])
  const isTrivialStage = (stage) => {
    const s = String(stage || "").toLowerCase()
    if (!s) return true
    if (TRIVIAL_STAGES.has(s)) return true
    // catch *_start / *_begin / *_init / *_done / *_complete variants
    if (/(^|_)(start|begin|init|heartbeat|ping|done|complete|completed|end|ended|finish|finished|final)$/.test(s)) return true
    return false
  }

  const setStage = (assistantId, stage, obj = {}) => {
    if (isTrivialStage(stage)) return
    const title = formatStageTitle(stage, obj?.message)
    const keyInfo = summarizePayload(obj?.payload, 180)
    const now = Date.now()
    // Suppress further timeline writes after the user stopped this turn.
    if (stoppedAssistantIdsRef.current.has(assistantId)) return
    const groupKey = typeof obj?.groupKey === "string" && obj.groupKey ? obj.groupKey : null
    const isFinal = !!obj?.final
    const card = {
      id: `${String(stage || "stage")}-${now}-${Math.random().toString(36).slice(2, 6)}`,
      stage,
      title,
      keyInfo,
      rawPayload: obj?.payload,
      groupKey,
      ts: now,
      tsEnd: isFinal ? now : undefined,
    }

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m
        const existing = Array.isArray(m.toolCards) ? m.toolCards : []

        // ── Group merge ──────────────────────────────────────────────
        // When a card with the same groupKey exists, update it in place
        // instead of pushing a new one. Lets one logical step (Routing,
        // Tool call) render as a single card with a real start→end
        // duration, and lets the "final" event provide the richer
        // payload (toolName, intent, result) the dropdown needs.
        if (groupKey) {
          const idx = existing.findIndex((c) => c.groupKey === groupKey)
          if (idx >= 0) {
            const cur = existing[idx]
            const mergedPayload =
              cur.rawPayload && typeof cur.rawPayload === "object" &&
              obj?.payload && typeof obj.payload === "object" && !Array.isArray(obj.payload)
                ? { ...cur.rawPayload, ...obj.payload }
                : (obj?.payload !== undefined ? obj.payload : cur.rawPayload)
            const merged = {
              ...cur,
              title: title || cur.title,
              keyInfo: summarizePayload(mergedPayload, 180) || cur.keyInfo,
              rawPayload: mergedPayload,
              stage,
              tsEnd: isFinal ? now : cur.tsEnd,
            }
            const next = [...existing]
            next[idx] = merged
            return {
              ...m,
              thinkingNow: isFinal ? null : merged,
              toolCards: next,
            }
          }
        }

        const last = existing[existing.length - 1]
        // Close out the previous card with an end timestamp
        const closed = last && !last.tsEnd ? [...existing.slice(0, -1), { ...last, tsEnd: now }] : existing
        // De-dupe: skip if previous card has the same stage + title (avoids repeated steps)
        const isDup = last && last.stage === stage && last.title === title
        return {
          ...m,
          thinkingNow: isFinal ? null : card,
          toolCards: isDup ? closed : [...closed, card],
        }
      }),
    )
  }

  const clearStage = (assistantId) => {
    const now = Date.now()
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m
        const existing = Array.isArray(m.toolCards) ? m.toolCards : []
        const last = existing[existing.length - 1]
        const closed = last && !last.tsEnd ? [...existing.slice(0, -1), { ...last, tsEnd: now }] : existing
        return { ...m, thinkingNow: null, toolCards: closed }
      }),
    )
  }

  const finalizeAssistant = (assistantId, rawFinal, onFinal) => {
    // If the user already stopped this turn, swallow any late finalize
    // attempts so partial RAG content can't overwrite the "Stopped." bubble.
    if (stoppedAssistantIdsRef.current.has(assistantId)) return
    const finalContent = String(rawFinal || "")

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, content: finalContent, isHtml: false, streaming: false, thinkingNow: null, planPayload: m.planPayload } : m,
      ),
    )

    onFinal?.(finalContent)
  }

  const startRagSSE = async ({ question, fileUrls, assistantId, onFinal, requestMode, currentSessionId, pageContext, userEmail, conversationHistory }) => {
    const base = ragEndpointRef.current || (await resolveRagEndpoint())
    const streamUrl = ragStreamUrl(base)

    const controller = new AbortController()
    abortRef.current = controller

    let answerBuf = ""
    let finalized = false
    let pageRelevanceResult = null  // Store page relevance from answer_final
    
    // Map frontend mode to backend mode string
    const backendMode = requestMode === "thinking" ? "DEEPTHINKING" : "FAST"

    const body = {
      question,
      sessionId: currentSessionId,
      mode: backendMode,
      scopeMode: requestMode === "thinking" ? "GENERAL" : "OWNER_ONLY",
      ...(Array.isArray(fileUrls) && fileUrls.length > 0 ? { fileUrls } : {}),
      // Send pageContext inside ext map — no backend schema change needed
      ...(pageContext ? { ext: { currentPageUrl: pageContext.url, currentPagePattern: pageContext.pagePattern, pageContextText: pageContext.text, pageTitle: pageContext.pageTitle } } : {}),
      ...(userEmail ? { userEmail } : {}),
      // Multi-turn: last 6 turns so Gemini can resolve pronouns / follow-ups.
      ...(Array.isArray(conversationHistory) && conversationHistory.length > 0
        ? { conversationHistory }
        : {}),
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

        // Handle reasoning_step (DeepThinking plan/verify steps)
        if (stage === "reasoning_step") {
          const { label, detail, completed } = obj.payload || {}
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m
              const existing = Array.isArray(m.reasoningSteps) ? m.reasoningSteps : []
              let updatedSteps
              if (completed) {
                const lastIdx = [...existing].reverse().findIndex((s) => s.label === label)
                if (lastIdx >= 0) {
                  const realIdx = existing.length - 1 - lastIdx
                  updatedSteps = existing.map((s, i) => (i === realIdx ? { ...s, completed: true, detail } : s))
                } else {
                  updatedSteps = [...existing, { label, detail, completed: true }]
                }
              } else {
                updatedSteps = [...existing, { label, detail, completed: false }]
              }
              return { ...m, reasoningSteps: updatedSteps }
            })
          )
          return
        }

        // Handle tour_steps (WebGuide AI tour)
        if (stage === "tour_steps") {
          const tourSteps = obj.payload?.steps
          const autoStart = obj.payload?.autoStart
          if (Array.isArray(tourSteps) && tourSteps.length > 0) {
            setMessages((prev) =>
              prev.map((m) => (m.id !== assistantId ? m : { ...m, tourSteps }))
            )
            if (autoStart) {
              try {
                window.dispatchEvent(new CustomEvent("cw:site-tour:dynamic", { detail: { steps: tourSteps } }))
              } catch {}
            }
          }
          return
        }

        // Handle key_concepts (from extract_key_concepts tool)
        if (stage === "key_concepts") {
          const concepts = obj.payload?.concepts
          if (Array.isArray(concepts) && concepts.length > 0) {
            setMessages((prev) =>
              prev.map((m) => (m.id !== assistantId ? m : { ...m, keyConcepts: concepts }))
            )
          }
          return
        }

        // Handle sources_found — attach source cards to assistant message
        if (stage === "sources_found") {
          const sources = obj.payload?.sources
          if (Array.isArray(sources) && sources.length > 0) {
            setMessages((prev) =>
              prev.map((m) => (m.id !== assistantId ? m : { ...m, sourceCards: sources }))
            )
          }
          return
        }

        // Handle related_links — attach dynamic content suggestions to assistant message
        if (stage === "related_links") {
          const links = obj.payload?.links
          if (Array.isArray(links) && links.length > 0) {
            setMessages((prev) =>
              prev.map((m) => (m.id !== assistantId ? m : { ...m, relatedLinks: links }))
            )
          }
          return
        }

        // Handle tool_call_start — show tool invocation card
        if (stage === "tool_call_start") {
          const { toolName, args, callId } = obj.payload || {}
          if (toolName) {
            const now = Date.now()
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m
                const existing = Array.isArray(m.toolCards) ? m.toolCards : []
                return {
                  ...m,
                  toolCards: [
                    ...existing,
                    {
                      id: callId || `tc-${now}`,
                      stage: "tool_call_start",
                      title: `\u{1F527} ${toolName}`,
                      keyInfo: args ? String(args).slice(0, 120) : "",
                      rawPayload: obj.payload,
                      ts: now,
                      toolName,
                      callId,
                    },
                  ],
                }
              })
            )
          }
          return
        }

        // Handle tool_call_result — update the matching tool card with latency
        if (stage === "tool_call_result") {
          const { toolName, callId, latencyMs, status } = obj.payload || {}
          const now = Date.now()
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m
              const existing = Array.isArray(m.toolCards) ? m.toolCards : []
              const updated = existing.map((c) => {
                if (c.callId && c.callId === callId) {
                  return { ...c, tsEnd: now, keyInfo: latencyMs ? `${latencyMs}ms · ${status || "done"}` : (status || "done") }
                }
                return c
              })
              return { ...m, toolCards: updated }
            })
          )
          return
        }

        // Handle intent_decided — emit as a regular stage card (dev info)
        if (stage === "intent_decided") {
          const { useRAG, ragScope, toolHints, reasoning } = obj.payload || {}
          const info = [useRAG ? `RAG:${ragScope || "auto"}` : "no-RAG", toolHints?.length ? `tools:${toolHints.join(",")}` : null].filter(Boolean).join(" · ")
          setStage(assistantId, "intent_decided", { message: `Intent: ${info}`, payload: obj.payload })
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

  /**
   * Manifest-driven intent router.
   *
   * Calls /api/intent/route — Gemini structured classifier + deterministic
   * validator + Supabase-backed tool manifest. Returns a normalized
   * RouteDecision the rest of sendMessage can switch on:
   *
   *   { routeKind: "KB_QA" | "MCP_TOOL" | "GENERAL_CHAT" | "CLARIFICATION_NEEDED",
   *     targetTool, toolArguments, missingArguments,
   *     riskLevel, requiresConfirmation, requiredRole,
   *     normalizedQuery, clarificationQuestion, language, confidence,
   *     trace: { ... } }
   *
   * This replaces the old `looksLikeAction()` regex gate AND the
   * agent-service pre-classifier on the hot path. The widget never
   * inlines tool keywords or per-language verb tables — the manifest
   * is the single source of truth for what tools exist.
   *
   * On any failure (network, timeout, malformed JSON), we degrade to
   *   { routeKind: "KB_QA" }
   * so the user always gets an answer.
   */
  const ROUTER_TIMEOUT_MS = 5000
  const callIntentRouter = async ({ question, assistantId, recentMessages, currentSessionId }) => {
    setStage(assistantId, "intent_classify", {
      message: "Routing",
      payload: { utterance: (question || "").slice(0, 200) },
      groupKey: "intent_route",
      final: false,
    })

    const ctrl = new AbortController()
    abortRef.current = ctrl
    const timer = setTimeout(() => { try { ctrl.abort() } catch {} }, ROUTER_TIMEOUT_MS)
    let decision = null
    try {
      const res = await fetch("/api/intent/route", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          input: question,
          conversationId: currentSessionId || null,
          recentMessages: Array.isArray(recentMessages) ? recentMessages.slice(-6) : [],
        }),
        signal: ctrl.signal,
      })
      decision = await res.json().catch(() => null)
      if (!res.ok || !decision || !decision.routeKind) {
        throw new Error(`router HTTP ${res.status}`)
      }
    } catch (err) {
      logger.warn("Intent router failed:", err?.message || err)
      decision = {
        routeKind: "KB_QA",
        targetTool: null,
        toolArguments: {},
        missingArguments: [],
        riskLevel: "READ_ONLY",
        requiresConfirmation: false,
        requiredRole: null,
        normalizedQuery: question,
        clarificationQuestion: null,
        language: "en",
        confidence: 0,
        trace: { error: err?.message || String(err), fallback: "KB_QA" },
      }
    } finally {
      clearTimeout(timer)
    }

    // Always record the decision in the timeline so the chain stays visible.
    const routeMsg = (() => {
      const t = decision.trace?.latencyMs ? ` (${decision.trace.latencyMs}ms)` : ""
      switch (decision.routeKind) {
        case "KB_QA":                 return `Routing: KB_QA → local RAG${t}`
        case "GENERAL_CHAT":          return `Routing: GENERAL_CHAT → local RAG${t}`
        case "CLARIFICATION_NEEDED":  return `Routing: CLARIFICATION_NEEDED${decision.targetTool ? ` (${decision.targetTool})` : ""}${t}`
        case "MCP_TOOL":              return `Routing: MCP_TOOL → ${decision.targetTool}${t}`
        default:                      return `Routing: ${decision.routeKind}${t}`
      }
    })()
    setStage(assistantId, "intent_decided", {
      message: routeMsg,
      payload: {
        intent: decision.routeKind,
        tool: decision.targetTool,
        // toolName is the key humanizeStep looks for → makes the card expandable
        toolName: decision.targetTool || undefined,
        route: decision.routeKind,
        toolArguments: decision.toolArguments,
        missingArguments: decision.missingArguments,
        riskLevel: decision.riskLevel,
        requiresConfirmation: decision.requiresConfirmation,
        confidence: decision.confidence,
        normalizedQuery: decision.normalizedQuery,
        trace: decision.trace,
      },
      groupKey: "intent_route",
      final: true,
    })

    return decision
  }

  /**
   * Fast-mode MCP pre-classifier.
   *
   * Calls the portfolio-agent-service via the Next.js /api/agent/intent proxy.
   * The agent returns a structured IntentResponse envelope; this helper
   * renders it into the assistant bubble and tells the caller whether the
   * RAG fallback should still run.
   *
   * Return value:
   *   { handled: true }            — Envelope was rendered. Skip RAG.
   *   { handled: false }           — Either GENERAL_CHAT or ERROR.
   *                                  Fall through to existing RAG flow.
   */

  /**
   * Direct frontend handler for `contact.email_owner`.
   *
   * This tool is intentionally NOT registered in the agent-service
   * ToolRegistry (admin/notification tools only). Visitor-facing contact
   * lives entirely in the Next.js layer: the existing /api/contact
   * nodemailer endpoint already does the work. Routing it through Cloud
   * Run + MCP gateway would add cold-start latency, a new auth surface,
   * and another deploy target for zero benefit.
   *
   * Returns true when the message was sent (skip RAG); false when the
   * caller should fall through to RAG/other handling.
   */
  const handleContactEmailOwner = async ({ args, assistantId }) => {
    const name = typeof args?.name === "string" ? args.name.trim() : ""
    const email = typeof args?.email === "string" ? args.email.trim() : ""
    const message = typeof args?.message === "string" ? args.message.trim() : ""
    if (!name || !email || !message) {
      // Validator should have caught this; defensive fallback.
      return false
    }

    const TOOL_GROUP = "tool_contact_email_owner"
    setStage(assistantId, "tool_call", {
      message: "Tool call",
      payload: {
        toolName: "contact.email_owner",
        route: "/api/contact",
        from: `${name} <${email}>`,
        messagePreview: message.length > 120 ? `${message.slice(0, 117)}…` : message,
      },
      groupKey: TOOL_GROUP,
      final: false,
    })

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
        signal: ctrl.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setStage(assistantId, "tool_result", {
          message: "Tool call",
          payload: {
            toolName: "contact.email_owner",
            route: "/api/contact",
            result: `Failed (HTTP ${res.status}): ${data?.error || "unknown error"}`,
          },
          groupKey: TOOL_GROUP,
          final: true,
        })
        const msg =
          "⚠️ Sorry — I couldn't send that contact message just now. " +
          "Please try again in a minute, or email yuqi.guo17@gmail.com directly."
        clearStage(assistantId)
        finalizeAssistant(assistantId, msg)
        return true
      }
      setStage(assistantId, "tool_result", {
        message: "Tool call",
        payload: {
          toolName: "contact.email_owner",
          route: "/api/contact",
          result: `Sent to site owner (reply-to ${email})`,
        },
        groupKey: TOOL_GROUP,
        final: true,
      })
      const confirm =
        `Done — your message has been sent to Yuqi. ✉️\n\n` +
        `**Name:** ${name}\n**Email:** ${email}\n**Message:** ${message}\n\n` +
        `He'll usually reply within a day or two. Anything else I can help with?`
      clearStage(assistantId)
      finalizeAssistant(assistantId, confirm)
      return true
    } catch (err) {
      // User aborted via the Stop button — re-throw so sendMessage's catch
      // can do its unified cleanup. Don't render a "failure" bubble.
      if (err?.name === "AbortError") throw err
      setStage(assistantId, "tool_result", {
        message: "Tool call",
        payload: {
          toolName: "contact.email_owner",
          route: "/api/contact",
          result: `Network error: ${err?.message || String(err)}`,
        },
        groupKey: TOOL_GROUP,
        final: true,
      })
      const msg =
        "⚠️ The contact endpoint isn't reachable right now. " +
        "Please try again later, or email yuqi.guo17@gmail.com directly."
      clearStage(assistantId)
      finalizeAssistant(assistantId, msg)
      return true
    }
  }

  const tryAgentIntent = async ({ question, assistantId, currentSessionId, pageContext, body, recentMessages }) => {
    let bearer = null
    try {
      const { data: { session } } = await supabase.auth.getSession()
      bearer = session?.access_token || null
    } catch {}

    // Surface the executor call in the logic-chain timeline. The router
    // (callIntentRouter) has already decided this is MCP_TOOL — now we're
    // asking the agent service to actually run it.
    setStage(assistantId, "tool_invoke", {
      message: "Tool: invoking agent service",
      payload: {
        utterance: (question || "").slice(0, 200),
        signedIn: !!bearer,
        ...(pageContext?.pagePattern ? { page: pageContext.pagePattern } : {}),
      },
    })

    const reqBody = body || {
      sessionId: currentSessionId,
      utterance: question,
      recentMessages: Array.isArray(recentMessages) ? recentMessages.slice(-6) : [],
      ...(pageContext
        ? {
            pageContext: {
              url: pageContext.url,
              pagePattern: pageContext.pagePattern,
              pageTitle: pageContext.pageTitle,
            },
          }
        : {}),
    }

    // Hard cap the classifier call. The agent can cold-start or its upstream
    // MCP gateway can 502 for ~20+ seconds — we never want the user staring
    // at a "Pre-classifying intent" spinner that long. If it exceeds this
    // budget, abort and fall through to the RAG path immediately. The badge
    // in the timeline will record the timeout so it's still visible.
    const INTENT_TIMEOUT_MS = 4000
    let env
    let timedOut = false
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const timer = setTimeout(() => {
      timedOut = true
      try { ctrl.abort() } catch {}
    }, INTENT_TIMEOUT_MS)
    try {
      const res = await fetch("/api/agent/intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(reqBody),
        signal: ctrl.signal,
      })
      env = await res.json().catch(() => null)
      if (!res.ok || !env) {
        logger.warn("Agent intent proxy returned", res.status, env)
        setStage(assistantId, "tool_invoke_result", {
          message: `Tool: agent HTTP ${res.status} → falling back to KB`,
          payload: { result: "ERROR", httpStatus: res.status },
        })
        return { handled: false }
      }
    } catch (err) {
      // Network / proxy / abort failure — let RAG handle it silently but
      // surface the reason in the timeline.
      const reason = timedOut
        ? `timed out after ${INTENT_TIMEOUT_MS}ms`
        : err?.message || String(err)
      logger.warn("Agent intent proxy failed:", reason)
      setStage(assistantId, "tool_invoke_result", {
        message: `Tool: ${timedOut ? "agent timed out" : "agent unreachable"} → falling back to KB`,
        payload: { result: timedOut ? "TIMEOUT" : "ERROR", reason },
      })
      return { handled: false }
    } finally {
      clearTimeout(timer)
    }

    // ----- Executor result card -------------------------------------------
    // Record what the agent service actually did (or wants us to do next).
    const resultLabel = (() => {
      switch (env.type) {
        case "OK":                    return "Direct tool call succeeded"
        case "ASK":                   return "Needs clarification"
        case "CONFIRMATION_REQUIRED": return `Awaiting confirm: ${env.tool || env.targetTool || "tool"}`
        case "FORBIDDEN":             return "Blocked — admin-only tool"
        case "GENERAL_CHAT":          return "General chat → falling back to KB"
        case "ERROR":                 return "Executor error → falling back to KB"
        default:                      return env.type || "unknown"
      }
    })()
    setStage(assistantId, "tool_invoke_result", {
      message: `Tool: ${resultLabel}`,
      payload: {
        result: env.type,
        tool: env.tool || env.targetTool || null,
        message: env.message || null,
        arguments: env.arguments || null,
        riskLevel: env.riskLevel || null,
      },
    })

    // GENERAL_CHAT / ERROR → don't render the envelope itself; let the
    // existing RAG flow take over so the user gets a real KB-grounded
    // answer instead of the canned hint. The Routing card above stays in
    // the timeline so they can still see what the classifier decided.
    if (env.type === "GENERAL_CHAT" || env.type === "ERROR") {
      return { handled: false }
    }

    // Render envelope into the assistant bubble.
    const lines = []
    if (env.type === "OK") {
      if (env.message) lines.push(env.message)
      if (env.result !== undefined) {
        lines.push("```json\n" + JSON.stringify(env.result, null, 2) + "\n```")
      }
    } else if (env.type === "ASK") {
      lines.push(env.clarificationQuestion || env.message || "Could you clarify?")
      if (Array.isArray(env.options) && env.options.length > 0) {
        const opts = env.options
          .map((o) => (typeof o === "string" ? `• ${o}` : `• ${o.label || JSON.stringify(o)}`))
          .join("\n")
        lines.push(opts)
      }
    } else if (env.type === "CONFIRMATION_REQUIRED") {
      const toolName = env.tool || env.targetTool || "tool"
      lines.push(
        env.message ||
          `I can run **${toolName}** with the following arguments. Reply **confirm** to proceed or **cancel** to abort.`
      )
      if (env.arguments) {
        lines.push("```json\n" + JSON.stringify(env.arguments, null, 2) + "\n```")
      }
      if (env.riskLevel) lines.push(`_Risk level: ${env.riskLevel}_`)
      pendingActionRef.current = {
        id: env.pendingActionId,
        tool: toolName,
        ts: Date.now(),
      }
    } else if (env.type === "FORBIDDEN") {
      // Friendlier message + actionable fallback when the classifier wants
      // an admin-only notification tool but the user is clearly trying to
      // contact the site owner.
      const rawMsg = env.message || "You don't have permission to run that action."
      const looksLikeContact =
        /contact|reach|message|email|notify/i.test(question || "") ||
        /notification\./i.test(rawMsg)
      if (looksLikeContact) {
        lines.push(
          `I can't send admin notifications from the chat (that's an owner-only tool).`,
          `If you want to **reach Yuqi directly**, use the contact form at the bottom of the home page — it emails him right away. ` +
            `Or send a note to **Yuqi.guo17@gmail.com**.`,
          `_Original classifier reason: ${rawMsg}_`,
        )
      } else {
        lines.push(rawMsg)
      }
    } else {
      lines.push("```json\n" + JSON.stringify(env, null, 2) + "\n```")
    }

    const content = lines.filter(Boolean).join("\n\n")
    clearStage(assistantId)
    finalizeAssistant(assistantId, content || "[empty agent response]")
    return { handled: true }
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

    // --- Site-tour intent shortcut ---
    // If the user explicitly asks for a web/site tour, skip the backend and
    // re-render the "Start web guide" CTA so they can launch it directly.
    const tourIntentRegex = /\b(?:guide\s+me(?:\s+(?:through|around|on|the))?(?:\s+(?:the\s+)?(?:web|site|website|portfolio|page))?|(?:web|site|website|guided)\s*tour|show\s+me\s+around|walk\s+me\s+through(?:\s+the\s+(?:site|web|website|portfolio))?|take\s+me\s+on\s+a\s+tour|start\s+(?:the\s+)?(?:web\s+)?guide)\b/i
    if (visibleText && readyFiles.length === 0 && !isThinking && tourIntentRegex.test(visibleText)) {
      setMessages((prev) => [...prev, { id: generateUUID(), role: "user", content: visibleText, attachments: [] }])
      setInput("")
      setComposerFiles([])
      setMessages((prev) => [
        ...prev,
        {
          id: generateUUID(),
          role: "assistant",
          content: "Sure — click below to start the guided web tour.",
          showGuideCta: true,
        },
      ])
      try {
        const dbMode = mode === "thinking" ? "deepthinking" : "regular"
        await supabase.from("Chat").insert([{ question: visibleText, answer: "[web tour CTA shown]", mode: dbMode }])
      } catch (dbErr) {
        logger.warn("Supabase insert failed", dbErr)
      }
      return
    }

    // --- Blog management auth guard ---
    if (visibleText && BLOG_MGMT_INTENT.test(visibleText)) {
      const { data: { session } } = await supabase.auth.getSession()
      const authedEmail = session?.user?.email
      if (!authedEmail || authedEmail.toLowerCase() !== BLOG_OWNER_EMAIL) {
        setMessages((prev) => [
          ...prev,
          { id: generateUUID(), role: "user", content: visibleText, attachments: [] },
          {
            id: generateUUID(),
            role: "assistant",
            content: "Blog management is restricted to the site owner. Please log in with the authorised account to continue.",
            showLoginCta: true,
          },
        ])
        setInput("")
        setComposerFiles([])
        setShowLoginDialog(true)
        return
      }
    }

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
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", streaming: true, thinkingNow: null, toolCards: [] }])

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
      const { data: { session: activeSession } } = await supabase.auth.getSession()
      const ownerEmail = activeSession?.user?.email || null

      // ── Fast mode: try the agent (MCP tools) before RAG ─────────────────
      // - If the user is responding to a pending confirmation, ship that
      //   straight to /api/agent/intent/confirm.
      // - Else pre-classify the utterance. If the agent owns it (OK / ASK /
      //   CONFIRMATION_REQUIRED / FORBIDDEN), render the envelope. Otherwise
      //   fall through to the existing Railway RAG SSE flow.
      if (requestMode === "regular") {
        if (pendingActionRef.current?.id) {
          const lower = baseQuestion.trim().toLowerCase()
          const isConfirm = /^(confirm|yes|y|go|proceed|ok|okay|do it|执行|确认|是的?|好的?)$/.test(lower)
          const isCancel = /^(cancel|no|n|stop|abort|nevermind|取消|不要?|否)$/.test(lower)
          if (isConfirm || isCancel) {
            const pendingId = pendingActionRef.current.id
            pendingActionRef.current = null
            const { handled } = await tryAgentIntent({
              question: baseQuestion,
              assistantId,
              currentSessionId: sessionId,
              pageContext: pageCtx,
              body: { sessionId, pendingActionId: pendingId, confirm: isConfirm },
            })
            if (handled) {
              await finalizeAndPersist("[agent envelope]")
              return
            }
          } else {
            // Unrelated message — drop the pending action and proceed normally.
            pendingActionRef.current = null
          }
        }

        // ── Manifest-driven routing ─────────────────────────────────────
        // No regex. No keyword list. The intent router (Gemini structured
        // classifier + validator) decides where the message goes based on
        // the live MCP tool manifest. Failure mode is "fall back to KB_QA"
        // so the user always gets an answer.
        const recentForRouter = messages
          .slice(-6)
          .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content.slice(0, 600) : "" }))
        const route = await callIntentRouter({
          question: baseQuestion,
          assistantId,
          recentMessages: recentForRouter,
          currentSessionId: sessionId,
        })

        if (route.routeKind === "CLARIFICATION_NEEDED") {
          const q =
            route.clarificationQuestion ||
            (route.missingArguments?.length
              ? `Could you tell me ${route.missingArguments.join(", ")}? I want to call **${route.targetTool}** but those fields are missing.`
              : "Could you give me a bit more detail?")
          clearStage(assistantId)
          finalizeAssistant(assistantId, q)
          await finalizeAndPersist(q)
          return
        }

        if (route.routeKind === "MCP_TOOL") {
          // Short-circuit: visitor-facing contact lives on the Next.js side
          // (existing /api/contact nodemailer endpoint). Don't round-trip
          // through Cloud Run for this — the agent-service ToolRegistry
          // intentionally allowlists only admin/notification tools.
          if (route.targetTool === "contact.email_owner") {
            const sent = await handleContactEmailOwner({
              args: route.toolArguments,
              assistantId,
            })
            if (sent) {
              await finalizeAndPersist("[contact sent]")
              return
            }
            // Defensive: validator missed required args → fall through to RAG.
          } else {
            // Hand the original utterance to the existing agent service for
            // actual execution. The router has already narrowed the set, so
            // only ~10% of messages reach the agent — its cold-start latency
            // no longer dominates the UX.
            const agentRes = await tryAgentIntent({
              question: baseQuestion,
              assistantId,
              currentSessionId: sessionId,
              pageContext: pageCtx,
              recentMessages: recentForRouter,
            })
            if (agentRes.handled) {
              await finalizeAndPersist("[agent envelope]")
              return
            }
            // Agent unreachable / disagreed → fall through to RAG below.
          }
        }
        // KB_QA + GENERAL_CHAT + any unhandled MCP_TOOL → RAG.
      }

      // Pass last 6 turns so RAG can resolve pronouns / follow-up questions.
      const historyForRag = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => typeof m.content === "string" && m.content.trim() && !m.streaming)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 800) }))
      await startRagSSE({ question: baseQuestion, fileUrls, assistantId, requestMode, currentSessionId: sessionId, onFinal: finalizeAndPersist, pageContext: pageCtx, userEmail: ownerEmail, conversationHistory: historyForRag })
    } catch (err) {
      if (err?.name === "AbortError") {
        // User stopped the stream — keep whatever partial content was buffered
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.streaming ? { ...m, streaming: false, thinkingNow: null } : m,
          ),
        )
      } else {
        console.error("[ChatWidget] SSE failed:", err)
        logger.error("SSE failed:", err)
        const msg =
          "⚠️ The chat backend isn't reachable right now. " +
          "Try a specific portfolio action (e.g. \"search blogs about React\") or come back later."
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: msg, streaming: false, thinkingNow: null } : m,
          ),
        )
      }
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

              {/* Persist completed tool/stage cards after streaming so the user can review what ran */}
              {m.role === "assistant" && !m.streaming && Array.isArray(m.toolCards) && m.toolCards.length > 0 ? (
                <ToolHistory cards={m.toolCards} />
              ) : null}

              {/* Task 3: Render TodoList when planPayload with subtasks is present */}
              {m.role === "assistant" && m.planPayload?.subtasks?.length > 0 ? (
                <TodoList subtasks={m.planPayload.subtasks} expanded={true} />
              ) : null}

              {/* Reasoning chain for Deep Thinking mode */}
              {m.role === "assistant" && m.reasoningSteps?.length > 0 ? (
                <ReasoningChain steps={m.reasoningSteps} streaming={m.streaming} />
              ) : null}

              {m.showLoginCta ? (
                <div className="cw-guide-message">
                  <p className="cw-guide-title">Login required</p>
                  <p className="cw-guide-copy">Blog management is restricted to the site owner.</p>
                  <div className="cw-guide-actions">
                    <button type="button" className="cw-guide-btn" onClick={() => setShowLoginDialog(true)}>
                      Log In
                      <ArrowUpRight className="cw-guide-ico" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : m.showGuideCta ? (
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

              {/* Key concepts bar for Enhance mode */}
              {m.role === "assistant" && !m.streaming && m.keyConcepts?.length > 0 ? (
                <KeyConceptsBar concepts={m.keyConcepts} />
              ) : null}

              {/* Source cards — shown below answer when KB hits have linkable content */}
              {m.role === "assistant" && !m.streaming && m.sourceCards?.length > 0 ? (
                <SourceCardsRow cards={m.sourceCards} />
              ) : null}

              {/* Related links — dynamic content suggestions from semantic search */}
              {m.role === "assistant" && !m.streaming && m.relatedLinks?.length > 0 ? (
                <RelatedLinks links={m.relatedLinks} />
              ) : null}
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

          {/* Stop / Send button */}
          {loading ? (
            <button
              type="button"
              aria-label="Stop generating"
              onClick={() => {
                // 1. Abort whichever phase's controller is in-flight
                //    (router / agent / contact / RAG-SSE all register here).
                if (abortRef.current) {
                  try { abortRef.current.abort() } catch {}
                  abortRef.current = null
                }
                // 2. Synchronous UI cleanup — never wait on the async catch
                //    path, which may not fire for every phase. The user
                //    expects the bubble to stop, the input to come back,
                //    and the spinner to go away immediately.
                setLoading(false)
                setMessages((prev) =>
                  prev.map((m) => {
                    if (!m.streaming) return m
                    stoppedAssistantIdsRef.current.add(m.id)
                    const now = Date.now()
                    const existing = Array.isArray(m.toolCards) ? m.toolCards : []
                    // Close any open card so the timeline shows a final duration.
                    const closedCards = existing.map((c) =>
                      c.tsEnd ? c : { ...c, tsEnd: now },
                    )
                    const trimmed = typeof m.content === "string" ? m.content.trim() : ""
                    return {
                      ...m,
                      streaming: false,
                      thinkingNow: null,
                      toolCards: closedCards,
                      content: trimmed ? m.content : "_Stopped._",
                      isHtml: trimmed ? m.isHtml : false,
                    }
                  }),
                )
              }}
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
                backgroundColor: "#ef4444",
                color: "white",
                border: "none",
                cursor: "pointer",
                padding: 0,
                boxSizing: "border-box",
              }}
            >
              <Square style={{ width: "16px", height: "16px", color: "white", fill: "white" }} />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send message"
              disabled={!input.trim() && composerFiles.length === 0}
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
                opacity: !input.trim() && composerFiles.length === 0 ? 0.5 : 1,
                padding: 0,
                boxSizing: "border-box",
              }}
            >
              <ArrowUpRight style={{ width: "18px", height: "18px", color: "white" }} />
            </button>
          )}

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
        /* ===== AG-UI Chat Agent Styles ===== */
        #__chat_widget_root .bot-container {
          height: min(68vh, 576px);
          max-height: 576px;
          background: linear-gradient(145deg, #ffffff 0%, #f8fafc 60%, #f1f5f9 100%) !important;
          position: relative;
          border: 1px solid rgba(99, 102, 241, 0.18) !important;
          box-shadow: 
            0 0 0 1px rgba(99, 102, 241, 0.08),
            0 20px 50px -12px rgba(0, 0, 0, 0.1),
            0 0 60px -20px rgba(99, 102, 241, 0.15),
            inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
        }
        
        #__chat_widget_root .bot-container::before {
          content: '';
          position: absolute;
          inset: 0;
          background: 
            radial-gradient(ellipse at top, rgba(99, 102, 241, 0.06) 0%, transparent 50%),
            radial-gradient(ellipse at bottom, rgba(139, 92, 246, 0.04) 0%, transparent 50%);
          pointer-events: none;
          border-radius: inherit;
        }
        
        #__chat_widget_root .bot-container::after {
          content: '';
          position: absolute;
          top: -1px;
          left: 20%;
          right: 20%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.5), transparent);
          pointer-events: none;
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
          background: linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%) !important;
          border-color: rgba(99, 102, 241, 0.3) !important;
          box-shadow: 
            0 0 0 1px rgba(99, 102, 241, 0.1),
            0 25px 60px -12px rgba(0, 0, 0, 0.5),
            0 0 80px -20px rgba(99, 102, 241, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
          color: #e5e7eb;
        }
        
        :global(body.dark-skin) #__chat_widget_root .bot-container::before,
        :global(.dark) #__chat_widget_root .bot-container::before {
          background: 
            radial-gradient(ellipse at top, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
            radial-gradient(ellipse at bottom right, rgba(139, 92, 246, 0.1) 0%, transparent 50%);
        }

        /* AG-UI Header */
        #__chat_widget_root .bot-header {
          background: rgba(248, 250, 252, 0.97) !important;
          backdrop-filter: blur(16px) !important;
          border-bottom: 1px solid rgba(99, 102, 241, 0.15) !important;
          color: #1e293b !important;
          position: relative;
          z-index: 10;
        }
        
        #__chat_widget_root .bot-header::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 10%;
          right: 10%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.4), transparent);
        }
        
        :global(body.dark-skin) #__chat_widget_root .bot-header,
        :global(.dark) #__chat_widget_root .bot-header {
          background: rgba(15, 23, 42, 0.97) !important;
          backdrop-filter: blur(16px);
          border-color: rgba(99, 102, 241, 0.2) !important;
          color: #e5e7eb !important;
        }

        /* AG-UI Messages Area */
        #__chat_widget_root .bot-messages {
          background: transparent !important;
          position: relative;
        }
        
        /* AG-UI Scrollbar */
        #__chat_widget_root .bot-messages::-webkit-scrollbar {
          width: 6px;
        }
        
        #__chat_widget_root .bot-messages::-webkit-scrollbar-track {
          background: transparent;
        }
        
        #__chat_widget_root .bot-messages::-webkit-scrollbar-thumb {
          background: rgba(99, 102, 241, 0.3);
          border-radius: 999px;
        }
        
        #__chat_widget_root .bot-messages::-webkit-scrollbar-thumb:hover {
          background: rgba(99, 102, 241, 0.5);
        }
        
        :global(body.dark-skin) #__chat_widget_root .bot-messages,
        :global(.dark) #__chat_widget_root .bot-messages {
          background: transparent !important;
        }
        
        /* AG-UI Input Area */
        #__chat_widget_root .input-area {
          background: rgba(248, 250, 252, 0.97) !important;
          backdrop-filter: blur(16px) !important;
          border-top: 1px solid rgba(99, 102, 241, 0.15) !important;
          position: relative;
        }
        
        #__chat_widget_root .input-area::before {
          content: '';
          position: absolute;
          top: 0;
          left: 10%;
          right: 10%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.3), transparent);
        }

        :global(body.dark-skin) #__chat_widget_root .input-area,
        :global(.dark) #__chat_widget_root .input-area {
          background: rgba(15, 23, 42, 0.9) !important;
          border-top-color: rgba(99, 102, 241, 0.2) !important;
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

        /* AG-UI User Bubble */
        #__chat_widget_root .cw-bubble-user {
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border: 1px solid rgba(139, 92, 246, 0.4);
          color: #ffffff;
          padding: 12px 18px;
          font-size: 14px;
          line-height: 1.55;
          border-radius: 20px 20px 6px 20px;
          box-shadow: 
            0 4px 16px rgba(99, 102, 241, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.15);
          position: relative;
        }
        
        #__chat_widget_root .cw-bubble-user::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 50%);
          pointer-events: none;
        }

        /* AG-UI Bot/Agent Bubble */
        #__chat_widget_root .cw-bubble-bot {
          background: rgba(241, 245, 249, 0.9);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(99, 102, 241, 0.15);
          color: #1e293b;
          padding: 12px 18px;
          font-size: 14px;
          line-height: 1.55;
          border-radius: 20px 20px 20px 6px;
          box-shadow: 
            0 4px 16px rgba(0, 0, 0, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
          position: relative;
        }
        
        #__chat_widget_root .cw-bubble-bot::before {
          content: '';
          position: absolute;
          left: -8px;
          top: 12px;
          width: 4px;
          height: 4px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border-radius: 50%;
          box-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-bubble-bot,
        :global(.dark) #__chat_widget_root .cw-bubble-bot {
          background: rgba(30, 41, 59, 0.85);
          backdrop-filter: blur(12px);
          border-color: rgba(99, 102, 241, 0.2);
          color: #e2e8f0;
          box-shadow: 
            0 4px 16px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
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

        /* ===== AG-UI Theme tokens ===== */
        :global(body) #__chat_widget_root {
          --cw-input-bg: rgba(248, 250, 252, 0.95);
          --cw-input-border: rgba(99, 102, 241, 0.2);
          --cw-input-border-strong: rgba(99, 102, 241, 0.4);
          --cw-input-text: #1e293b;
          --cw-input-placeholder: #94a3b8;
          --cw-attachment-border: rgba(99, 102, 241, 0.2);
          --cw-attachment-border-strong: rgba(99, 102, 241, 0.4);
          --cw-attachment-bg: rgba(241, 245, 249, 0.8);
          --cw-progress-surface: rgba(241, 245, 249, 0.9);
          --cw-progress-track: rgba(226, 232, 240, 0.8);
          --ag-accent: #6366f1;
          --ag-accent-glow: rgba(99, 102, 241, 0.3);
        }

        :global(body.dark-skin) #__chat_widget_root,
        :global(.dark) #__chat_widget_root {
          --cw-input-bg: rgba(30, 41, 59, 0.9);
          --cw-input-border: rgba(99, 102, 241, 0.3);
          --cw-input-border-strong: rgba(99, 102, 241, 0.5);
          --cw-input-text: #e2e8f0;
          --cw-input-placeholder: #94a3b8;
          --cw-attachment-border: rgba(99, 102, 241, 0.3);
          --cw-attachment-border-strong: rgba(99, 102, 241, 0.5);
          --cw-attachment-bg: rgba(30, 41, 59, 0.8);
          --cw-progress-surface: rgba(30, 41, 59, 0.9);
          --cw-progress-track: rgba(55, 65, 81, 0.8);
          --ag-accent: #818cf8;
          --ag-accent-glow: rgba(129, 140, 248, 0.5);
        }
        
        /* AG-UI Textbox styles */
        #__chat_widget_root .cw-textbox {
          background: var(--cw-input-bg) !important;
          border: 1px solid var(--cw-input-border) !important;
          color: var(--cw-input-text) !important;
          border-radius: 12px !important;
          transition: border-color 200ms ease, box-shadow 200ms ease !important;
        }
        
        #__chat_widget_root .cw-textbox:focus {
          border-color: var(--ag-accent) !important;
          box-shadow: 0 0 0 3px var(--ag-accent-glow), 0 0 20px -5px var(--ag-accent-glow) !important;
          outline: none !important;
        }
        
        /* AG-UI Send button */
        #__chat_widget_root .cw-send-btn,
        #__chat_widget_root button[type="submit"] {
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%) !important;
          border: none !important;
          color: white !important;
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3) !important;
          transition: transform 150ms ease, box-shadow 150ms ease !important;
        }
        
        #__chat_widget_root .cw-send-btn:hover,
        #__chat_widget_root button[type="submit"]:hover {
          transform: translateY(-1px) !important;
          box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4) !important;
        }
        
        /* AG-UI Loading/thinking animation */
        @keyframes ag-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        
        @keyframes ag-glow {
          0%, 100% { box-shadow: 0 0 5px var(--ag-accent-glow); }
          50% { box-shadow: 0 0 20px var(--ag-accent-glow), 0 0 40px var(--ag-accent-glow); }
        }
        
        #__chat_widget_root .cw-thinking-dot {
          animation: ag-pulse 1.4s ease-in-out infinite;
        }
        
        #__chat_widget_root .cw-thinking-dot:nth-child(2) {
          animation-delay: 0.2s;
        }
        
        #__chat_widget_root .cw-thinking-dot:nth-child(3) {
          animation-delay: 0.4s;
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

        /* AG-UI Mode Pills */
        #__chat_widget_root .cw-mode-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 10px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          background: rgba(99, 102, 241, 0.1);
          cursor: pointer;
          color: #374151;
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
          transition: all 200ms ease;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill,
        :global(.dark) #__chat_widget_root .cw-mode-pill {
          color: #e2e8f0;
        }

        #__chat_widget_root .cw-mode-pill:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--ag-accent-glow);
        }

        #__chat_widget_root .cw-mode-ico {
          width: 16px;
          height: 16px;
          flex: 0 0 auto;
          opacity: 0.95;
        }

        /* Fast mode - AG-UI style */
        #__chat_widget_root .cw-mode-pill.fast {
          background: rgba(99, 102, 241, 0.1);
          border-color: rgba(99, 102, 241, 0.2);
          color: #4338ca;
        }

        #__chat_widget_root .cw-mode-pill.fast:hover {
          background: rgba(99, 102, 241, 0.18);
          border-color: rgba(99, 102, 241, 0.35);
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.15);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.fast {
          background: rgba(99, 102, 241, 0.15);
          border-color: rgba(99, 102, 241, 0.25);
          color: #c7d2fe;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.fast:hover {
          background: rgba(99, 102, 241, 0.25);
          border-color: rgba(99, 102, 241, 0.4);
        }

        /* Deep mode - AG-UI amber accent */
        #__chat_widget_root .cw-mode-pill.deep {
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.1) 100%);
          border-color: rgba(245, 158, 11, 0.3);
          color: #b45309;
          box-shadow: 0 0 8px rgba(245, 158, 11, 0.1);
        }

        #__chat_widget_root .cw-mode-pill.deep:hover {
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(217, 119, 6, 0.18) 100%);
          border-color: rgba(245, 158, 11, 0.45);
          box-shadow: 0 0 16px rgba(245, 158, 11, 0.18);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.deep {
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.15) 100%);
          border-color: rgba(245, 158, 11, 0.35);
          color: #fcd34d;
          box-shadow: 0 0 12px rgba(245, 158, 11, 0.15);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.deep:hover {
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.3) 0%, rgba(217, 119, 6, 0.25) 100%);
          border-color: rgba(245, 158, 11, 0.5);
          box-shadow: 0 0 20px rgba(245, 158, 11, 0.25);
        }

        /* Guide mode pill */
        #__chat_widget_root .cw-mode-pill.guide {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(5, 150, 105, 0.08) 100%);
          border-color: rgba(16, 185, 129, 0.3);
          color: #047857;
        }
        #__chat_widget_root .cw-mode-pill.guide:hover {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.15) 100%);
          border-color: rgba(16, 185, 129, 0.5);
        }
        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.guide {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(5, 150, 105, 0.12) 100%);
          border-color: rgba(16, 185, 129, 0.35);
          color: #34d399;
        }

        /* Enhance mode pill */
        #__chat_widget_root .cw-mode-pill.enhance {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(109, 40, 217, 0.08) 100%);
          border-color: rgba(139, 92, 246, 0.3);
          color: #6d28d9;
        }
        #__chat_widget_root .cw-mode-pill.enhance:hover {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(109, 40, 217, 0.15) 100%);
          border-color: rgba(139, 92, 246, 0.5);
        }
        :global(body.dark-skin) #__chat_widget_root .cw-mode-pill.enhance {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.18) 0%, rgba(109, 40, 217, 0.12) 100%);
          border-color: rgba(139, 92, 246, 0.35);
          color: #c4b5fd;
        }

        /* Reasoning chain */
        #__chat_widget_root .cw-reasoning {
          margin-top: 8px;
          border: 1px solid rgba(245, 158, 11, 0.2);
          border-radius: 8px;
          overflow: hidden;
          background: rgba(245, 158, 11, 0.03);
        }
        #__chat_widget_root .cw-reasoning-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          background: none;
          border: none;
          color: inherit;
          text-align: left;
          opacity: 0.75;
        }
        #__chat_widget_root .cw-reasoning-toggle:hover { opacity: 1; }
        #__chat_widget_root .cw-r-ico { flex: 0 0 auto; color: #f59e0b; }
        #__chat_widget_root .cw-reasoning-steps {
          padding: 4px 10px 10px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        #__chat_widget_root .cw-rs {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12px;
          opacity: 0.7;
        }
        #__chat_widget_root .cw-rs.done { opacity: 1; }
        #__chat_widget_root .cw-rs.active { opacity: 0.9; }
        #__chat_widget_root .cw-rs-dot { flex: 0 0 auto; padding-top: 1px; }
        #__chat_widget_root .cw-rs-check { color: #10b981; }
        #__chat_widget_root .cw-rs-circle { color: #9ca3af; }
        #__chat_widget_root .cw-rs-label { font-weight: 500; }
        #__chat_widget_root .cw-rs-detail { font-size: 11px; opacity: 0.7; margin-top: 1px; }

        /* Key concepts bar */
        #__chat_widget_root .cw-concepts {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid rgba(0,0,0,0.08);
        }
        #__chat_widget_root .cw-concepts-label {
          font-size: 11px;
          font-weight: 600;
          opacity: 0.5;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          flex-shrink: 0;
        }
        #__chat_widget_root .cw-concept-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1.5px solid;
          background: rgba(255,255,255,0.5);
          cursor: default;
        }
        :global(body.dark-skin) #__chat_widget_root .cw-concepts {
          border-top-color: rgba(255,255,255,0.1);
        }
        :global(body.dark-skin) #__chat_widget_root .cw-concept-badge {
          background: rgba(0,0,0,0.2);
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

        /* AG-UI Brand/Title styling */
        #__chat_widget_root .cw-title {
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
          font-size: 20px;
          font-weight: 600;
          color: #1e293b;
          text-shadow: none;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-title,
        :global(.dark) #__chat_widget_root .cw-title {
          color: #e2e8f0;
          text-shadow: 0 0 20px rgba(99, 102, 241, 0.3);
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
          filter: drop-shadow(0 0 6px rgba(99, 102, 241, 0.7));
        }

        /* AG-UI Mode Menu */
        #__chat_widget_root .cw-mode-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          width: 240px;
          z-index: 200;
          border-radius: 14px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          background: rgba(255, 255, 255, 0.98);
          backdrop-filter: blur(16px);
          box-shadow: 
            0 16px 40px rgba(0, 0, 0, 0.12),
            0 0 30px rgba(99, 102, 241, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
          overflow: hidden;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-menu,
        :global(.dark) #__chat_widget_root .cw-mode-menu {
          border-color: rgba(99, 102, 241, 0.3);
          background: rgba(20, 27, 45, 0.98);
          box-shadow: 
            0 20px 50px rgba(0, 0, 0, 0.5),
            0 0 40px rgba(99, 102, 241, 0.2);
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
          color: #1e293b;
          transition: background-color 150ms ease;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-item,
        :global(.dark) #__chat_widget_root .cw-mode-item {
          color: #e2e8f0;
        }

        #__chat_widget_root .cw-mode-item:hover {
          background: rgba(99, 102, 241, 0.15);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-item:hover {
          background: rgba(99, 102, 241, 0.2);
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
          color: #1e293b;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-mode-name,
        :global(.dark) #__chat_widget_root .cw-mode-name {
          color: #e2e8f0;
        }

        #__chat_widget_root .cw-mode-desc {
          font-size: 12px;
          opacity: 0.6;
          line-height: 1.2;
          color: #94a3b8;
        }

        #__chat_widget_root .cw-check {
          width: 16px;
          height: 16px;
          opacity: 0.9;
          color: #818cf8;
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

        /* AG-UI Tour Button */
        #__chat_widget_root .cw-tour-btn {
          pointer-events: auto;
          border: 1px solid rgba(99, 102, 241, 0.3);
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%);
          backdrop-filter: blur(8px);
          box-shadow: 0 4px 16px rgba(99, 102, 241, 0.2) !important;
          color: #c7d2fe;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-tour-btn {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.08) 100%);
          border-color: rgba(99, 102, 241, 0.35);
          color: #c7d2fe;
        }

        #__chat_widget_root .cw-tour-btn {
          transition: all 200ms ease;
        }

        #__chat_widget_root .cw-tour-btn:not(:hover) {
          transition: all 150ms ease;
        }


        #__chat_widget_root .cw-tour-btn:hover {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(139, 92, 246, 0.2) 100%);
          border-color: rgba(99, 102, 241, 0.5);
          box-shadow: 0 6px 24px rgba(99, 102, 241, 0.35) !important;
          transform: translateY(-1px);
        }

        #__chat_widget_root .cw-tour-btn:active {
          transform: translateY(0px);
          box-shadow: 0 4px 16px rgba(99, 102, 241, 0.25) !important;
        }

        #__chat_widget_root .cw-tour-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--ag-accent-glow), 0 6px 24px rgba(99, 102, 241, 0.35) !important;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-tour-btn:hover {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.22) 0%, rgba(139, 92, 246, 0.18) 100%);
          border-color: rgba(99, 102, 241, 0.5);
          box-shadow: 0 8px 28px rgba(99, 102, 241, 0.4) !important;
          transform: translateY(-1px);
        }

        :global(body.dark-skin) #__chat_widget_root .cw-tour-btn:active {
          transform: translateY(0px);
          box-shadow: 0 5px 18px rgba(99, 102, 241, 0.3) !important;
        }

        :global(body.dark-skin) #__chat_widget_root .cw-tour-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--ag-accent-glow), 0 8px 28px rgba(99, 102, 241, 0.4) !important;
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

      <LogInDialog
        open={showLoginDialog}
        title="Owner Login Required"
        onClose={() => setShowLoginDialog(false)}
        onConfirm={async (email, password) => {
          const { error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) {
            logger.warn("Login failed", error.message)
            return { error: error.message }
          }
          setShowLoginDialog(false)
        }}
      />
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
