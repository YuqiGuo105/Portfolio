import Head from 'next/head';
import { JobsAuditWorkspace } from './jobs';
import styles from '../../src/components/admin/VisitorWorkbench.module.css';
import layout from '../../src/components/admin/AdminLayout.module.css';

export default function JobsPreview() {
  return <><Head><title>Jobs &amp; audit | Local preview</title><meta name="robots" content="noindex,nofollow" /></Head>
    <div className={styles.preview}><strong>Local preview</strong> · No jobs are executed.</div>
    <main className={layout.shell} style={{ maxWidth: 1440, margin: 'auto', padding: '24px', background: '#fff', minHeight: '100vh' }}><JobsAuditWorkspace /></main>
  </>;
}

export function getServerSideProps() {
  return process.env.NODE_ENV === 'development' ? { props: {} } : { notFound: true };
}
