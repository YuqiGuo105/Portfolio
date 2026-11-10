import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { normalizeBrowserPlan, requestBrowserAction } from "../lib/browserActions.mjs";

const title = action => ({ open_project: "Open project", diagram_step: `Diagram: ${action.flow}, step ${action.step}`,
  globe_city: `Globe: ${action.city}`, terminal_command: `$ ${action.command}` })[action.type];

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
  return <div style={{ borderTop: "1px solid #87929a55", paddingTop: 10, marginTop: 10, fontSize: 12 }}>
    <ol style={{ paddingLeft: 18, overflowWrap: "anywhere" }}>{plan.actions.map((action, index) =>
      <li key={index}>{title(action)}{results[index] && <div role="status">{results[index]}</div>}</li>)}</ol>
    {!started.current && <button type="button" onClick={run} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Play size={14} /> Run on page</button>}
    {running && <button type="button" onClick={() => { cancelled.current = true; setRunning(false); }}><Square size={14} /> Stop next actions</button>}
  </div>;
}
