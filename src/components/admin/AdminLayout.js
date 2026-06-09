// src/components/admin/AdminLayout.js
// Admin-specific layout with sidebar navigation. Separate from the public Layout.

import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminTokenGate from './AdminTokenGate';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/blogs', label: 'Blogs' },
  { href: '/admin/life-blogs', label: 'Life Blogs' },
  { href: '/admin/projects', label: 'Projects' },
];

export default function AdminLayout({ children }) {
  const router = useRouter();

  function handleLogout() {
    sessionStorage.removeItem('admin_token');
    router.replace('/admin/login');
  }

  function isActive(item) {
    if (item.exact) return router.pathname === item.href;
    return router.pathname.startsWith(item.href);
  }

  return (
    <AdminTokenGate>
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand">Admin Panel</div>
          <nav className="admin-nav">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-link${isActive(item) ? ' active' : ''}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button className="admin-logout-btn" onClick={handleLogout}>
            Log out
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
          width: 220px;
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
        }
        .admin-brand {
          font-size: 1.1rem;
          font-weight: 700;
          color: #38bdf8;
          padding: 0 24px 32px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .admin-nav {
          display: flex;
          flex-direction: column;
          flex: 1;
          gap: 4px;
          padding: 0 12px;
        }
        .admin-nav :global(.admin-nav-link) {
          display: block;
          padding: 10px 16px;
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
        .admin-main {
          margin-left: 220px;
          flex: 1;
          padding: 40px;
          min-height: 100vh;
        }
        @media (max-width: 768px) {
          .admin-sidebar {
            width: 100%;
            min-height: auto;
            position: relative;
            flex-direction: row;
            flex-wrap: wrap;
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
