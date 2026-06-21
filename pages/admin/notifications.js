// pages/admin/notifications.js
// Placeholder admin view for the notification feed. Lists the signed-in
// admin's own notifications via the existing /api/notifications proxy.

import { useEffect, useState } from 'react';
import AdminLayout from '../../src/components/admin/AdminLayout';
import { supabase } from '../../src/supabase/supabaseClient';

const NOTIFICATION_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_NOTIFICATION_SERVICE_SWAGGER_URL ||
  'https://portfolio-notification-service-y45c2mnbja-uc.a.run.app/swagger-ui.html';

export default function NotificationsPage() {
  const [email, setEmail] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const userEmail = data?.session?.user?.email;
      if (!active) return;
      if (!userEmail) {
        setError('No Supabase session.');
        return;
      }
      setEmail(userEmail);
      try {
        const res = await fetch(
          `/api/notifications?email=${encodeURIComponent(userEmail)}&limit=50`,
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.message || `Failed: ${res.status}`);
          return;
        }
        setItems(Array.isArray(json) ? json : json.items || []);
      } catch (err) {
        setError(err.message || 'Network error');
      }
    });
    return () => { active = false; };
  }, []);

  return (
    <AdminLayout>
      <h1 className="title">Notifications</h1>
      <p className="copy">
        Showing your own notification feed (filtered by Supabase email).
        For per-user lookups across the whole site, use the notification
        service Swagger UI.
      </p>
      {email && <p className="copy"><strong>{email}</strong></p>}

      {error && <p className="err">{error}</p>}

      {items === null && !error && <p className="copy">Loading…</p>}
      {items?.length === 0 && <p className="copy">No notifications yet.</p>}
      {items?.length > 0 && (
        <ul className="list">
          {items.map((n) => (
            <li key={n.id || `${n.title}-${n.createdAt}`} className="item">
              <div className="item-title">{n.title || n.eventType || 'Notification'}</div>
              {n.summary && <div className="item-summary">{n.summary}</div>}
              {n.createdAt && <div className="item-meta">{n.createdAt}</div>}
            </li>
          ))}
        </ul>
      )}

      <a
        className="btn"
        href={NOTIFICATION_SERVICE_SWAGGER}
        target="_blank"
        rel="noreferrer noopener"
      >
        Open Notification Swagger ↗
      </a>

      <style jsx>{`
        .title { font-size: 1.6rem; font-weight: 700; color: #f1f5f9; margin: 0 0 16px; }
        .copy  { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin: 0 0 12px; max-width: 720px; }
        .copy strong { color: #38bdf8; }
        .err   { color: #f87171; margin: 12px 0; }
        .list  { list-style: none; padding: 0; margin: 16px 0; display: flex; flex-direction: column; gap: 10px; }
        .item  { background: #1e293b; border: 1px solid rgba(148,163,184,0.1); border-radius: 12px; padding: 14px 16px; }
        .item-title   { font-weight: 600; color: #e2e8f0; }
        .item-summary { color: #94a3b8; font-size: 0.9rem; margin-top: 4px; }
        .item-meta    { color: #64748b; font-size: 0.75rem; margin-top: 6px; }
        .btn   { display: inline-block; margin-top: 20px; padding: 10px 18px; background: #38bdf8; color: #0f172a;
                 border-radius: 10px; text-decoration: none; font-weight: 600; }
        .btn:hover { background: #0ea5e9; }
      `}</style>
    </AdminLayout>
  );
}
