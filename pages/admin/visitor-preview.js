import { useMemo } from 'react';
import Head from 'next/head';
import { VisitorsWorkspace } from './visitors';
import { createVisitorPreviewApi } from '../../src/lib/visitorPreview.mjs';
import styles from '../../src/components/admin/VisitorWorkbench.module.css';
import layout from '../../src/components/admin/AdminLayout.module.css';

export default function VisitorPreview() {
  const api = useMemo(() => createVisitorPreviewApi(), []);
  return <><Head><title>Visitor workbench | Local preview</title><meta name="robots" content="noindex,nofollow" /></Head>
    <div className={styles.preview}><strong>Local preview · Sample data</strong> · No live visitor records. Alert changes stay in memory; no emails are sent.</div>
    <main className={layout.shell} style={{ maxWidth: 1440, margin: 'auto', padding: '16px', background: '#f7faf8', minHeight: '100vh' }}><VisitorsWorkspace api={api} storageScope="local-preview" /></main>
  </>;
}

export function getServerSideProps() {
  return process.env.NODE_ENV === 'development' ? { props: {} } : { notFound: true };
}
