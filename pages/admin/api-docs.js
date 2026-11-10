import Head from 'next/head';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import AdminLayout from '../../src/components/admin/AdminLayout';
import { useAdminSession } from '../../src/components/admin/AdminSessionContext';
import { PageHeader, adminStyles as ui } from '../../src/components/admin/AdminUI';
import { supabase } from '../../src/supabase/supabaseClient';

const SwaggerViewer = dynamic(() => import('../../src/components/admin/AdminSwaggerViewer'), { ssr: false });

export default function AdminApiDocsPage() {
  return <AdminLayout><Head><title>Admin API | Yuqi Admin</title><meta name="robots" content="noindex,nofollow" /></Head><ApiDocsWorkspace /></AdminLayout>;
}

function ApiDocsWorkspace() {
  const profile = useAdminSession();
  const [document, setDocument] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const isAdmin = profile?.role === 'ADMIN';
  useEffect(() => {
    if (!isAdmin) return undefined;
    const controller = new AbortController();
    setDocument(null);
    setError('');
    async function load() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data?.session?.access_token) throw new Error('Please sign in again to view API documentation.');
        const response = await fetch('/api/admin/api-docs', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error([401, 403].includes(response.status)
          ? 'An active administrator session is required.' : 'API documentation is temporarily unavailable.');
        const result = await response.json();
        if (!controller.signal.aborted) setDocument(result);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      }
    }
    void load();
    return () => controller.abort();
  }, [isAdmin, attempt]);

  return <div className={ui.page}>
    <PageHeader title="Admin API" subtitle="Private documentation" />
    {!isAdmin ? <p role="alert">Administrator access required.</p> : error ? <div className={ui.errorBanner} role="alert">
      <span>{error}</span><button className={ui.buttonSecondary} onClick={() => setAttempt(value => value + 1)}><RotateCw size={15} /> Retry</button>
    </div> : document ? <SwaggerViewer document={document} /> : <p role="status">Loading API documentation...</p>}
  </div>;
}

export function getServerSideProps({ res }) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return { props: {} };
}
