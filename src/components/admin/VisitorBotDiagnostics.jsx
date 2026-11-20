import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, FlaskConical, Info, RefreshCw, RotateCcw } from 'lucide-react';
import { classifyVisitorSample, DEFAULT_THRESHOLDS, DIAGNOSTIC_LIMIT, DIAGNOSTIC_RULES, scoreVisitorSample } from '../../lib/visitorBotDiagnostics.mjs';
import styles from './VisitorBotDiagnostics.module.css';

const labels = { high: 'High likelihood', suspected: 'Suspected', undetermined: 'Insufficient evidence' };
const utc = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'Time unavailable';
const delta = value => `${value > 0 ? '+' : ''}${value}`;

export default function VisitorBotDiagnostics({ api, filters, range, synthetic = false }) {
  const [expanded, setExpanded] = useState(false), [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0), [view, setView] = useState('candidates');
  const id = useId();
  const queryKey = JSON.stringify({ ...filters, ...range, view: 'events', page: 0, size: DIAGNOSTIC_LIMIT });
  useEffect(() => {
    if (window.location.hash === '#visitor-bot-diagnostics') setExpanded(true);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController(); let active = true;
    setLoading(true); setError(''); setSnapshot(null);
    api.visitors.list(JSON.parse(queryKey), { signal: controller.signal }).then(data => {
      if (!Array.isArray(data?.items)) throw new Error('Diagnostic response is missing event records. Refresh to retry.');
      if (active) setSnapshot({ key: queryKey, events: data.items, total: data.page?.totalElements });
    }).catch(cause => { if (active) setError(cause.message || 'Diagnostic sample unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [api, expanded, queryKey, revision]);
  const sample = useMemo(() => scoreVisitorSample(snapshot?.events), [snapshot]);
  const result = useMemo(() => classifyVisitorSample(sample, thresholds), [sample, thresholds]);
  const baseline = useMemo(() => classifyVisitorSample(sample), [sample]);
  const ready = !loading && !error && snapshot?.key === queryKey;
  const rows = result.sessions.filter(session => view === 'all' || session.verdict !== 'undetermined');
  const complete = Number.isInteger(snapshot?.total) && snapshot.total === snapshot.events.length && !sample.truncated;
  const statusId = `${id}-status`;
  return <section id="visitor-bot-diagnostics" aria-label="Bot diagnostic preview" className={styles.section}>
    <div className={styles.heading}>
      <div><h2><FlaskConical size={18} /> Bot diagnostic preview <span className={styles.badge}>Read only</span></h2><p>Candidate flags, separate from saved classifications</p></div>
      <button type="button" className={styles.iconButton} aria-label={`${expanded ? 'Collapse' : 'Expand'} bot diagnostics`} title={`${expanded ? 'Collapse' : 'Expand'} bot diagnostics`}
        aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}><ChevronDown size={18} className={!expanded ? styles.closed : ''} /></button>
    </div>
    <div id={id} hidden={!expanded}>
      <div className={styles.scope}>
        <div><strong>{synthetic ? 'Synthetic sample' : 'Filtered sample'}</strong><span>{utc(range?.from)} to {utc(range?.to)}</span></div>
        <button type="button" className={styles.iconButton} disabled={loading} title="Refresh diagnostic sample" aria-label="Refresh diagnostic sample" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /></button>
      </div>
      <div className={styles.controls}>
        <label htmlFor={`${id}-suspected`}><span>Suspected threshold <output>{thresholds.suspected}</output></span>
          <input id={`${id}-suspected`} type="range" min="1" max={thresholds.high - 1} step="1" value={thresholds.suspected} onChange={event => setThresholds(value => ({ ...value, suspected: Number(event.target.value) }))} />
        </label>
        <label htmlFor={`${id}-high`}><span>High-likelihood threshold <output>{thresholds.high}</output></span>
          <input id={`${id}-high`} type="range" min={thresholds.suspected + 1} max="100" step="1" value={thresholds.high} onChange={event => setThresholds(value => ({ ...value, high: Number(event.target.value) }))} />
        </label>
        <button type="button" className={styles.iconButton} title="Reset thresholds to 50 / 80" aria-label="Reset diagnostic thresholds" onClick={() => setThresholds(DEFAULT_THRESHOLDS)}><RotateCcw size={16} /></button>
      </div>
      {loading && <p className={styles.notice} role="status">Loading up to {DIAGNOSTIC_LIMIT} event records...</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {ready && <>
        <div className={styles.summary} aria-label="Diagnostic counts" id={statusId} role="status" aria-live="polite" aria-atomic="true">
          <div><span>Saved bot events</span><strong>{result.counts.stored}</strong><small>Unchanged</small></div>
          <div data-tone="review"><span>Additional events to review</span><strong>+{result.counts.additional}</strong><small>{delta(result.counts.additional - baseline.counts.additional)} vs default 50 / 80</small></div>
          <div><span>Saved + candidate events</span><strong>{result.counts.combined}<small> / {sample.eventCount}</small></strong><small>Preview union, not saved</small></div>
        </div>
        <div className={styles.distribution} aria-label="Session classification counts">
          <span data-tone="high">{result.counts.high} high-likelihood sessions <small>({delta(result.counts.high - baseline.counts.high)})</small></span>
          <span data-tone="suspected">{result.counts.suspected} suspected <small>({delta(result.counts.suspected - baseline.counts.suspected)})</small></span>
          <span>{result.counts.undetermined} insufficient evidence</span>
        </div>
        <div className={styles.caution}><Info size={16} /><div>
          <strong>{sample.eventCount} event records after ID deduplication. {complete ? 'All matching records loaded.' : 'Partial or unconfirmed coverage; not a site-wide estimate.'}</strong>
          <p>Behavior candidates require at least two signals. Shared IPs and fast scrolling can be legitimate. Scores are rule weights, not probabilities.</p>
          <p>No access blocked, records deleted, classifications saved or public totals changed.</p>
        </div></div>
        <div className={styles.resultHeading}><h3>Session candidates</h3><label>Show <select value={view} onChange={event => setView(event.target.value)} aria-label="Diagnostic results filter">
          <option value="candidates">Candidates only</option><option value="all">All sampled sessions</option>
        </select></label></div>
        {!rows.length && <p className={styles.notice}>{sample.eventCount ? 'No sessions meet these thresholds in the loaded sample. This does not establish that the visits were human.' : 'No event records in this sample.'}</p>}
        <div className={styles.results}>
          {rows.map(session => <details className={styles.session} key={session.key}>
            <summary>
              <span className={styles.identity}><strong>{session.sessionId || 'Session ID missing'}</strong><small>{session.paths.join('  >  ') || 'Path unavailable'}</small></span>
              <span className={styles.score} data-tone={session.verdict}><strong>{session.score}<small> / 100</small></strong><span>{labels[session.verdict]}</span></span>
              <span className={styles.recordCount}>{session.events.length} events<small>{session.storedBotCount} saved as bot</small></span>
              <ChevronDown size={16} />
            </summary>
            <div className={styles.evidence}>
              {session.reasons.length ? <ul>{session.reasons.map(reason => <li key={reason.id}><strong>{reason.title}</strong><span>{reason.evidence}</span></li>)}</ul> : <p>No supported automation signal in this sample.</p>}
              {session.score > 0 && !session.eligible && <p className={styles.singleSignal}>Only one behavior signal. Not flagged even when the threshold is lowered.</p>}
              {session.verdict !== 'undetermined' && <p>Candidate status is shared across this sampled session, not written to any event.</p>}
              <ol className={styles.events} aria-label={`Sampled records for ${session.sessionId || 'missing session'}`}>{session.events.map((event, index) => <li key={`${event.eventId || 'missing'}-${index}`}>
                <time>{utc(event.eventTime)}</time><strong>{event.eventName || 'Unknown event'}{event.properties?.progressPercent != null ? ` ${event.properties.progressPercent}%` : ''}</strong>
                <span>{event.pageUrl || '/'}</span><small>Saved: {event.bot === true ? 'bot' : event.bot === false ? 'not bot' : 'unknown'} | Preview: {labels[session.verdict]}</small>
              </li>)}</ol>
            </div>
          </details>)}
        </div>
        <details className={styles.rules}><summary>Scoring &amp; sample limitations <ChevronDown size={15} /></summary>
          <ul>{DIAGNOSTIC_RULES.map(rule => <li key={rule.id}><strong>{rule.title} +{rule.points}</strong><span>{rule.detail}</span></li>)}</ul>
          <p>Explicit automation user agents score 90. Existing valid server CAPTCHA risk of 50 or more can independently produce a candidate. The larger of direct risk and summed behavior weights is used; scores are capped at 100.</p>
          <p>Missing CAPTCHA, no referrer, city and hosting origin add zero points. Missing server timestamps disable concurrency evidence. No provider, identity or malicious intent is inferred.</p>
          <dl><div><dt>Matching events reported</dt><dd>{Number.isInteger(snapshot.total) ? snapshot.total : 'Unknown'}</dd></div><div><dt>Without valid CAPTCHA assessment</dt><dd>{sample.missingAssessment}</dd></div>
            <div><dt>Missing server receipt time</dt><dd>{sample.missingReceipt}</dd></div><div><dt>Missing session ID</dt><dd>{sample.missingSession}</dd></div>
            <div><dt>Duplicate event IDs ignored</dt><dd>{sample.duplicates}</dd></div><div><dt>Invalid / grouped rows skipped</dt><dd>{sample.invalid + sample.grouped}</dd></div><div><dt>Missing event ID (not deduplicated)</dt><dd>{sample.missingEventId}</dd></div></dl>
          <p>Only the newest {DIAGNOSTIC_LIMIT} matching raw events are read. Filters, pagination and delivery order can hide session context or alter the apparent first navigation sequence. No missing events are inferred; a non-candidate is not a verified human.</p>
        </details>
      </>}
    </div>
  </section>;
}
