"use client"

import { useState } from "react"
import { BookOpen, Wrench, ExternalLink, ChevronDown } from "lucide-react"

/**
 * Renders a list of related content links (blogs, projects) suggested by the backend's
 * ContentLinkService. Collapsed by default — click the header to expand.
 *
 * @param {{ links: Array<{type: string, id: string, title: string, url: string, snippet: string, relevanceScore: number}> }} props
 */
export default function RelatedLinks({ links }) {
  const [collapsed, setCollapsed] = useState(true)

  if (!links?.length) return null

  const getIcon = (type) => {
    if (type === "project") return <Wrench size={14} />
    if (type === "blog")    return <BookOpen size={14} />
    return <ExternalLink size={14} />
  }

  return (
    <div className="rl-container">
      <button
        type="button"
        className="rl-toggle"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="rl-label">Related content ({links.length})</span>
        <ChevronDown className={`rl-chev${collapsed ? "" : " open"}`} size={13} />
      </button>

      {!collapsed && (
        <div className="rl-list">
          {links.map((link, i) => (
            <a
              key={link.id || i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rl-card"
              title={link.title}
            >
              <span className="rl-icon">{getIcon(link.type)}</span>
              <div className="rl-body">
                <div className="rl-title">
                  {link.title?.length > 60
                    ? link.title.slice(0, 60) + "…"
                    : link.title}
                </div>
                {link.snippet && (
                  <div className="rl-snippet">
                    {link.snippet.length > 120
                      ? link.snippet.slice(0, 120) + "…"
                      : link.snippet}
                  </div>
                )}
              </div>
              <ExternalLink size={11} className="rl-ext-icon" />
            </a>
          ))}
        </div>
      )}

      <style jsx>{`
        .rl-container {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid rgba(0, 0, 0, 0.08);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .rl-toggle {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          align-self: flex-start;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          color: inherit;
        }
        .rl-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.45;
        }
        .rl-chev {
          opacity: 0.4;
          transition: transform 0.18s ease;
          flex-shrink: 0;
        }
        .rl-chev.open {
          transform: rotate(180deg);
        }
        .rl-list {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .rl-card {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.03);
          text-decoration: none;
          color: inherit;
          transition: background 0.15s ease;
          border: 1px solid transparent;
        }
        .rl-card:hover {
          background: rgba(0, 0, 0, 0.06);
          border-color: rgba(0, 0, 0, 0.08);
        }
        .rl-icon {
          flex-shrink: 0;
          margin-top: 2px;
          opacity: 0.55;
          color: #6b7280;
        }
        .rl-body {
          flex: 1;
          min-width: 0;
        }
        .rl-title {
          font-size: 12px;
          font-weight: 600;
          line-height: 1.35;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rl-snippet {
          font-size: 11px;
          opacity: 0.55;
          line-height: 1.4;
          margin-top: 2px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .rl-ext-icon {
          flex-shrink: 0;
          margin-top: 3px;
          opacity: 0.3;
        }

        /* Dark mode */
        :global(body.dark-skin) .rl-container {
          border-top-color: rgba(255, 255, 255, 0.1);
        }
        :global(body.dark-skin) .rl-card {
          background: rgba(255, 255, 255, 0.04);
        }
        :global(body.dark-skin) .rl-card:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.1);
        }
        :global(body.dark-skin) .rl-icon {
          color: #9ca3af;
        }
      `}</style>
    </div>
  )
}
