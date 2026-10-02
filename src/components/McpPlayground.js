import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Clock3, FileSearch, GitBranch, Layers3, Loader2, Play, RotateCcw, ShieldCheck, Square, Terminal } from 'lucide-react';
import styles from '../../styles/McpPlayground.module.css';

const EXAMPLES = [
  { id: 'projects', label: 'Project match', Icon: Layers3, question: "Which project demonstrates Yuqi's distributed-systems experience?" },
  { id: 'kubernetes', label: 'Article search', Icon: FileSearch, question: 'Find articles about Kubernetes.' },
  { id: 'publishing', label: 'Publish flow', Icon: GitBranch, question: 'How does content move from publishing to search and AI retrieval?' },
];
const ERRORS = {
  rate_limited: 'Too many requests. Please wait a minute before trying again.',
  timeout: 'The MCP request timed out. Please try again.',
  upstream_busy: 'The public MCP service is busy. Please try again shortly.',
};
const duration = ms => `${(ms / 1000).toFixed(2)}s`;

export default function McpPlayground() {
  const [scenario, setScenario] = useState('projects');
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const active = useRef(null);
  const example = EXAMPLES.find(item => item.id === scenario);
  const running = phase === 'running';

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function stop(nextPhase = 'cancelled') {
    const controller = active.current;
    active.current = null;
    controller?.abort();
    setPhase(nextPhase);
  }

  function select(id) {
    stop('idle');
    setScenario(id);
    setResult(null);
    setError('');
  }

  async function run(event) {
    event.preventDefault();
    if (active.current || cooldown) return;
    const controller = new AbortController();
    active.current = controller;
    setPhase('running'); setResult(null); setError('');
    let timedOut = false;
    let failureMessage = 'The public MCP service is unavailable. Please try again.';
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 22_000);
    try {
      const response = await fetch('/api/mcp/playground', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', body: JSON.stringify({ scenario }), signal: controller.signal,
      });
      const data = await response.json();
      if (active.current !== controller) return;
      if (!response.ok) {
        if (response.status === 429) setCooldown(60);
        failureMessage = ERRORS[data.error] || failureMessage;
        throw new Error(failureMessage);
      }
      if (!Array.isArray(data.items) || !Array.isArray(data.calls) || data.scenario !== scenario) throw new Error('The result could not be read. Please try again.');
      setResult(data); setPhase('done');
    } catch {
      if (active.current !== controller) return;
      setError(timedOut ? ERRORS.timeout : failureMessage);
      setPhase('error');
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) active.current = null;
    }
  }

  const status = running ? 'Calling public MCP...' : result ? (result.status === 'empty' ? 'No matches' : 'Completed') : phase === 'cancelled' ? 'Stopped' : phase === 'error' ? 'Request failed' : 'Ready';

  return <div className={styles.playground}>
    <form onSubmit={run}>
      <fieldset className={styles.options}>
        <legend className={styles.srOnly}>Choose an MCP example</legend>
        {EXAMPLES.map(({ id, label, Icon }) => <label key={id} className={styles.option}>
          <input type="radio" name="mcp-example" value={id} checked={scenario === id} onChange={() => select(id)} />
          <span><Icon size={17} aria-hidden="true" />{label}</span>
        </label>)}
      </fieldset>
      <div className={styles.prompt}>
        <p>{example.question}</p>
        <div className={styles.actions}>
          <button type="submit" className={styles.run} disabled={running || cooldown > 0}>
            {running ? <Loader2 className={styles.spinner} size={16} /> : phase === 'error' ? <RotateCcw size={16} /> : <Play size={16} />}
            {running ? 'Running' : cooldown ? `Wait ${cooldown}s` : phase === 'error' ? 'Try again' : 'Run example'}
          </button>
          {running && <button type="button" className={styles.stop} onClick={() => stop()} aria-label="Stop example" title="Stop example"><Square size={15} /></button>}
        </div>
      </div>
    </form>

    <div className={styles.statusbar}>
      <span role="status" aria-live="polite">{result && <Check size={15} />}{status}</span>
      <span>{result ? <><Clock3 size={14} /> {duration(result.elapsedMs)} <span className={styles.separator}>/</span> {result.calls.length} tool call</> : <><ShieldCheck size={14} /> Public, read-only</>}</span>
    </div>

    {phase === 'error' && <p className={styles.error} role="alert">{error}</p>}
    {running && <div className={styles.loading} aria-hidden="true"><span /><span /><span /></div>}
    {result && <div className={styles.output}>
      {result.status === 'empty' && <p className={styles.notice}>No matching public records were returned for this query.</p>}
      <ul className={styles.results} aria-label="MCP results">
        {result.items.map((item, index) => <li key={item.url}>
          <span className={styles.resultIndex}>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <div className={styles.kind}>{item.type === 'PROJECT' ? 'Project' : 'Article'}{item.sourceRequiresLogin && ' / Sign-in required to read'}</div>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            <div className={styles.tags}>{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          </div>
        </li>)}
      </ul>
      {result.steps.length > 0 && <div className={styles.workflow}>
        <h3>Publication workflow</h3>
        <ol>{result.steps.map((step, index) => <li key={`${index}-${step.title}`}>
          <span className={styles.stepNumber}>{index + 1}</span>
          <div><h4>{step.title}</h4><p>{step.responsibility}</p><span className={styles.guarantee}>{step.guarantee}</span></div>
        </li>)}</ol>
      </div>}
      {result.status === 'partial' && <p className={styles.notice}>The publication steps are not available in the public response. Read the original project for details.</p>}
      {result.sources.length > 0 && <div className={styles.sources}>
        <h3>Sources <span>{result.sources.length}</span></h3>
        {result.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ArrowUpRight size={14} /></a>)}
      </div>}
      <details className={styles.trace} key={result.retrievedAt}>
        <summary><Terminal size={16} /><span>Tool call record</span><span className={styles.traceTime}>{duration(result.elapsedMs)}</span><ChevronDown size={16} className={styles.chevron} /></summary>
        {result.calls.map(call => <div className={styles.call} key={call.name}>
          <div className={styles.callTitle}><code>{call.name}</code><span>{call.status}</span></div>
          <h4>Request</h4><pre>{JSON.stringify({ name: call.name, arguments: call.arguments }, null, 2)}</pre>
          <h4>Public result excerpt</h4><pre>{JSON.stringify(call.result, null, 2)}</pre>
        </div>)}
        <p className={styles.retrieved}>Retrieved <time dateTime={result.retrievedAt}>{new Date(result.retrievedAt).toLocaleString()}</time></p>
      </details>
    </div>}
  </div>;
}
