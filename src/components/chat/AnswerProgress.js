import { useEffect, useState } from "react"

/**
 * One quiet line while the answer is being prepared: what is happening now and for how long.
 * It replaces the boxed step card; the full list of steps is under the finished answer.
 */
export default function AnswerProgress({ label, since }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Number.isFinite(since) ? Math.max(0, (now - since) / 1000) : null
  return (
    <div className="cw-progress" role="status" aria-live="polite">
      <span className="cw-progress-label">{label}</span>
      {seconds != null && seconds >= 1 ? <span className="cw-progress-time" aria-hidden="true">{seconds.toFixed(seconds < 10 ? 1 : 0)} s</span> : null}
    </div>
  )
}
