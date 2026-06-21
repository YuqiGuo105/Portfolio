// src/components/admin/ContentList.js
// Shared list table for blogs, life-blogs, and projects.
//
// Two backends are supported:
//   1. Pass `type` ('BLOG' | 'LIFE_BLOG' | 'PROJECT' | 'EXPERIENCE') to load
//      via the unified admin-service endpoint /api/admin/content?type=... .
//      Returns ContentListItemDto so item identity is `sourceId`. Pagination
//      is disabled (single bulk fetch up to 500) and row actions are hidden
//      because admin-service does not yet expose DELETE on this surface.
//   2. Pass `api` (writerApi.blogs | .lifeBlogs | .projects) for the legacy
//      Spring-Page resources. These endpoints currently 404 on admin-service
//      — kept only so the prop type doesn't break callers that still set it.

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { writerApi } from '../../lib/writerApi';

export default function ContentList({
  title,
  newHref,
  editHref,   // function(id) => string
  api,        // legacy: writerApi.blogs | writerApi.lifeBlogs | writerApi.projects
  type,       // preferred: 'BLOG' | 'LIFE_BLOG' | 'PROJECT' | 'EXPERIENCE'
  columns,    // [{ key, label, render? }]
}) {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const useContentApi = Boolean(type);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (useContentApi) {
        const data = await writerApi.content.list(type, { limit: 500 });
        const raw = Array.isArray(data?.items) ? data.items : [];
        // ContentListItemDto uses `sourceId`; expose as `id` so the existing
        // editHref(item.id) and row key continue to work.
        setItems(raw.map((it) => ({ ...it, id: it.sourceId })));
        setTotalPages(1);
      } else {
        const data = await api.list(page);
        // Spring Page response: { content, totalPages, totalElements, number }
        setItems(data.content || data.results || []);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      toast.error(`Failed to load: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [api, page, type, useContentApi]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    setDeletingId(item.id);
    try {
      await api.delete(item.id, item.version);
      toast.success('Deleted successfully');
      load();
    } catch (err) {
      if (err.status === 409) {
        toast.error('Version conflict — reload and try again.');
      } else {
        toast.error(`Delete failed: ${err.message}`);
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="content-list">
      <div className="list-header">
        <h1 className="list-title">{title}</h1>
        <button className="btn-primary" onClick={() => router.push(newHref)}>
          + New
        </button>
      </div>

      {loading ? (
        <div className="list-loading">Loading…</div>
      ) : items.length === 0 ? (
        <div className="list-empty">No items yet. Create your first one.</div>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
                {!useContentApi && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      {col.render ? col.render(item[col.key], item) : (item[col.key] ?? '—')}
                    </td>
                  ))}
                  {!useContentApi && (
                    <td className="actions-cell">
                      <button
                        className="btn-edit"
                        onClick={() => router.push(editHref(item.id))}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(item)}
                        disabled={deletingId === item.id}
                      >
                        {deletingId === item.id ? '…' : 'Delete'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="page-btn"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span className="page-info">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="page-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}

      <style jsx>{`
        .content-list { width: 100%; }
        .list-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 28px;
        }
        .list-title {
          font-size: 1.6rem;
          font-weight: 700;
          color: #f1f5f9;
          margin: 0;
        }
        .btn-primary {
          padding: 10px 20px;
          background: #38bdf8;
          color: #0f172a;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: background 150ms;
        }
        .btn-primary:hover { background: #0ea5e9; }
        .list-loading,
        .list-empty {
          padding: 60px;
          text-align: center;
          color: #64748b;
          font-size: 0.95rem;
        }
        .table-wrap { overflow-x: auto; }
        .admin-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }
        .admin-table th {
          text-align: left;
          padding: 12px 16px;
          background: #1e293b;
          color: #94a3b8;
          font-weight: 600;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        .admin-table td {
          padding: 14px 16px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.08);
          color: #cbd5e1;
          vertical-align: middle;
        }
        .admin-table tr:hover td { background: rgba(56, 189, 248, 0.04); }
        .actions-cell {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .btn-edit {
          padding: 6px 14px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.3);
          border-radius: 6px;
          color: #38bdf8;
          font-size: 0.8rem;
          cursor: pointer;
          transition: background 150ms;
        }
        .btn-edit:hover { background: rgba(56, 189, 248, 0.2); }
        .btn-delete {
          padding: 6px 14px;
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.3);
          border-radius: 6px;
          color: #f87171;
          font-size: 0.8rem;
          cursor: pointer;
          transition: background 150ms;
        }
        .btn-delete:hover { background: rgba(248, 113, 113, 0.2); }
        .btn-delete:disabled { opacity: 0.5; cursor: not-allowed; }
        .pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-top: 28px;
        }
        .page-btn {
          padding: 8px 16px;
          background: #1e293b;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 6px;
          color: #94a3b8;
          font-size: 0.85rem;
          cursor: pointer;
          transition: border-color 150ms, color 150ms;
        }
        .page-btn:hover:not(:disabled) {
          border-color: #38bdf8;
          color: #38bdf8;
        }
        .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .page-info { color: #64748b; font-size: 0.85rem; }
      `}</style>
    </div>
  );
}
