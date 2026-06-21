// pages/admin/index.js
// Admin dashboard — content stats + quick-action cards for subscriptions,
// notifications, Swagger entry points, and jobs/audit.

import { useState, useEffect } from 'react';
import AdminLayout from '../../src/components/admin/AdminLayout';
import { writerApi } from '../../src/lib/writerApi';
import { supabase } from '../../src/supabase/supabaseClient';
import Link from 'next/link';

const SECTIONS = [
  { key: 'blogs', label: 'Blogs', href: '/admin/blogs', api: 'blogs' },
  { key: 'lifeBlogs', label: 'Life Blogs', href: '/admin/life-blogs', api: 'lifeBlogs' },
  { key: 'projects', label: 'Projects', href: '/admin/projects', api: 'projects' },
];

const ADMIN_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_ADMIN_SERVICE_SWAGGER_URL ||
  'https://portfolio-admin-service-y45c2mnbja-uc.a.run.app/swagger-ui.html';

const NOTIFICATION_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_NOTIFICATION_SERVICE_SWAGGER_URL ||
  'https://portfolio-notification-service-y45c2mnbja-uc.a.run.app/swagger-ui.html';

const QUICK_ACTIONS = [
  {
    key: 'subscriptions',
    label: 'Subscriptions',
    description: 'View and manage notification subscribers.',
    href: '/admin/subscriptions',
    external: false,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Inspect the per-user notification feed.',
    href: '/admin/notifications',
    external: false,
  },
  {
    key: 'jobs',
    label: 'Jobs / Audit',
    description: 'Indexing jobs, outbox events, and admin audit log.',
    href: '/admin/jobs',
    external: false,
  },
  {
    key: 'admin-swagger',
    label: 'Admin Swagger',
    description: 'OpenAPI docs for admin-service (content, jobs, audit).',
    href: ADMIN_SERVICE_SWAGGER,
    external: true,
  },
  {
    key: 'notif-swagger',
    label: 'Notification Swagger',
    description: 'OpenAPI docs for the notification service.',
    href: NOTIFICATION_SERVICE_SWAGGER,
    external: true,
  },
];

export default function AdminDashboard() {
  const [counts, setCounts] = useState({});
  const [email, setEmail] = useState('');

  useEffect(() => {
    SECTIONS.forEach(({ key, api }) => {
      writerApi[api]
        .list(0, 1)
        .then((data) => setCounts((prev) => ({ ...prev, [key]: data.totalElements ?? '—' })))
        .catch(() => setCounts((prev) => ({ ...prev, [key]: '—' })));
    });
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data?.session?.user?.email || '');
    });
  }, []);

  return (
    <AdminLayout>
      <div className="dash-header">
        <h1 className="dash-title">Dashboard</h1>
        {email && <p className="dash-greeting">Signed in as <strong>{email}</strong></p>}
      </div>

      <h2 className="dash-section">Content</h2>
      <div className="dash-grid">
        {SECTIONS.map((s) => (
          <Link key={s.key} href={s.href}>
            <a className="dash-card">
              <div className="dash-count">{counts[s.key] ?? '…'}</div>
              <div className="dash-label">{s.label}</div>
              <div className="dash-action">Manage →</div>
            </a>
          </Link>
        ))}
      </div>

      <h2 className="dash-section">Quick actions</h2>
      <div className="dash-grid">
        {QUICK_ACTIONS.map((action) =>
          action.external ? (
            <a
              key={action.key}
              href={action.href}
              target="_blank"
              rel="noreferrer noopener"
              className="dash-card dash-card--action"
            >
              <div className="dash-label">{action.label}</div>
              <div className="dash-description">{action.description}</div>
              <div className="dash-action">Open ↗</div>
            </a>
          ) : (
            <Link key={action.key} href={action.href}>
              <a className="dash-card dash-card--action">
                <div className="dash-label">{action.label}</div>
                <div className="dash-description">{action.description}</div>
                <div className="dash-action">Open →</div>
              </a>
            </Link>
          )
        )}
      </div>

      <style jsx>{`
        .dash-header {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 0 0 28px;
        }
        .dash-title {
          font-size: 1.6rem;
          font-weight: 700;
          color: #f1f5f9;
          margin: 0;
        }
        .dash-greeting {
          color: #94a3b8;
          font-size: 0.9rem;
          margin: 0;
        }
        .dash-greeting strong {
          color: #38bdf8;
          font-weight: 600;
        }
        .dash-section {
          font-size: 1.0rem;
          font-weight: 600;
          color: #94a3b8;
          margin: 28px 0 16px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .dash-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 20px;
        }
        .dash-grid :global(.dash-card) {
          background: #1e293b;
          border-radius: 16px;
          padding: 24px;
          text-decoration: none;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border: 1px solid rgba(148, 163, 184, 0.1);
          transition: border-color 150ms, transform 150ms;
        }
        .dash-grid :global(.dash-card:hover) {
          border-color: rgba(56, 189, 248, 0.4);
          transform: translateY(-2px);
        }
        .dash-count {
          font-size: 2.4rem;
          font-weight: 700;
          color: #38bdf8;
        }
        .dash-label {
          font-size: 1rem;
          font-weight: 600;
          color: #e2e8f0;
        }
        .dash-description {
          font-size: 0.85rem;
          color: #94a3b8;
          line-height: 1.4;
          min-height: 36px;
        }
        .dash-action {
          font-size: 0.8rem;
          color: #64748b;
          margin-top: 4px;
        }
      `}</style>
    </AdminLayout>
  );
}
