// src/components/admin/AdminLayout.js
// Admin-specific layout with sidebar navigation. Separate from the public Layout.
//
// Auth: gated by AdminTokenGate which checks the Supabase session. Logout
// signs out of Supabase entirely (the same identity drives the rest of
// yuqi.site, so this also logs the user out of the public chat widget).

import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminTokenGate from './AdminTokenGate';
import { supabase } from '../../supabase/supabaseClient';

const ADMIN_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_ADMIN_SERVICE_SWAGGER_URL ||
  'https://portfolio-admin-service-y45c2mnbja-uc.a.run.app/swagger-ui.html';

const NOTIFICATION_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_NOTIFICATION_SERVICE_SWAGGER_URL ||
  'https://portfolio-notification-service-y45c2mnbja-uc.a.run.app/swagger-ui.html';

// Grouped navigation. `external: true` opens in a new tab via <a>.
const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard', exact: true },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/blogs', label: 'Blogs' },
      { href: '/admin/life-blogs', label: 'Life Blogs' },
      { href: '/admin/projects', label: 'Projects' },
    ],
  },
  {
    label: 'Notifications',
    items: [
      { href: '/admin/subscriptions', label: 'Subscriptions' },
      { href: '/admin/notifications', label: 'Notifications' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/jobs', label: 'Jobs / Audit' },
      { href: ADMIN_SERVICE_SWAGGER, label: 'Admin Swagger ↗', external: true },
      { href: NOTIFICATION_SERVICE_SWAGGER, label: 'Notification Swagger ↗', external: true },
    ],
  },
];

export default function AdminLayout({ children }) {
  const router = useRouter();

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore — we redirect regardless */
    }
    router.replace('/admin/login');
  }

  function isActive(item) {
    if (item.external) return false;
    if (item.exact) return router.pathname === item.href;
    return router.pathname.startsWith(item.href);
  }

  function renderItem(item) {
    if (item.external) {
      return (
        <a
          key={item.href}
          href={item.href}
          target="_blank"
          rel="noreferrer noopener"
          className="admin-nav-link"
        >
          {item.label}
        </a>
      );
    }
    return (
      <Link key={item.href} href={item.href}>
        <a className={`admin-nav-link${isActive(item) ? ' active' : ''}`}>
          {item.label}
        </a>
      </Link>
    );
  }

  return (
    <AdminTokenGate>
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand">Admin Panel</div>
          <nav className="admin-nav">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="admin-nav-group">
                <div className="admin-nav-group-title">{group.label}</div>
                {group.items.map(renderItem)}
              </div>
            ))}
          </nav>
          <a
            href="https://www.yuqi.site"
            target="_blank"
            rel="noreferrer noopener"
            className="admin-back-link"
          >
            ← Back to yuqi.site
          </a>
          <button className="admin-logout-btn" onClick={handleLogout}>
            Sign out
          </button>
        </aside>
        <main className="admin-main">{children}</main>
      </div>

      <style jsx>{`
        .admin-shell {
          display: flex;
          min-height: 100vh;
          background: #0f172a;
          color: #e2e8f0;
          font-family: 'Inter', sans-serif;
        }
        .admin-sidebar {
          width: 240px;
          min-height: 100vh;
          background: #1e293b;
          display: flex;
          flex-direction: column;
          padding: 32px 0;
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          z-index: 100;
          overflow-y: auto;
        }
        .admin-brand {
          font-size: 1.1rem;
          font-weight: 700;
          color: #38bdf8;
          padding: 0 24px 24px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .admin-nav {
          display: flex;
          flex-direction: column;
          flex: 1;
          gap: 16px;
          padding: 0 12px;
        }
        .admin-nav-group {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .admin-nav-group-title {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #64748b;
          padding: 0 16px 6px;
        }
        .admin-nav :global(.admin-nav-link) {
          display: block;
          padding: 9px 16px;
          border-radius: 8px;
          color: #94a3b8;
          text-decoration: none;
          font-size: 0.9rem;
          transition: background 150ms, color 150ms;
        }
        .admin-nav :global(.admin-nav-link:hover) {
          background: rgba(56, 189, 248, 0.1);
          color: #e2e8f0;
        }
        .admin-nav :global(.admin-nav-link.active) {
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
          font-weight: 600;
        }
        .admin-logout-btn {
          margin: 24px 12px 0;
          padding: 10px 16px;
          background: transparent;
          border: 1px solid rgba(148, 163, 184, 0.3);
          border-radius: 8px;
          color: #94a3b8;
          font-size: 0.85rem;
          cursor: pointer;
          transition: border-color 150ms, color 150ms;
        }
        .admin-logout-btn:hover {
          border-color: #f87171;
          color: #f87171;
        }
        .admin-back-link {
          margin: 16px 12px 0;
          padding: 10px 16px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.25);
          border-radius: 8px;
          color: #38bdf8;
          font-size: 0.85rem;
          text-align: center;
          text-decoration: none;
          transition: background 150ms;
        }
        .admin-back-link:hover {
          background: rgba(56, 189, 248, 0.2);
          color: #38bdf8;
        }
        .admin-main {
          margin-left: 240px;
          flex: 1;
          padding: 40px;
          min-height: 100vh;
        }
        @media (max-width: 768px) {
          .admin-sidebar {
            width: 100%;
            min-height: auto;
            position: relative;
            flex-direction: column;
            padding: 16px;
          }
          .admin-main {
            margin-left: 0;
            padding: 20px;
          }
        }
      `}</style>
    </AdminTokenGate>
  );
}
