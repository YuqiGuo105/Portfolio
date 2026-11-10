import { publicEvidence } from "../lib/publicRunReplay.mjs";
import styles from "./RunReplay.module.css";

export default function RunReplay({ events = [], sources = [], streaming = false }) {
  if (!events.length) return null;
  const evidence = publicEvidence(sources);
  return <details className={styles.replay}>
    <summary>Execution record <span>{events.length} stages</span></summary>
    <ol>{events.map(event => <li key={event.stage}>
      <div><strong>{event.label}</strong><span>{event.status === "started" ? streaming ? "Running" : "Incomplete" : event.status}</span></div>
      <dl>
        <div><dt>Time</dt><dd>{event.durationMs == null ? "Not reported" : `${event.durationMs} ms`}</dd></div>
        <div><dt>Tokens in / out</dt><dd>{event.inputTokens ?? "--"} / {event.outputTokens ?? "--"}</dd></div>
        <div><dt>Est. step cost</dt><dd>{event.costUsd == null ? "Not reported" : `$${event.costUsd.toFixed(6)}`}</dd></div>
      </dl>
    </li>)}</ol>
    {evidence.length > 0 && <ul aria-label="Public evidence">{evidence.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a></li>)}</ul>}
  </details>;
}
