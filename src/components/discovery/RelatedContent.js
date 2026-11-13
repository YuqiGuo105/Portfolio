import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FileText } from 'lucide-react';
import { trackBehavior } from '../../lib/behaviorAnalytics';
import styles from './RelatedContent.module.css';

export default function RelatedContent({ contentId }) {
  const root = useRef(null), [payload, setPayload] = useState(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DISCOVERY_ENABLED !== '1') return undefined;
    setPayload(null);
    const controller = new AbortController();
    let loaded = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || loaded) return;
      loaded = true;
      fetch(`/api/discovery/recommend?id=${encodeURIComponent(contentId)}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : null).then(value => { if (!controller.signal.aborted) setPayload(value); }).catch(() => {});
    }, { rootMargin: '700px' });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); controller.abort(); };
  }, [contentId]);
  useEffect(() => {
    if (!payload?.items?.length || !root.current) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      trackBehavior('recommendation_impression', { properties: { component: 'read-next', recommendationRequestId: payload.requestId, modelVersion: payload.modelVersion } });
      observer.disconnect();
    }, { threshold: .2 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [payload]);
  if (process.env.NEXT_PUBLIC_DISCOVERY_ENABLED !== '1') return null;
  return <section ref={root} className={styles.section} aria-label="Read next">
    {payload?.items?.length > 0 && <div className="container">
      <h2 className={styles.heading}>Read next</h2>
      <div className={styles.grid}>{payload.items.map((item, index) => <a key={item.id} href={item.url} className={styles.item}
        onClick={() => trackBehavior('recommendation_click', { target: item.url, properties: { component: 'read-next', contentId: item.id, contentType: item.type, rank: index + 1, recommendationRequestId: payload.requestId, modelVersion: payload.modelVersion } })}>
        <span className={styles.cover}>{item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" /> : <FileText size={28} aria-hidden="true" />}</span>
        <div className={styles.copy}><span className={styles.meta}>{item.type === 'project' ? 'Project' : 'Article'} · {item.reason}</span><h3>{item.title}</h3><p>{item.description}</p></div>
        <ArrowUpRight size={18} className={styles.arrow} aria-hidden="true" />
      </a>)}</div>
    </div>}
  </section>;
}
