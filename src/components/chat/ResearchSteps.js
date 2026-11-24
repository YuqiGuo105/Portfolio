import { Check } from "lucide-react"

/**
 * The steps of a Deep answer as one list: done, in hand, or still to come.
 * Shown under the progress line while the answer is being prepared, and again inside the
 * record under the finished answer, so nothing has to stay parked above the answer itself.
 */
export default function ResearchSteps({ items, label }) {
  if (!items?.length) return null
  return (
    <ol className="cw-steps" aria-label={label}>
      {items.map((item, index) => (
        <li key={`${index}:${item.label}`} className={`cw-step${item.done ? " is-done" : item.active ? " is-active" : ""}`}>
          <span className="cw-step-mark" aria-hidden="true">{item.done ? <Check size={11} strokeWidth={3} /> : null}</span>
          <span className="cw-step-text">
            <span className="cw-step-label">{item.label}</span>
            {item.detail ? <span className="cw-step-detail">{item.detail}</span> : null}
          </span>
          <span className="cw-sr">{item.done ? ", done" : item.active ? ", in progress" : ""}</span>
        </li>
      ))}
    </ol>
  )
}
