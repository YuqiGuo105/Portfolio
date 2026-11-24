import { useEffect, useId, useMemo, useState } from 'react';
import { Activity, ChevronDown, RefreshCw, Video, ExternalLink } from 'lucide-react';
import { analyzeActivity, activityDestination, EVENT_LABELS } from '../../lib/visitorActivity.mjs';
import { visitorContentReference } from '../../lib/visitorWorkbench.mjs';
import { DIAGNOSTIC_LIMIT } from '../../lib/visitorBotDiagnostics.mjs';
import styles from './VisitorActivity.module.css';

const date = value => new Date(value).toLocaleString(undefined, { hour12: false });
const riskLabel = { saved_bot: 'Saved bot', candidate: 'Review candidate', unknown: 'Unclassified' };

function Destination({ value }) {
  return value?.href ? <a className={styles.destination} href={value.href} target="_blank" rel="noopener noreferrer">
    {value.coverUrl && <img src={value.coverUrl} width={40} height={32} loading="lazy" alt="" onError={e => { e.currentTarget.hidden = true; }} />}
    <span>{value.label || value.title}<small>{value.path || value.href}</small></span><ExternalLink size={13} />
  </a> : <span>Destination not recorded</span>;
}

export default function VisitorActivity({ api, filters = {}, range = {}, initialExpanded = false, synthetic = false }) {
  const [expanded, setExpanded] = useState(initialExpanded), [tab, setTab] = useState('recent');
  const [windowMinutes, setWindow] = useState(0), [risk, setRisk] = useState('all'), [threshold, setThreshold] = useState(50);
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const id = useId(), query = JSON.stringify({ ...filters, ...range, page: 0, size: DIAGNOSTIC_LIMIT, view: 'events' });
  useEffect(() => {
    if (!expanded) return undefined;
    const abort = new AbortController(); let current = true;
    setBusy(true); setError(''); setSnapshot(null);
    api.visitors.list(JSON.parse(query), { signal: abort.signal }).then(data => {
      if (!Array.isArray(data?.items)) throw new Error('Event records unavailable.');
      if (current) setSnapshot({ items: data.items, total: data.page?.totalElements, query });
    }).catch(cause => { if (current) setError(cause.message || 'Could not load activity.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; abort.abort(); };
  }, [expanded, api, query, revision]);
  const result = useMemo(() => analyzeActivity(snapshot?.items, { windowMinutes, risk, threshold }), [snapshot, windowMinutes, risk, threshold]);
  const ready = snapshot?.query === query && !busy && !error;
  const counts = result.counts;
  return <section className={styles.section} id="visitor-activity" aria-label="Recent activity and widgets">
    <header className={styles.header}><h2><Activity size={19} /> Activity &amp; media</h2>
      <button type="button" className={styles.icon} aria-expanded={expanded} aria-controls={id} aria-label={`${expanded ? 'Collapse' : 'Expand'} activity`} title="Activity" onClick={() => setExpanded(!expanded)}><ChevronDown size={18} /></button></header>
    <div id={id} hidden={!expanded}>
      <div className={styles.scope}><span>{synthetic ? 'Local synthetic sample' : 'Recent filtered sample'} · Up to {DIAGNOSTIC_LIMIT} records</span>
        <button type="button" className={styles.icon} disabled={busy} aria-label="Refresh activity" title="Refresh activity" onClick={() => setRevision(revision + 1)}><RefreshCw size={17} /></button></div>
      <div className={styles.controls}>
        <label>Group by<select aria-label="Activity grouping" value={windowMinutes} onChange={e => setWindow(Number(e.target.value))}>
          <option value={0}>Session</option>{[5, 15, 30].map(n => <option key={n} value={n}>Same IP / {n} min</option>)}</select></label>
        <label>Traffic<select aria-label="Activity traffic" value={risk} onChange={e => setRisk(e.target.value)}>
          <option value="all">All records</option><option value="exclude">Exclude bot / candidates</option><option value="review">Bot / candidates only</option></select></label>
        <label>Review threshold <output>{threshold}</output><input aria-label="Activity review threshold" type="range" min={1} max={79} value={threshold} onChange={e => setThreshold(Number(e.target.value))} /></label>
      </div>
      <p className={styles.note}>View-only grouping and filtering. Same IP is not the same person. Missing CAPTCHA is unknown, not bot.</p>
      {busy && <p role="status">Loading activity...</p>}{error && <p role="alert">{error}</p>}
      {ready && <>
        <div className={styles.metrics} aria-live="polite">
          <div><span>Records shown</span><strong>{counts.shown} / {counts.records}</strong></div>
          <div><span>Sessions / groups</span><strong>{counts.sessions} / {counts.groups}</strong></div>
          <div><span>Saved bot sessions</span><strong>{counts.savedBot}</strong></div>
          <div><span>Candidate sessions</span><strong>{counts.candidates}</strong></div>
        </div>
        <div className={styles.tabs} role="group" aria-label="Activity view">{[['recent', 'Recent activity'], ['clicks', 'Click destinations'], ['widgets', 'Widget events'], ['media', 'Video performance']].map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
        {tab === 'recent' && <div className={styles.journeys}>{result.groups.map(group => <details key={group.key}>
          <summary><span><strong>{visitorContentReference(group.events[0]).title}</strong><small>{date(group.end)} · {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}{group.network ? ' · Shared-network group' : ''}</small></span><span>{group.events.length} events</span><ChevronDown size={16} /></summary>
          <div className={styles.detail}>
            <p>{group.sessions.map(session => riskLabel[session.risk]).filter((label, i, all) => all.indexOf(label) === i).join(' · ')}</p>
            {group.sessions.flatMap(s => s.reasons).map((r, i) => <p key={`${r.id}-${i}`}><strong>{r.title}:</strong> {r.evidence}</p>)}
            <ol>{group.events.map((event, i) => <li key={`${event.eventId}-${i}`}><time>{date(event.eventTime || event.serverTime)}</time><strong>{EVENT_LABELS[event.eventName] || event.eventName}</strong><span>{event.properties?.action || ''}{event.properties?.progressPercent != null ? ` ${event.properties.progressPercent}%` : ''}</span><Destination value={activityDestination(event) || visitorContentReference(event)} /></li>)}</ol>
            <details><summary>Identifiers &amp; assessment coverage</summary><p>IP: {group.ip || 'Not recorded'}</p>{group.sessions.map(s => <p key={s.key}>Session: {s.sessionId || 'Missing'} · {s.events.filter(e => e.properties?.botAssessmentStatus === 'VALID').length} assessed events</p>)}</details>
          </div>
        </details>)}{!result.groups.length && <p>No activity in this view.</p>}</div>}
        {tab === 'clicks' && <div className={styles.tableWrap}><table><thead><tr><th>Destination</th><th>Source</th><th>Clicks</th><th>Sessions</th></tr></thead><tbody>{result.clicks.map(c => <tr key={c.key}><td><Destination value={c} /></td><td>{c.component}<small>{EVENT_LABELS[c.event]}</small></td><td>{c.count}</td><td>{c.sessions}</td></tr>)}</tbody></table>{!result.clicks.length && <p>No click events in this sample.</p>}</div>}
        {tab === 'widgets' && <div className={styles.tableWrap}><table><thead><tr><th>Widget / actions</th><th>Opens</th><th>Other events</th><th>Sessions</th></tr></thead><tbody>{result.widgets.map(w => <tr key={w.component}><th>{w.component}<details className={styles.breakdown}><summary>Actions</summary><dl>{w.breakdown.map(a => <div key={a.action}><dt>{a.action.replaceAll('_', ' ')}</dt><dd>{a.count}</dd></div>)}</dl></details></th><td>{w.opens}</td><td>{w.actions}</td><td>{w.sessions}</td></tr>)}</tbody></table>{!result.widgets.length && <p>No widget events in this sample.</p>}</div>}
        {tab === 'media' && <div>{result.media.map(m => <article key={m.key} className={styles.media}><h3><Video size={17} /> {m.placement === 'home_intro' ? 'Homepage introduction' : m.reference.title}</h3><p>{m.placement} · Media {m.id} · Version {String(m.version).slice(0, 32)}</p><dl>
          {[[m.impressions, 'Exposed sessions'], [m.previews, 'Preview starts'], [m.autoPreviews, 'Auto previews'], [m.requests, 'Play requests'], [m.starts, 'Play starts'], [m.completed, 'Completed'], [`${m.watched}s`, 'Watched'], [m.stalls, 'Stalls'], [m.errors, 'Error events']].map(([value, label]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {m.partial > 0 && <small>{m.partial} playback records have no start event in this sample.</small>}</article>)}{!result.media.length && <p>No video events in this sample. Earlier visits cannot be reconstructed.</p>}</div>}
        <details className={styles.technical}><summary>Scope &amp; counting</summary><p>{snapshot.total ?? 'Unknown'} matching records reported; {counts.records} loaded after event-ID deduplication ({counts.duplicates} retries ignored). This is a recent sample, not full-period totals or a conversion-rate report.</p><p>Preview is separate from deliberate playback. Watch summaries use the maximum cumulative value per playback ID, not a sum. Completion requires at least 95% observed coverage; seeking does not count.</p><p>Classification reuses existing diagnostic rules. No record is deleted, access blocked, saved classification or public statistic changed.</p></details>
      </>}
    </div>
  </section>;
}
