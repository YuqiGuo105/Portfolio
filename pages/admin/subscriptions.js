// pages/admin/subscriptions.js
// Placeholder admin view for subscriptions. Until a dedicated listing UI
// exists, this page links straight to the notification-service Swagger so
// the operator can run subscription queries with their Supabase JWT.

import AdminLayout from '../../src/components/admin/AdminLayout';

const NOTIFICATION_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_NOTIFICATION_SERVICE_SWAGGER_URL ||
  'https://portfolio-notification-service-y45c2mnbja-uc.a.run.app/swagger-ui.html';

export default function SubscriptionsPage() {
  return (
    <AdminLayout>
      <h1 className="title">Subscriptions</h1>
      <p className="copy">
        Subscription management is currently surfaced via the notification
        service Swagger UI. Sign in with the same Supabase account you used to
        reach this admin panel, then call the <code>/api/subscriptions/**</code>
        endpoints.
      </p>
      <p className="copy">
        The Mr.&nbsp;Pot chat widget also exposes these as MCP tools
        (<code>subscription.create</code>, <code>subscription.update</code>,
        <code>subscription.unsubscribe</code>) — write operations require the
        same Supabase session.
      </p>
      <a
        className="btn"
        href={NOTIFICATION_SERVICE_SWAGGER}
        target="_blank"
        rel="noreferrer noopener"
      >
        Open Notification Swagger ↗
      </a>

      <style jsx>{`
        .title { font-size: 1.6rem; font-weight: 700; color: #f1f5f9; margin: 0 0 24px; }
        .copy  { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin: 0 0 16px; max-width: 720px; }
        .copy code { background: #0f172a; padding: 2px 6px; border-radius: 6px; color: #38bdf8; font-size: 0.85em; }
        .btn   { display: inline-block; margin-top: 12px; padding: 10px 18px; background: #38bdf8; color: #0f172a;
                 border-radius: 10px; text-decoration: none; font-weight: 600; }
        .btn:hover { background: #0ea5e9; }
      `}</style>
    </AdminLayout>
  );
}
