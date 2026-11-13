import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { adminStyles as ui } from './AdminUI';
import styles from './DiscoveryPanel.module.css';

const percent = (n, d) => d ? `${((n || 0) / d * 100).toFixed(1)}%` : 'No data';
export default function DiscoveryPanel({ request }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setData(await request()); setError(''); } catch (err) { setError(err.message); } }, [request]);
  useEffect(() => { load(); }, [load]);
  async function review(id, action) {
    setBusy(id);
    try { await request({ method: 'POST', body: JSON.stringify({ id, action }) }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  const metrics = data?.metrics || {}, reviews = data?.reviews || [];
  return <div className={styles.root}>
    <header className={styles.header}><div><h1>Discovery & safety</h1><p>{data?.preview ? 'Local preview · isolated review queue' : 'Content discovery and submission review'}</p></div>
      <button type="button" className={ui.iconButton} onClick={load} aria-label="Refresh" title="Refresh"><RefreshCw size={18} /></button></header>
    {error && <p className={ui.errorBanner} role="alert">{error}</p>}
    {data?.learningPaused && <p role="status">Learning paused at the retention capacity. Existing rankings remain available.</p>}
    {data?.worker?.status === 'error' && <p className={ui.errorBanner} role="alert">The latest background update failed. Cached results remain available.</p>}
    <dl className={styles.metrics}>
      <div><dt>Waiting for review</dt><dd>{reviews.filter(row => row.status === 'pending').length}</dd></div>
      <div><dt>Search click-through</dt><dd>{percent(metrics.searchClicks, metrics.searches)}</dd></div>
      <div><dt>Recommendation click-through</dt><dd>{percent(metrics.recommendationClicks, metrics.recommendations)}</dd></div>
      <div><dt>Public documents indexed</dt><dd>{data?.build?.documents ?? 'Not built'}</dd></div>
    </dl>
    {data?.worker?.at && <p className={styles.reason}>Background update: {new Date(data.worker.at).toLocaleString()} · {data.worker.status} · hourly</p>}
    <section className={styles.section}><div className={styles.header}><h2>Submission review</h2><Link href="/admin/globe-flags"><a>Globe notes <ExternalLink size={14} /></a></Link></div>
      {!reviews.length && <p className={styles.empty}>No submissions waiting.</p>}
      {reviews.map(row => <article key={row.id} className={styles.review}>
        <div className={styles.reviewMeta}><strong>{row.channel === 'contact' ? 'Contact form' : 'Chat'}</strong><span>{row.status.replaceAll('_', ' ')}</span><time>{new Date(row.created_at).toLocaleString()}</time></div>
        <p className={styles.message}>{row.text}</p>
        {row.context?.email && <p>{row.context.name} · {row.context.email}</p>}
        <div className={styles.actions}><span className={styles.reason}>{row.reason === 'unavailable' ? 'Automatic check unavailable' : row.reason}{row.risk != null ? ` · risk ${row.risk}/100` : ''}</span>
          {row.status === 'pending' && <><button type="button" className={ui.buttonSecondary} disabled={busy === row.id} onClick={() => review(row.id, 'reject')}><X size={16} />Reject</button><button type="button" className={ui.buttonPrimary} disabled={busy === row.id} onClick={() => review(row.id, 'approve')}><Check size={16} />{row.channel === 'contact' ? 'Approve & send' : 'Mark reviewed'}</button></>}
        </div>
        {row.status === 'delivery_unknown' && <p role="alert">Delivery was not confirmed. Check the mailbox before sending again.</p>}
        {!!row.audit?.length && <details><summary>Review history</summary>{row.audit.map((entry, index) => <p key={index}>{entry.action} · {new Date(entry.at).toLocaleString()}</p>)}</details>}
      </article>)}
    </section>
    <details className={styles.section}><summary>Homepage experiment</summary><div className={styles.tableWrap}><table><thead><tr><th>Source / layout</th><th>Sessions</th><th>Content clicks</th><th>Click-through</th></tr></thead><tbody>{Object.entries(data?.home || {}).map(([key, row]) => <tr key={key}><td>{key.replace(':', ' / ')}</td><td>{row.views}</td><td>{row.clicks}</td><td>{percent(row.clicks, row.views)}</td></tr>)}</tbody></table></div><p>Source is a hint, not an identity. Learning begins after 30 sessions per layout; 10% exploration.</p></details>
    <details className={styles.section}><summary>Ranking & retention</summary><dl className={styles.details}><dt>Clicked reciprocal rank (proxy)</dt><dd>{metrics.searchClicks ? ((metrics.clickedReciprocalRank || 0) / metrics.searchClicks).toFixed(3) : 'No data'}</dd><dt>Last index update</dt><dd>{data?.build?.at ? new Date(data.build.at).toLocaleString() : 'Not built'}</dd><dt>Review retention</dt><dd>30 days</dd><dt>Query suggestions</dt><dd>Public vocabulary only; at least 5 sessions</dd></dl><p>Click-based rank is not relevance-labelled MRR. Risk scores are model heuristics, not probabilities.</p></details>
  </div>;
}
