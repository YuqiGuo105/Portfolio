import { useId, useState } from "react"
import { BookOpen, Check, ChevronDown, Copy, LockKeyhole, MapPin, Timer, X, ThumbsDown, ThumbsUp } from "lucide-react"
import { isSourceLinked } from "../../lib/chatEvidence.mjs"
import { formatCost, formatCount, formatMs } from "../../lib/chatRunSummary.mjs"
import ResearchSteps from "./ResearchSteps"

function CopyButton({ text, label, className = "cw-act cw-act-icon", size = 15 }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }
  return (
    <button type="button" className={className} onClick={copy} aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>
      {copied ? <Check size={size} aria-hidden="true" /> : <Copy size={size} aria-hidden="true" />}
    </button>
  )
}

function Source({ source, index, answer }) {
  const [open, setOpen] = useState(false)
  const host = (() => { try { return new URL(source.url).hostname.replace(/^www\./, "") } catch { return "" } })()
  const excerpt = !source.sourceRequiresLogin && source.snippet ? source.snippet.trim() : ""
  return (
    <li className="cw-source">
      <span className="cw-source-n" aria-hidden="true">{index + 1}</span>
      <div className="cw-source-body">
        <a className="cw-source-title" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
        <div className="cw-source-meta">
          <span>{host}</span>
          <span>{isSourceLinked(answer, source.url) ? "Linked in the answer" : "Read for context"}</span>
          {source.sourceRequiresLogin ? <span className="cw-source-lock"><LockKeyhole size={11} aria-hidden="true" />Sign in to read</span> : null}
          {excerpt ? (
            <button type="button" className="cw-source-more" onClick={() => setOpen(value => !value)} aria-expanded={open}>
              {open ? "Hide excerpt" : "Excerpt"}
            </button>
          ) : null}
        </div>
        {open ? <blockquote className="cw-source-quote">{excerpt}</blockquote> : null}
      </div>
    </li>
  )
}

