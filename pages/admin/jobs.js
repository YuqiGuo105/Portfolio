// pages/admin/jobs.js
// Placeholder for the indexing-jobs / outbox / audit operations view.
// Until a dedicated UI exists, this page points operators at the
// admin-service Swagger UI for the same endpoints. The Supabase session is
// already valid there (Swagger UI accepts the same Bearer token).

import AdminLayout from '../../src/components/admin/AdminLayout';

const ADMIN_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_ADMIN_SERVICE_SWAGGER_URL ||
  'https://portfolio-admin-service-y45c2mnbja-uc.a.run.app/swagger-ui.html';

export default function JobsAuditPage() {
  return (
    <AdminLayout>
      <h1 className="title">Jobs &amp; Audit</h1>
      <p className="copy">
        Inspect indexing jobs, outbox events, and the admin audit log via
        the admin-service Swagger UI. Endpoints of interest:
      </p>
      <ul className="endpoints">
        <li><code>GET  /api/admin/indexing-jobs?status=FAILED&amp;jobType=RAG_INDEX</code></li>
        <li><code>POST /api/admin/indexing-jobs/{'{jobId}'}/retry</code></li>
        <li><code>GET  /api/admin/outbox-events</code></li>
      </ul>
      <p className="copy">
        Mr.&nbsp;Pot also exposes these as MCP tools: <code>job.list</code>,
        <code>job.retry</code>, <code>outbox.list</code>. Read tools render
        results inline; <code>job.retry</code> is gated by your Supabase
        session.
      </p>
      <a
        className="btn"
        href={ADMIN_SERVICE_SWAGGER}
        target="_blank"
        rel="noreferrer noopener"
      >
        Open Admin Swagger ↗
      </a>

      <style jsx>{`
        .title { font-size: 1.6rem; font-weight: 700; color: #f1f5f9; margin: 0 0 16px; }
        .copy  { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin: 0 0 12px; max-width: 720px; }
        .copy code, .endpoints code {
          background: #0f172a; padding: 2px 6px; border-radius: 6px; color: #38bdf8; font-size: 0.85em;
        }
        .endpoints { padding-left: 18px; color: #94a3b8; line-height: 1.8; max-width: 720px; }
        .btn   { display: inline-block; margin-top: 12px; padding: 10px 18px; background: #38bdf8; color: #0f172a;
                 border-radius: 10px; text-decoration: none; font-weight: 600; }
        .btn:hover { background: #0ea5e9; }
      `}</style>
    </AdminLayout>
  );
}
