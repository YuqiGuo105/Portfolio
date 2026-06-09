// pages/admin/index.js
// Admin dashboard — shows counts and quick links for each content type.

import { useState, useEffect } from 'react';
import AdminLayout from '../../src/components/admin/AdminLayout';
import { writerApi } from '../../src/lib/writerApi';
import Link from 'next/link';

const SECTIONS = [
  { key: 'blogs', label: 'Blogs', href: '/admin/blogs', api: 'blogs' },
  { key: 'lifeBlogs', label: 'Life Blogs', href: '/admin/life-blogs', api: 'lifeBlogs' },
  { key: 'projects', label: 'Projects', href: '/admin/projects', api: 'projects' },
];

export default function AdminDashboard() {
  const [counts, setCounts] = useState({});

  useEffect(() => {
    SECTIONS.forEach(({ key, api }) => {
      writerApi[api].list(0, 1)
        .then((data) => setCounts((prev) => ({ ...prev, [key]: data.totalElements ?? '—' })))
        .catch(() => setCounts((prev) => ({ ...prev, [key]: '—' })));
    });
  }, []);

  return (
    <AdminLayout>
      <h1 className="dash-title">Dashboard</h1>
      <div className="dash-grid">
        {SECTIONS.map((s) => (
          <Link key={s.key} href={s.href} className="dash-card">
            <div className="dash-count">{counts[s.key] ?? '…'}</div>
            <div className="dash-label">{s.label}</div>
            <div className="dash-action">Manage →</div>
          </Link>
        ))}
      </div>

      <style jsx>{`
        .dash-title {
          font-size: 1.6rem;
          font-weight: 700;
          color: #f1f5f9;
          margin: 0 0 32px;
        }
        .dash-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
        }
        .dash-grid :global(.dash-card) {
          background: #1e293b;
          border-radius: 16px;
          padding: 28px 24px;
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
        .dash-action {
          font-size: 0.8rem;
          color: #64748b;
          margin-top: 4px;
        }
      `}</style>
    </AdminLayout>
  );
}
