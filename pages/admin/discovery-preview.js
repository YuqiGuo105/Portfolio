import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Search, Play, RefreshCw, Inbox } from 'lucide-react';
import DiscoveryPanel from '../../src/components/admin/DiscoveryPanel';
import SearchOverlay from '../../src/components/SearchOverlay';
import RelatedContent from '../../src/components/discovery/RelatedContent';
import { SECTION_ORDER } from '../../src/lib/discovery/core.mjs';
import styles from '../../src/components/admin/DiscoveryPreview.module.css';

async function request(options) {
  const response = await fetch('/api/discovery/preview', { ...options, headers: { 'Content-Type': 'application/json' } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Preview unavailable');
  return body;
}
export default function DiscoveryPreview() {
  const [data, setData] = useState(null), [tab, setTab] = useState('visitor'), [variant, setVariant] = useState('career');
  const [open, setOpen] = useState(false), [channel, setChannel] = useState('contact'), [text, setText] = useState('I would like to discuss a backend engineering opportunity.');
  const [result, setResult] = useState(null), [busy, setBusy] = useState(false), [selected, setSelected] = useState(''), [error, setError] = useState('');
  useEffect(() => { request().then(value => { setData(value); setSelected(value.catalog[0]?.id || ''); }).catch(err => setError(err.message)); }, []);
  async function operation(name) {
    setBusy(true); setError('');
    try { setResult(await request({ method: 'POST', body: JSON.stringify({ operation: name, channel, text }) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const names = { 'home-intro': 'Yuqi Guo', 'about-section': 'About', 'resume-section': 'My Background', 'works-section': 'Projects', 'Blog-section': 'My Blogs' };
  return <main className={styles.root}>
    <Head><title>Discovery lab | Local preview</title><meta name="robots" content="noindex,nofollow" /></Head>
    <header className={styles.header}><div><span className={styles.eyebrow}>LOCAL / NOT DEPLOYED</span><h1>Discovery lab</h1></div><span className={styles.badge}>{!data ? 'Loading configuration' : data.aiEnabled ? 'Budget-guarded external AI' : 'External AI off'}</span></header>
    <nav className={styles.tabs} aria-label="Preview views">{['visitor', 'safety', 'review'].map(value => <button type="button" key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setResult(null); }}>{({ visitor: 'Visitor experience', safety: 'Submission check', review: 'Review & metrics' })[value]}</button>)}</nav>
    {error && <p role="alert">{error}</p>}
    {tab === 'visitor' && <>
      <section className={styles.band}><div className={styles.sectionHeader}><h2>Homepage order</h2><select aria-label="Referral layout" value={variant} onChange={event => setVariant(event.target.value)}><option value="original">Direct</option><option value="career">LinkedIn</option><option value="engineering">GitHub</option></select></div>
        <ol className={styles.order}>{SECTION_ORDER[variant].map(id => <li key={id}>{names[id]}</li>)}</ol>
        <a href={`/home/${variant}?subscriptionPreview=0`} target="_blank" rel="noreferrer">Open homepage layout</a>
      </section>
      <section className={styles.band}><div className={styles.sectionHeader}><h2>Search</h2><button type="button" onClick={() => setOpen(true)}><Search size={18} />Search portfolio</button></div></section>
      <section className={styles.band}><div className={styles.sectionHeader}><h2>Content recommendations</h2><select aria-label="Current article" value={selected} onChange={event => setSelected(event.target.value)}>{data?.catalog.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
        {selected && <RelatedContent contentId={selected} />}
        <div className={styles.actions}><button disabled={busy} type="button" onClick={() => operation('rebuild')}><RefreshCw size={16} />Rebuild index</button><button disabled={busy} type="button" onClick={() => operation('feedback')}><Play size={16} />Add test session</button></div>
        {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
      </section>
    </>}
    {tab === 'safety' && <section className={styles.band}><div className={styles.sectionHeader}><h2>Submission check</h2><select aria-label="Submission channel" value={channel} onChange={event => setChannel(event.target.value)}><option value="contact">Contact form</option><option value="globe">Globe note</option><option value="chat">Chat</option></select></div>
      <label htmlFor="test-message">Message</label><textarea id="test-message" rows={5} maxLength={5000} value={text} onChange={event => setText(event.target.value)} />
      <div className={styles.actions}><button type="button" disabled={busy || !text.trim()} onClick={() => operation('moderate')}><Play size={16} />{busy ? 'Checking...' : 'Check submission'}</button><button type="button" disabled={busy} onClick={() => operation('review-sample')}><Inbox size={16} />Queue synthetic example</button></div>
      {result && <div className={styles.verdict} role="status"><strong>{result.decision}</strong><span>{result.category}</span>{result.risk != null && <span>Risk {result.risk}/100</span>}<small>{result.model}</small></div>}
      <p className={styles.note}>Local review records only. No email delivery or public globe posting.</p>
    </section>}
    {tab === 'review' && <DiscoveryPanel request={request} />}
    <SearchOverlay isOpen={open} onClose={() => setOpen(false)} />
  </main>;
}
export async function getServerSideProps({ req }) {
  if (process.env.NODE_ENV !== 'development' || process.env.DISCOVERY_PREVIEW !== '1' || !/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '')) return { notFound: true };
  return { props: {} };
}
