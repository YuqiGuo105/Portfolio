import { useEffect, useRef, useState } from "react";
import { Check, Play, Square } from "lucide-react";
import { normalizeBrowserPlan, requestBrowserAction } from "../lib/browserActions.mjs";

const FLOW_NAMES = { "ask-agent": "Ask the agent", "publish-content": "Publish content", "send-notification": "Send a notification",
  "track-visitor": "Track a visitor", "execute-mcp": "Run an MCP tool" };
// What each action does on the page, said the way the page itself names things.
const describe = action => ({
  open_project: { what: "Open the project", where: "" },
  diagram_step: { what: `Show step ${action.step} of the diagram`, where: FLOW_NAMES[action.flow] || action.flow },
  globe_city: { what: "Turn the globe to", where: action.city },
  terminal_command: { what: "Run in the terminal", where: action.command, code: true },
})[action.type];

export default function BrowserActionPlan({ plan: raw, active = false }) {
  const plan = normalizeBrowserPlan(raw);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const started = useRef(false);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const run = async () => {
    if (!plan || started.current) return;
    started.current = true; cancelled.current = false; setRunning(true);
    for (const action of plan.actions) {
      if (cancelled.current) break;
      try {
        const result = await requestBrowserAction(action);
        if (mounted.current) setResults(current => [...current, result]);
      } catch {
        if (mounted.current) setResults(current => [...current, "Could not complete this action. Try the page controls."]);
        break;
      }
    }
    if (mounted.current) setRunning(false);
  };
  useEffect(() => {
    mounted.current = true;
    cancelled.current = false;
    return () => { mounted.current = false; cancelled.current = true; };
  }, []);
  useEffect(() => {
    if (active && raw?.autoStart && !started.current) void run();
    // Plans are immutable for one assistant message; never replay on a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, raw]);
  if (!plan) return null;
  const finished = started.current && !running;
  return <div className="cw-plan">
    <p className="cw-plan-title">{plan.actions.length === 1 ? "One thing to show you on this page" : `${plan.actions.length} things to show you on this page`}</p>
    <ol className="cw-plan-steps">{plan.actions.map((action, index) => {
      const { what, where, code } = describe(action);
      const state = results[index] ? "is-done" : running && index === results.length ? "is-active" : "";
      return <li key={index} className={`cw-plan-step ${state}`}>
        <span className="cw-plan-n" aria-hidden="true">{results[index] ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
        <span className="cw-plan-text">
          <span>{what}{where ? " " : ""}{where ? (code ? <code>{where}</code> : <strong>{where}</strong>) : null}</span>
          {results[index] && <span className="cw-plan-result" role="status">{results[index]}</span>}
        </span>
      </li>;
    })}</ol>
    {!started.current && <button type="button" className="cw-guide-btn" onClick={run}><Play size={14} aria-hidden="true" /> Run on page</button>}
    {running && <button type="button" className="cw-plan-stop" onClick={() => { cancelled.current = true; setRunning(false); }}><Square size={12} aria-hidden="true" /> Stop next actions</button>}
    {finished && results.length < plan.actions.length && <p className="cw-plan-note">Stopped before the remaining {plan.actions.length - results.length === 1 ? "action" : "actions"}.</p>}
  </div>;
}