function RunRecord({ steps, totals, runId, research }) {
  const longest = Math.max(1, ...steps.map(step => step.durationMs || 0))
  const usage = [
    totals.inputTokens != null || totals.outputTokens != null
      ? `${formatCount((totals.inputTokens || 0) + (totals.outputTokens || 0))} tokens` : "",
    formatCost(totals.costUsd),
  ].filter(Boolean)
  return (
    <div className="cw-run">
      {research?.steps.length ? (
        <section className="cw-run-part">
          <h4 className="cw-run-head">Research</h4>
          <ResearchSteps items={research.steps} label="Research steps" />
        </section>
      ) : null}
      {research?.plan.length ? (
        <section className="cw-run-part">
          <h4 className="cw-run-head">Plan</h4>
          <ResearchSteps items={research.plan} label="Plan" />
        </section>
      ) : null}
      {research && steps.length ? <h4 className="cw-run-head cw-run-head-timing">Timing</h4> : null}
      <ol className="cw-run-steps">
        {steps.map(step => (
          <li key={step.key} className={`cw-run-step is-${step.status}`}>
            <span className="cw-run-name">{step.tool ? <code>{step.label}</code> : step.label}</span>
            <span className="cw-run-bar" aria-hidden="true">
              {step.durationMs != null ? <i style={{ width: `${Math.max(3, (step.durationMs / longest) * 100)}%` }} /> : null}
            </span>
            <span className="cw-run-time">
              {step.status === "failed" ? "Failed" : step.status === "running" ? "Running" : step.status === "incomplete" ? "Not finished" : formatMs(step.durationMs) || "Done"}
            </span>
            {step.inputTokens != null || step.outputTokens != null || step.costUsd != null ? (
              <span className="cw-run-usage">
                {step.inputTokens != null || step.outputTokens != null
                  ? `${formatCount(step.inputTokens) || "–"} tokens in, ${formatCount(step.outputTokens) || "–"} out` : ""}
                {step.costUsd != null ? `${step.inputTokens != null || step.outputTokens != null ? ", " : ""}about ${formatCost(step.costUsd)}` : ""}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="cw-run-foot">
        <span>
          {`${steps.length} step${steps.length === 1 ? "" : "s"}${totals.wallMs != null ? `, answered in ${formatMs(totals.wallMs)}` : ""}`}
          {usage.length ? `, ${usage.join(", ")}` : ""}
        </span>
        {runId ? (
          <span className="cw-run-id">
            <span>Run</span><code title={runId}>{runId.slice(0, 8)}</code>
            <CopyButton text={runId} label="Copy the run ID" className="cw-run-copy" size={12} />
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The line under a finished answer: what it was based on, how it was produced, a verdict and copy.
 * One panel is open at a time, so an answer never ends in a stack of disclosures.
 */
export default function AnswerFooter({ content = "", sources = [], steps = [], totals = {}, runId = "", guide = null, research = null, feedback = null, feedbackPending = false, onFeedback = null }) {
  const [panel, setPanel] = useState(null)
  const id = useId()
  const toggle = name => setPanel(current => current === name ? null : name)
  const hasRun = steps.length > 0 || Boolean(runId) || Boolean(research)
  const stepCount = steps.length ? `${steps.length} step${steps.length === 1 ? "" : "s"}` : "Run details"
  if (!content.trim() && !sources.length && !hasRun) return null

  return (
    <div className="cw-foot">
      <div className="cw-acts">
        {sources.length > 0 ? (
          <button type="button" className={`cw-act${panel === "sources" ? " is-open" : ""}`} onClick={() => toggle("sources")}
            aria-expanded={panel === "sources"} aria-controls={`${id}-sources`}>
            <BookOpen size={15} aria-hidden="true" />
            <span>Sources</span><span className="cw-act-n">{sources.length}</span>
            <ChevronDown className="cw-act-chev" size={13} aria-hidden="true" />
          </button>
        ) : null}
        {hasRun ? (
          <button type="button" className={`cw-act${panel === "run" ? " is-open" : ""}`} onClick={() => toggle("run")}
            aria-expanded={panel === "run"} aria-controls={`${id}-run`}
            aria-label={`How this answer was produced: ${stepCount}${totals.wallMs != null ? ` in ${formatMs(totals.wallMs)}` : ""}`}>
            {totals.failed ? <X size={15} aria-hidden="true" /> : <Timer size={15} aria-hidden="true" />}
            <span>{totals.failed ? "Failed" : totals.wallMs != null ? formatMs(totals.wallMs) : stepCount}</span>
            <ChevronDown className="cw-act-chev" size={13} aria-hidden="true" />
          </button>
        ) : null}
        {guide ? (
          <button type="button" className="cw-act" onClick={guide.onStart} title={guide.hint || undefined}>
            <MapPin size={15} aria-hidden="true" />
            <span>{guide.label}</span>
          </button>
        ) : null}
        {content.trim() ? (
          <span className="cw-act-end">
            {/* Pressing the one already chosen takes it back. */}
            {onFeedback ? (
              <>
                <button type="button" className={`cw-act cw-act-icon cw-act-rate${feedback === "up" ? " is-chosen" : ""}`} aria-pressed={feedback === "up"}
                  disabled={feedbackPending} aria-busy={feedbackPending} title={feedbackPending ? "Saving rating" : "Good answer"}
                  onClick={() => onFeedback(feedback === "up" ? null : "up")} aria-label="Good answer">
                  <ThumbsUp size={15} aria-hidden="true" />
                </button>
                <button type="button" className={`cw-act cw-act-icon cw-act-rate${feedback === "down" ? " is-chosen" : ""}`} aria-pressed={feedback === "down"}
                  disabled={feedbackPending} aria-busy={feedbackPending} title={feedbackPending ? "Saving rating" : "Not helpful"}
                  onClick={() => onFeedback(feedback === "down" ? null : "down")} aria-label="Not helpful">
                  <ThumbsDown size={15} aria-hidden="true" />
                </button>
              </>
            ) : null}
            <CopyButton text={content} label="Copy the answer" />
          </span>
        ) : null}
      </div>

      {panel === "sources" ? (
        <ol id={`${id}-sources`} className="cw-panel cw-sources" aria-label="Sources for this answer">
          {sources.map((source, index) => <Source key={source.url} source={source} index={index} answer={content} />)}
        </ol>
      ) : null}
      {panel === "run" ? (
        <div id={`${id}-run`} className="cw-panel" role="group" aria-label="How this answer was produced">
          <RunRecord steps={steps} totals={totals} runId={runId} research={research} />
        </div>
      ) : null}
    </div>
  )
}
