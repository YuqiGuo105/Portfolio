import { useRef, useState } from "react"
import dynamic from "next/dynamic"
import { ArrowUpRight, Check, Copy } from "lucide-react"
import LinkGlyph from "./LinkGlyph"
import { describeLink, linkRows, looksLikeUrl, readableUrl } from "./linkMeta.mjs"

const ChatMarkdown = dynamic(() => import("../ChatMarkdown.mjs"))

function CodeBlock({ children }) {
  const preRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const code = Array.isArray(children) ? children[0] : children
  const language = (String(code?.props?.className || "").match(/language-([a-z0-9_+#-]+)/i) || [])[1]

  const copy = async () => {
    try {
      // Highlighting splits the code into spans, so read what is on screen, not the React children.
      await navigator.clipboard.writeText(String(preRef.current?.textContent || "").replace(/\n$/, ""))
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }

  return (
    <div className="cw-codeblock">
      <div className="cw-codeblock-head">
        <span className="cw-code-lang">{language || "code"}</span>
        <button type="button" className="cw-code-copy" onClick={copy} aria-label={copied ? "Code copied" : "Copy code"}>
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre ref={preRef} className="cw-pre">{children}</pre>
    </div>
  )
}

// A link inside a sentence. A pasted address is shown as host and path instead of the full URL.
function InlineLink({ node, href = "", children, ...props }) {
  const text = (Array.isArray(children) ? children : [children])
    .filter(child => typeof child === "string" || typeof child === "number").join("").trim()
  const external = /^(https?:)?\/\//i.test(href) && describeLink(href).external
  return (
    <a {...props} href={href} className="cw-inline-link"
      target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>
      {!text || looksLikeUrl(text) ? readableUrl(href, 48) : children}
    </a>
  )
}

// A bullet list that is nothing but links becomes rows: icon, name, address, each row one target.
function List({ node, children, ...props }) {
  const rows = linkRows(node)
  if (!rows) return <ul {...props}>{children}</ul>
  return (
    <ul className="cw-links">
      {rows.map((row, index) => (
        <li key={`${index}:${row.href}`}>
          <a className="cw-link-row" href={row.href}
            target={row.external ? "_blank" : undefined} rel={row.external ? "noreferrer noopener" : undefined}>
            <span className="cw-link-glyph"><LinkGlyph kind={row.kind} /></span>
            <span className="cw-link-text">
              <span className="cw-link-title">{row.title}</span>
              {row.detail ? <span className="cw-link-detail">{row.detail}</span> : null}
            </span>
            <ArrowUpRight className="cw-link-go" size={16} aria-hidden="true" />
            {row.external ? <span className="cw-sr">(opens in a new tab)</span> : null}
          </a>
        </li>
      ))}
    </ul>
  )
}

const Table = ({ node, ...props }) => <div className="cw-table-wrap"><table {...props} /></div>

// "120 ms" and "Outbox relay" stay on one line; only cells with real sentences wrap.
const cellText = node => node.type === "text" ? node.value : (node.children || []).map(cellText).join("")
const Cell = ({ node, className, ...props }) => {
  const Tag = node.tagName
  const short = cellText(node).trim().length <= 18
  return <Tag {...props} className={[className, short ? "cw-cell-short" : ""].filter(Boolean).join(" ") || undefined} />
}

// One stable object: a new one on every render would make ChatMarkdown rebuild the whole answer.
const COMPONENTS = { pre: CodeBlock, a: InlineLink, ul: List, table: Table, td: Cell, th: Cell }

// Formula output is rendered as React nodes, never through imperative DOM typesetting.
export default function AnswerMarkdown({ content, streaming = false }) {
  return (
    <div className="cw-md">
      <ChatMarkdown content={content} streaming={streaming} components={COMPONENTS} />
    </div>
  )
}
