import { BookOpen, ChevronDown, ExternalLink } from "lucide-react"
import { isSourceLinked, mergeEvidence } from "../lib/chatEvidence.mjs"

export default function AnswerSources({ cards = [], related = [], answer = "" }) {
  const sources = mergeEvidence(cards, related)
  if (!sources.length) return null
  return <details className="answer-sources" aria-label="Answer sources">
    <summary className="sources-toggle" title="Show or hide answer sources">
      <BookOpen size={15} aria-hidden="true" />
      <span>Sources</span><span className="sources-count">{sources.length}</span>
      <ChevronDown className="sources-chevron" size={14} aria-hidden="true" />
    </summary>
    <ol>
      {sources.map((source, index) => <li key={source.url}>
        <span className="source-number">{index + 1}</span>
        <div className="source-copy">
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title}<ExternalLink size={12} aria-hidden="true" />
          </a>
          <div className="source-meta">
            {new URL(source.url).hostname.replace(/^www\./, "")} · {isSourceLinked(answer, source.url) ? "Linked in answer" : "Retrieved context"}
          </div>
          {source.snippet ? <details>
            <summary>View source excerpt</summary>
            <blockquote>{source.snippet}</blockquote>
          </details> : null}
        </div>
      </li>)}
    </ol>
    <style jsx>{`
      .answer-sources { margin: 10px 0 0; color: inherit; }
      .sources-toggle { display: flex; align-items: center; gap: 7px; width: fit-content; max-width: 100%; min-height: 44px; padding: 0 8px; border-radius: 6px; font-size: 12px; font-weight: 500; list-style: none; letter-spacing: 0; }
      .sources-toggle::-webkit-details-marker { display: none; }
      .sources-toggle:hover { background: #94a3b81a; }
      .sources-count { opacity: .65; font-variant-numeric: tabular-nums; }
      .sources-toggle :global(svg) { flex-shrink: 0; }
      .sources-toggle :global(.sources-chevron) { transition: transform 160ms ease; opacity: .65; }
      .answer-sources[open] > .sources-toggle :global(.sources-chevron) { transform: rotate(180deg); }
      .answer-sources[open] > ol { margin-top: 4px; border-top: 1px solid #94a3b833; }
      @media (prefers-reduced-motion: reduce) { .sources-toggle :global(.sources-chevron) { transition: none; } }
      ol { list-style: none; padding: 0; margin: 0; }
      li { display: flex; align-items: flex-start; gap: 9px; padding: 9px 0; border-bottom: 1px solid #94a3b822; }
      .source-number { flex: 0 0 22px; text-align: center; font-size: 12px; line-height: 22px; color: #137a70; background: #2ab5a41a; border-radius: 4px; }
      .source-copy { min-width: 0; flex: 1; }
      a { display: inline; font-size: 13px; font-weight: 600; line-height: 1.5; color: inherit; text-decoration: underline; text-decoration-color: #268d8277; text-underline-offset: 3px; overflow-wrap: anywhere; }
      a :global(svg) { margin-left: 5px; vertical-align: middle; }
      .source-meta { font-size: 11px; opacity: .75; line-height: 1.6; margin-top: 3px; overflow-wrap: anywhere; }
      details { margin-top: 4px; font-size: 12px; }
      summary { cursor: pointer; padding: 4px 0; line-height: 1.5; }
      blockquote { margin: 6px 0 2px; padding: 4px 10px; border-left: 2px solid #268d82; font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
      a:focus-visible, summary:focus-visible { outline: 2px solid #268d82; outline-offset: 3px; }
    `}</style>
  </details>
}
