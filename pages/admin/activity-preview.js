import { useCallback, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import VisitorActivity from '../../src/components/admin/VisitorActivity';
import DemoVideo from '../../src/components/media/DemoVideo';
import ProjectHoverVideo from '../../src/components/media/ProjectHoverVideo';
import { Moon, Sun } from 'lucide-react';
import { LOCAL_DEMOS } from '../../src/lib/media/demoCatalog.mjs';
import { activityFixtures } from '../../src/lib/visitorActivityPreview.mjs';

export default function ActivityPreview() {
  const records = useRef(null), [count, setCount] = useState(0), [dark, setDark] = useState(false);
  const demo = LOCAL_DEMOS.find(item => item.id === 'notifications');
  if (!records.current) records.current = activityFixtures();
  const api = useMemo(() => ({ visitors: { list: async () => ({ items: records.current.slice(0, 100), page: { totalElements: records.current.length } }) } }), []);
  const emit = useCallback((eventName, context) => {
    records.current.unshift({ eventId: crypto.randomUUID(), siteId: 'preview', sessionId: 'local-player',
      eventName, eventTime: new Date().toISOString(), serverTime: new Date().toISOString(),
      pageUrl: demo.href, pageContent: { type: 'project', title: demo.title, coverUrl: demo.poster },
      ipAddress: '192.0.2.1', properties: context.properties });
    records.current = records.current.slice(0, 100);
    setCount(n => n + 1); return true;
  }, [demo]);
  return <><Head><title>Activity &amp; media | Local preview</title><meta name="robots" content="noindex,nofollow" /></Head>
    <main data-theme={dark ? 'dark' : 'light'} style={{ maxWidth: 1100, padding: '24px 16px', margin: 'auto', background: dark ? '#141e1d' : '#f5f8f7', minHeight: '100vh', color: dark ? '#e6f2ef' : '#263f3b' }}>
      <button type="button" aria-label={dark ? 'Light mode' : 'Dark mode'} title={dark ? 'Light mode' : 'Dark mode'} onClick={() => setDark(!dark)} style={{ float: 'right', display: 'grid', placeItems: 'center', width: 40, minWidth: 40, height: 40, padding: 0, color: 'inherit', background: 'transparent', border: '1px solid #718d87', borderRadius: 4 }}>{dark ? <Sun size={20} /> : <Moon size={20} />}</button>
      <p style={{ fontSize: 13 }}>Local preview · Synthetic records · No production writes</p>
      <h1 style={{ font: '600 26px/1.4 system-ui', color: 'inherit', letterSpacing: 0 }}>Visitor activity</h1>
      <VisitorActivity api={api} initialExpanded synthetic />
      <details><summary>Player acceptance · {count} captured events</summary>
        <DemoVideo demo={demo} placement="article" onTelemetry={emit} />
        <div style={{ position: 'relative', width: '100%', maxWidth: 320, aspectRatio: '16 / 9', margin: '24px 0' }}><ProjectHoverVideo demo={demo} onTelemetry={emit}>
          <img src={demo.poster} width={320} height={180} alt="Subscription and notification preview" style={{ width: '100%', height: 'auto', display: 'block' }} />
        </ProjectHoverVideo></div>
        <output aria-live="polite">{count} captured events</output>
        <details><summary>Captured event names</summary><ol>{records.current.filter(event => event.sessionId === 'local-player').map(event => <li key={event.eventId}>{event.eventName} {event.properties?.playTrigger || event.properties?.action || ''}</li>)}</ol></details>
      </details>
    </main></>;
}

export function getServerSideProps() {
  return process.env.NODE_ENV === 'development' ? { props: {} } : { notFound: true };
}
