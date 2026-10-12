import { useEffect, useId, useRef, useState } from 'react';
import { BellPlus, Check, Copy, ExternalLink, Filter, List, SearchCheck, Save, Trash2, X } from 'lucide-react';
import { alertFromVisitor, assessmentEvidence, eventTimestamp, mapLink, readSavedViews, referrerOrigin, sanitizeSavedView, sessionWindow, scrollDepthPercent } from '../../lib/visitorWorkbench.mjs';
import styles from './VisitorWorkbench.module.css';

export function CopyValue({ value, label }) {
  const [status, setStatus] = useState('');
  useEffect(() => { if (!status) return; const timer = setTimeout(() => setStatus(''), 2200); return () => clearTimeout(timer); }, [status]);
  return <><button type="button" className={styles.icon} disabled={!value} title={status || `Copy ${label}`} aria-label={`Copy ${label}`} onClick={async () => {
    try { await navigator.clipboard.writeText(String(value)); setStatus('Copied'); } catch { setStatus('Copy unavailable'); }
  }}>{status === 'Copied' ? <Check size={14} /> : <Copy size={14} />}</button><span role="status" className={styles.muted}>{status}</span></>;
}

function IconAction({ label, onClick, children, disabled }) {
  return <button type="button" title={label} aria-label={label} className={styles.icon} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function ScrollDepth({ event, compact = false }) {
  const percent = scrollDepthPercent(event);
  if (percent === null) return ['read_progress', 'engaged_time'].includes(event?.eventName)
    ? <span className={styles.muted}>Scroll depth not recorded</span> : null;
  return <span className={compact ? styles.depthCompact : styles.depth} title="Approximate furthest scroll checkpoint on this page, not proof that the content was read.">
    <span className={styles.depthLabel}>Scroll depth <strong>About {percent}%</strong></span>
    {!compact && <span className={styles.depthTrack} aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>}
  </span>;
}

export function VisitorContext({ item, onFilter, onInspect, onAlert, zone }) {
  const map = mapLink(item), source = referrerOrigin(item.referrer);
  return <div className={styles.root}>
    <div className={styles.context}>
      <div className={styles.field}><span className={styles.label}>Location</span>
        <div className={styles.line}>{map ? <a className={styles.link} href={map} target="_blank" rel="noopener noreferrer" title="Open approximate location in Google Maps">{[item.city, item.region].filter(Boolean).join(', ') || item.country}<ExternalLink size={12} /></a> : <strong>Unknown location</strong>}
          {item.city && <IconAction label="Filter this city" onClick={() => onFilter({ city: item.city, country: item.country || '' })}><Filter size={13} /></IconAction>}</div>
        <span className={styles.muted}>{item.country || 'No country'} · Approximate</span>
      </div>
      <div className={styles.field}><span className={styles.label}>Client</span>
        <button className={styles.link} type="button" disabled={!item.deviceType} onClick={() => onFilter({ device: item.deviceType })}>{item.deviceType || 'Unknown device'}</button>
        <span className={styles.muted}>{[item.browser, item.os].filter(Boolean).join(' · ') || 'Not recorded'}</span>
      </div>
      <div className={styles.field}><span className={styles.label}>Referrer</span>
        <div className={styles.line}>{source ? <><button className={styles.link} type="button" title="Filter this referrer" onClick={() => onFilter({ referrer: source.domain })}>{source.domain}</button>
          <a className={styles.icon} href={source.href} target="_blank" rel="noopener noreferrer" title="Open source website" aria-label="Open source website"><ExternalLink size={13} /></a></> : <strong>{item.referrer ? 'Unrecognized source' : 'Direct'}</strong>}</div>
        <span className={styles.muted}>{source ? 'Referral traffic' : 'No usable referrer'}</span>
      </div>
      <div className={styles.field}><span className={styles.label}>Visitor</span>
        <div className={styles.line}><button type="button" className={styles.link} title="Search records for this IP" disabled={!item.ipAddress} onClick={() => onFilter({ query: item.ipAddress })}>{item.ipAddress || 'Unknown IP'}</button><CopyValue value={item.ipAddress} label="IP address" /></div>
        <button type="button" className={styles.link} disabled={!item.sessionId} onClick={() => onInspect(item, 'timeline')}>Session {item.sessionId ? `${item.sessionId.slice(0, 8)}...${item.sessionId.slice(-5)}` : 'unavailable'}</button>
      </div>
    </div>
    <div className={styles.actions}>
      <button className={styles.button} type="button" disabled={!item.sessionId} onClick={() => onInspect(item, 'timeline')}><List size={14} /> Timeline</button>
      <button className={styles.button} type="button" onClick={() => onInspect(item, 'evidence')}><SearchCheck size={14} /> Classification evidence</button>
      <button className={styles.button} type="button" onClick={() => onAlert(item)}><BellPlus size={14} /> Create alert</button>
    </div>
    <details className={styles.ids}><summary>Visitor identifiers and timestamps</summary>
      {[['Session ID', item.sessionId], ['Anonymous ID', item.anonymousId], ['Event ID', item.eventId], ['Event time (ISO)', item.eventTime], ['Received time (ISO)', item.serverTime]].map(([label, value]) => <div className={styles.line} key={label}><span>{label}</span><code>{value || 'Not recorded'}</code><CopyValue value={value} label={label} /></div>)}
      <span className={styles.muted}>Received: {eventTimestamp(item.serverTime, zone)}. A shared IP does not establish a shared identity.</span>
    </details>
  </div>;
}

export function VisitorToolbar({ filters, hours, onRestore, zone, onZone, storageScope }) {
  const id = useId();
  const [views, setViews] = useState([]), [name, setName] = useState(''), [selected, setSelected] = useState(''), [status, setStatus] = useState('');
  const key = storageScope ? `visitor-views:v1:${storageScope}` : null;
  useEffect(() => { setSelected(''); setViews([]); setStatus(''); setName(''); if (!key) return; try { setViews(readSavedViews(localStorage.getItem(key))); } catch { setStatus('Browser storage is unavailable.'); } }, [key]);
  function persist(next, message) { if (!key) return false; try { localStorage.setItem(key, JSON.stringify(next)); setViews(next); setStatus(message); return true; } catch { setStatus('Could not save. Browser storage is unavailable.'); return false; } }
  return <div className={`${styles.root} ${styles.toolbar}`} role="region" aria-label="Visitor view options">
    <div className={styles.toolbarField}>
      <span id={`${id}-zone`} className={styles.toolbarLabel}>Time zone</span>
      <div className={styles.zoneSwitch} role="group" aria-label="Display time zone" aria-describedby={`${id}-zone`}>
        {[['local', 'Local'], ['UTC', 'UTC']].map(([value, label]) => <button key={value} type="button" aria-pressed={zone === value} onClick={() => onZone(value)}>{label}</button>)}
      </div>
    </div>
    <div className={styles.toolbarField}>
      <label htmlFor={`${id}-views`} className={styles.toolbarLabel}>Saved views</label>
      <div className={styles.controlRow}>
        <select id={`${id}-views`} aria-label="Saved filter views" disabled={!views.length} value={selected} onChange={e => { setSelected(e.target.value); const view = views.find(v => v.name === e.target.value); if (view) onRestore(view); }}><option value="">{views.length ? 'Select a view' : 'No saved views'}</option>{views.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</select>
        <IconAction label="Delete selected view" disabled={!selected} onClick={() => { if (persist(views.filter(v => v.name !== selected), 'View deleted.')) setSelected(''); }}><Trash2 size={16} /></IconAction>
      </div>
    </div>
    <form className={styles.toolbarField} onSubmit={e => { e.preventDefault(); const view = sanitizeSavedView({ name, filters, hours }); if (!view) return; if (views.some(v => v.name === view.name)) { setStatus('That name is already used.'); return; } if (views.length >= 12) { setStatus('Delete a saved view before adding another.'); return; } if (persist([...views, view], 'View saved in this browser.')) { setName(''); setSelected(view.name); } }}>
      <label htmlFor={`${id}-name`} className={styles.toolbarLabel}>Save current view</label>
      <div className={styles.controlRow}>
        <input id={`${id}-name`} aria-label="New view name" placeholder="Name this view" autoComplete="off" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        <button className={`${styles.icon} ${styles.saveAction}`} type="submit" title="Save view" aria-label="Save view" disabled={!name.trim() || !key}><Save size={16} /></button>
      </div>
    </form>
    {status && <span role="status" className={styles.status}>{status}</span>}
  </div>;
}

export function useDialogFocus(ref, onClose) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => [...(ref.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])].filter(el => el.getClientRects().length);
    focusables()[0]?.focus();
    const handler = e => {
      if (e.key === 'Escape') { e.preventDefault(); close.current?.(); }
      if (e.key === 'Tab') { const all = focusables(), first = all[0], last = all[all.length - 1]; if (!first) { e.preventDefault(); return; } if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [ref]);
}

export function VisitorInspector({ selection, api, hours, zone, onClose, onFilter, onAlert }) {
  const { item } = selection;
  const ref = useRef(null); useDialogFocus(ref, onClose);
  const [tab, setTab] = useState(selection.tab), [page, setPage] = useState(0), [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  const [window] = useState(() => sessionWindow(item, hours));
  useEffect(() => {
    if (tab === 'evidence' || !item.sessionId) return;
    let active = true; const controller = new AbortController();
    setLoading(true); setError(''); setResult(null);
    api.visitors.sessionEvidence({ sessionId: item.sessionId, window, page: { number: page, size: 25 } }, { signal: controller.signal })
      .then(data => { if (active) setResult(data); }).catch(e => { if (active) setError(e.message || 'Session evidence is unavailable.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [api, item.sessionId, window, page, retry, tab]);
  const evidence = assessmentEvidence(item), analysis = result?.trafficAnalysis;
  const events = [...(result?.items || [])].sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime));
  const pages = [...new Set(events.map(event => event.pageUrl || event.pagePath).filter(Boolean))];
  return <div className={`${styles.root} ${styles.shade}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="visitor-inspector-title" ref={ref}>
      <header className={styles.header}><div><span className={styles.label}>Private visitor record</span><h2 id="visitor-inspector-title">Session details</h2><code>{item.sessionId || 'Session not recorded'}</code></div><IconAction label="Close session details" onClick={onClose}><X size={18} /></IconAction></header>
      <div className={styles.tabs} role="tablist" aria-label="Session detail views">{[['timeline', 'Timeline'], ['evidence', 'Classification'], ['analysis', 'MCP analysis']].map(([id, label], index, tabs) => <button id={`visitor-tab-${id}`} aria-controls="visitor-detail-panel" role="tab" className={styles.tab} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} key={id} onClick={() => setTab(id)} onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3; setTab(tabs[next][0]); document.getElementById(`visitor-tab-${tabs[next][0]}`)?.focus(); }}>{label}</button>)}</div>
      <div className={styles.body} role="tabpanel" id="visitor-detail-panel" aria-labelledby={`visitor-tab-${tab}`} tabIndex={0}>
        {tab === 'evidence' ? <>
          <h3>Stored classification for this event</h3><dl><dt>Classification</dt><dd>{evidence.stored}</dd><dt>Assessment provider</dt><dd>{evidence.provider}</dd><dt>Assessment status</dt><dd>{evidence.status}</dd><dt>Human-likelihood score</dt><dd>{evidence.score === null ? 'Not available' : `${evidence.score} / 1 (higher means more human-like)`}</dd><dt>Verified bot flag</dt><dd>{evidence.verifiedBot ? 'Yes' : 'Not present'}</dd><dt>Reasons</dt><dd>{evidence.reasons.join(', ') || 'No provider reasons recorded'}</dd></dl>
          <h3>User agent</h3><p className={styles.muted}>{item.userAgent || 'Not recorded'}</p>
          <div className={styles.notice}>Not classified as a bot does not mean verified human. Location and referrer do not identify the visitor.</div>
        </> : <>
          <p className={styles.muted}>{eventTimestamp(window.from, zone)} to {eventTimestamp(window.to, zone)} (exclusive). Admin-page traffic is excluded.</p>
          {loading && <p role="status">Reading session evidence...</p>}
          {error && <div role="alert"><p className={styles.error}>{error}</p><button className={styles.button} onClick={() => setRetry(v => v + 1)}>Retry</button></div>}
          {!item.sessionId && <p>No session identifier was recorded.</p>}
          {result && tab === 'timeline' && <><p className={styles.muted}>{result.page?.totalElements ?? events.length} events in window. This page is ordered by event time; gaps are not measured dwell time.</p>
            <ol className={styles.timeline}>{events.map((event, index) => <li key={event.eventId || index}><time>{eventTimestamp(event.eventTime, zone)}</time><strong>{event.eventName === 'engaged_time' ? 'Legacy duration event' : String(event.eventName || 'Event').replace(/_/g, ' ')}</strong><span>{event.pageUrl || event.pagePath || 'Page not recorded'}</span><ScrollDepth event={event} />{event.targetUrl && <div className={styles.muted}>Target: {event.targetUrl}</div>}</li>)}</ol>{!events.length && <p>No events in this time window.</p>}</>}
          {result && tab === 'analysis' && <>
            <h3>{analysis ? String(analysis.verdict).replace(/_/g, ' ') : 'Analysis not available'}</h3>
            {analysis ? <><dl><dt>Evidence source</dt><dd>Admin MCP · visitor.get_session_events</dd><dt>Detector</dt><dd>{analysis.detector}</dd><dt>Sampled events</dt><dd>{analysis.sampledEvents} / {analysis.windowTotalEvents ?? 'unknown'}</dd><dt>Automation indicated</dt><dd>{analysis.counts?.automationIndicated ?? 0}</dd><dt>Stored flag conflicts</dt><dd>{analysis.counts?.storedFlagConflicts ?? 0}</dd><dt>Human verification</dt><dd>Not performed</dd></dl><div className={styles.notice}>{analysis.completeWindow ? 'All events in this window were returned.' : 'Partial evidence only. Read other pages before drawing conclusions.'}</div>
            <h3>Observed pages in this sample</h3><ul>{pages.map(path => <li key={path}>{path}</li>)}</ul>
            <h3>Supporting events</h3>{!events.some(e => e.automationEvidence?.verdict === 'AUTOMATION_INDICATED') && <p className={styles.muted}>No automation pattern matched in these returned events.</p>}<ol className={styles.timeline}>{events.filter(e => e.automationEvidence?.verdict === 'AUTOMATION_INDICATED').map(e => <li key={e.eventId}><strong>{e.eventName}</strong><time>{eventTimestamp(e.eventTime, zone)}</time><span>{e.automationEvidence.matches?.join(', ') || e.automationEvidence.basis}</span></li>)}</ol>
            <h3>Limitations</h3><ul>{(analysis.limitations || []).map((v, i) => <li key={i}>{v}</li>)}</ul></> : <p>The MCP service returned events without an analysis. No bot conclusion has been inferred.</p>}
          </>}
          {result && <div className={styles.pager}><button className={styles.button} disabled={!page || loading} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1}</span><button className={styles.button} disabled={loading || page + 1 >= (result.page?.totalPages || 1)} onClick={() => setPage(p => p + 1)}>Next</button></div>}
        </>}
        <div className={styles.actions}><button type="button" className={styles.button} disabled={!item.sessionId} onClick={() => { onFilter({ sessionId: item.sessionId }); onClose(); }}><Filter size={14} /> Filter session</button><button type="button" className={styles.button} onClick={() => { onAlert(item); onClose(); }}><BellPlus size={14} /> Create alert</button></div>
      </div>
    </section>
  </div>;
}

export { alertFromVisitor };
