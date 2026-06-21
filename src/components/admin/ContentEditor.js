// src/components/admin/ContentEditor.js
// Shared editor form for blogs, life-blogs, and projects.
// Props:
//   contentType: 'blog' | 'life-blog' | 'project'
//   initialData: object | null  (null = create mode)
//   onSave: async (data, status) => void
//   onBack: () => void

import { useMemo, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import DOMPurify from 'dompurify';
import { toast } from 'react-toastify';
import SlugField from './SlugField';

const RichTextEditor = dynamic(() => import('./RichTextEditor'), { ssr: false });

const STATUS_OPTIONS = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const VISIBILITY_OPTIONS = ['PUBLIC', 'PRIVATE', 'LOGIN_REQUIRED'];

// Fields shown per content type
const TYPE_FIELDS = {
  blog: ['title', 'slug', 'description', 'content', 'tags', 'category', 'imageUrl', 'url', 'date', 'status', 'visibility', 'publishedAt'],
  'life-blog': ['title', 'slug', 'description', 'content', 'tags', 'category', 'imageUrl', 'url', 'requireLogin', 'status', 'visibility', 'publishedAt'],
  project: ['title', 'slug', 'description', 'content', 'tags', 'category', 'imageUrl', 'url', 'technology', 'year', 'num', 'status', 'visibility', 'publishedAt'],
};

function hasField(contentType, field) {
  return TYPE_FIELDS[contentType]?.includes(field) ?? false;
}

function emptyForm() {
  return {
    title: '',
    slug: '',
    description: '',
    content: '',
    tags: '',
    category: '',
    imageUrl: '',
    url: '',
    date: '',
    requireLogin: false,
    technology: '',
    year: '',
    num: '',
    status: 'DRAFT',
    visibility: 'PUBLIC',
    publishedAt: '',
  };
}

function dataToForm(data) {
  return {
    title: data.title || '',
    slug: data.slug || '',
    description: data.description || '',
    content: data.content || '',
    tags: data.tags || '',
    category: data.category || '',
    imageUrl: data.imageUrl || '',
    url: data.url || '',
    date: data.date || '',
    requireLogin: data.requireLogin || false,
    technology: data.technology || '',
    year: data.year || '',
    num: data.num != null ? String(data.num) : '',
    status: data.status || 'DRAFT',
    visibility: data.visibility || 'PUBLIC',
    publishedAt: data.publishedAt ? data.publishedAt.slice(0, 10) : '',
  };
}

export default function ContentEditor({ contentType, initialData, onSave, onBack }) {
  const isEdit = !!initialData;
  const [form, setForm] = useState(
    isEdit ? dataToForm(initialData) : emptyForm()
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const idempotencyKey = useRef(
    isEdit ? null : (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Date.now()))
  );

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  // Sanitize the same way the public blog-single / life-blog pages do so the
  // preview reflects exactly what visitors will see. Guard for SSR — DOMPurify
  // needs `window`, and ContentEditor is bundled into the static page shell.
  const previewHtml = useMemo(() => {
    const raw = form.content || '';
    if (!raw.trim()) return '';
    if (typeof window === 'undefined') return raw;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
  }, [form.content]);

  function validate() {
    const errs = {};
    if (!form.title.trim()) errs.title = 'Title is required';
    if (!form.slug.trim()) errs.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(form.slug)) errs.slug = 'Slug must be lowercase alphanumeric with hyphens';
    return errs;
  }

  async function handleSave(targetStatus) {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast.error('Please fix validation errors');
      return;
    }

    setSaving(true);
    setVersionConflict(false);

    const payload = {
      ...form,
      status: targetStatus,
      num: form.num !== '' ? Number(form.num) : undefined,
      publishedAt: form.publishedAt || undefined,
    };

    if (isEdit) {
      payload._expectedVersion = initialData.version;
    }

    try {
      await onSave(payload, targetStatus, idempotencyKey.current);
      // Rotate idempotency key after successful create
      if (!isEdit) {
        idempotencyKey.current = typeof crypto !== 'undefined'
          ? crypto.randomUUID() : String(Date.now());
      }
      toast.success(targetStatus === 'PUBLISHED' ? 'Published!' : 'Saved as draft');
    } catch (err) {
      if (err.status === 409) {
        setVersionConflict(true);
        toast.error('Version conflict — this content was updated elsewhere. Reload to get the latest.');
      } else if (err.status === 400 && err.body?.fieldErrors) {
        setErrors(err.body.fieldErrors);
        toast.error('Validation errors from server');
      } else {
        toast.error(`Save failed: ${err.message}`);
      }
    } finally {
      setSaving(false);
    }
  }

  const show = (field) => hasField(contentType, field);

  return (
    <div className="content-editor">
      {/* Header */}
      <div className="editor-header">
        <button className="back-btn" onClick={onBack} type="button">
          ← Back
        </button>
        <div className="editor-actions">
          {isEdit && (
            <span className="version-badge">v{initialData.version}</span>
          )}
          <button
            className="btn-draft"
            onClick={() => handleSave('DRAFT')}
            disabled={saving}
            type="button"
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            className="btn-publish"
            onClick={() => handleSave('PUBLISHED')}
            disabled={saving}
            type="button"
          >
            {saving ? 'Saving…' : 'Publish'}
          </button>
        </div>
      </div>

      {/* Version conflict banner */}
      {versionConflict && (
        <div className="conflict-banner">
          ⚠️ This content was updated elsewhere. Reload the page to get the latest version before saving.
        </div>
      )}

      <div className="editor-body">
        {/* Title */}
        <div className="field-group">
          <label className="field-label">Title *</label>
          <input
            type="text"
            className={`admin-input${errors.title ? ' input-error' : ''}`}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Enter title"
          />
          {errors.title && <span className="field-error">{errors.title}</span>}
        </div>

        {/* Slug */}
        <div className="field-group">
          <label className="field-label">Slug *</label>
          <SlugField
            title={form.title}
            value={form.slug}
            onChange={(v) => set('slug', v)}
            error={errors.slug}
          />
        </div>

        {/* Description */}
        <div className="field-group">
          <label className="field-label">Description</label>
          <textarea
            className="admin-textarea"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Short description"
            rows={3}
          />
        </div>

        {/* Content */}
        <div className="field-group">
          <div className="content-label-row">
            <label className="field-label">Content</label>
            <div className="preview-toggle">
              <button
                type="button"
                className={`toggle-btn${!preview ? ' active' : ''}`}
                onClick={() => setPreview(false)}
              >
                Write
              </button>
              <button
                type="button"
                className={`toggle-btn${preview ? ' active' : ''}`}
                onClick={() => setPreview(true)}
              >
                Preview
              </button>
            </div>
          </div>
          {preview ? (
            previewHtml ? (
              <div
                className="html-preview"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <div className="html-preview html-preview--empty">
                Nothing to preview
              </div>
            )
          ) : (
            <RichTextEditor
              value={form.content}
              onChange={(v) => set('content', v)}
              placeholder="Write your content here…"
            />
          )}
        </div>

        {/* Row: Status, Visibility, Category */}
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Status</label>
            <select
              className="admin-select"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Visibility</label>
            <select
              className="admin-select"
              value={form.visibility}
              onChange={(e) => set('visibility', e.target.value)}
            >
              {VISIBILITY_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Category</label>
            <input
              type="text"
              className="admin-input"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="e.g. Tech, Life"
            />
          </div>
        </div>

        {/* Tags */}
        <div className="field-group">
          <label className="field-label">Tags <span className="field-hint">(comma-separated)</span></label>
          <input
            type="text"
            className="admin-input"
            value={form.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="rust, spring-boot, microservices"
          />
        </div>

        {/* Image URL */}
        <div className="field-group">
          <label className="field-label">Image URL</label>
          <input
            type="text"
            className="admin-input"
            value={form.imageUrl}
            onChange={(e) => set('imageUrl', e.target.value)}
            placeholder="https://..."
          />
        </div>

        {/* URL */}
        <div className="field-group">
          <label className="field-label">URL</label>
          <input
            type="text"
            className="admin-input"
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="/blog/my-post"
          />
        </div>

        {/* Published At */}
        <div className="field-group">
          <label className="field-label">Published At</label>
          <input
            type="date"
            className="admin-input"
            value={form.publishedAt}
            onChange={(e) => set('publishedAt', e.target.value)}
          />
        </div>

        {/* Blog-only: date */}
        {show('date') && (
          <div className="field-group">
            <label className="field-label">Date <span className="field-hint">(display date)</span></label>
            <input
              type="text"
              className="admin-input"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
              placeholder="e.g. January 2025"
            />
          </div>
        )}

        {/* Life-blog-only: requireLogin */}
        {show('requireLogin') && (
          <div className="field-group field-group--inline">
            <label className="field-label">Require Login</label>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={form.requireLogin}
                onChange={(e) => set('requireLogin', e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        )}

        {/* Project-only: technology, year, num */}
        {show('technology') && (
          <div className="field-row">
            <div className="field-group">
              <label className="field-label">Technology</label>
              <input
                type="text"
                className="admin-input"
                value={form.technology}
                onChange={(e) => set('technology', e.target.value)}
                placeholder="React, Spring Boot, PostgreSQL"
              />
            </div>
            <div className="field-group">
              <label className="field-label">Year</label>
              <input
                type="text"
                className="admin-input"
                value={form.year}
                onChange={(e) => set('year', e.target.value)}
                placeholder="2025"
              />
            </div>
            <div className="field-group">
              <label className="field-label">Num</label>
              <input
                type="number"
                className="admin-input"
                value={form.num}
                onChange={(e) => set('num', e.target.value)}
                placeholder="1"
              />
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .content-editor { width: 100%; max-width: 900px; }
        .editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 32px;
          padding-bottom: 20px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        .back-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 0.9rem;
          cursor: pointer;
          padding: 8px 0;
          transition: color 150ms;
        }
        .back-btn:hover { color: #e2e8f0; }
        .editor-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .version-badge {
          font-size: 0.75rem;
          color: #64748b;
          background: #1e293b;
          padding: 4px 10px;
          border-radius: 20px;
        }
        .btn-draft {
          padding: 10px 20px;
          background: transparent;
          border: 1px solid rgba(148, 163, 184, 0.4);
          border-radius: 8px;
          color: #94a3b8;
          font-size: 0.9rem;
          cursor: pointer;
          transition: border-color 150ms, color 150ms;
        }
        .btn-draft:hover:not(:disabled) {
          border-color: #e2e8f0;
          color: #e2e8f0;
        }
        .btn-publish {
          padding: 10px 20px;
          background: #38bdf8;
          border: none;
          border-radius: 8px;
          color: #0f172a;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: background 150ms;
        }
        .btn-publish:hover:not(:disabled) { background: #0ea5e9; }
        .btn-draft:disabled,
        .btn-publish:disabled { opacity: 0.5; cursor: not-allowed; }
        .conflict-banner {
          background: rgba(251, 191, 36, 0.1);
          border: 1px solid rgba(251, 191, 36, 0.4);
          border-radius: 8px;
          padding: 14px 18px;
          color: #fbbf24;
          font-size: 0.9rem;
          margin-bottom: 24px;
        }
        .editor-body {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .field-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .field-group--inline {
          flex-direction: row;
          align-items: center;
          gap: 16px;
        }
        .field-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
        }
        .field-label {
          font-size: 0.85rem;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .field-hint {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: #64748b;
        }
        .field-error {
          font-size: 0.8rem;
          color: #f87171;
        }
        :global(.admin-input) {
          width: 100%;
          padding: 10px 14px;
          background: #1e293b;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 0.9rem;
          outline: none;
          transition: border-color 150ms;
          box-sizing: border-box;
        }
        :global(.admin-input:focus) {
          border-color: #38bdf8;
        }
        :global(.admin-input.input-error) {
          border-color: #f87171;
        }
        :global(.admin-textarea) {
          width: 100%;
          padding: 10px 14px;
          background: #1e293b;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 0.9rem;
          outline: none;
          resize: vertical;
          transition: border-color 150ms;
          box-sizing: border-box;
        }
        :global(.admin-textarea:focus) { border-color: #38bdf8; }
        :global(.admin-select) {
          width: 100%;
          padding: 10px 14px;
          background: #1e293b;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 0.9rem;
          outline: none;
          cursor: pointer;
          transition: border-color 150ms;
          box-sizing: border-box;
        }
        :global(.admin-select:focus) { border-color: #38bdf8; }
        .content-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .preview-toggle {
          display: flex;
          gap: 4px;
          background: #1e293b;
          border-radius: 6px;
          padding: 3px;
        }
        .toggle-btn {
          padding: 5px 14px;
          background: transparent;
          border: none;
          border-radius: 4px;
          color: #64748b;
          font-size: 0.8rem;
          cursor: pointer;
          transition: background 150ms, color 150ms;
        }
        .toggle-btn.active {
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
        }
        .html-preview {
          background: #1e293b;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 8px;
          padding: 20px 24px;
          min-height: 320px;
          color: #e2e8f0;
          font-size: 0.95rem;
          line-height: 1.7;
          overflow-wrap: break-word;
        }
        .html-preview--empty {
          color: #64748b;
          font-style: italic;
        }
        .html-preview :global(h1),
        .html-preview :global(h2),
        .html-preview :global(h3) {
          color: #f1f5f9;
          margin-top: 1.5em;
          line-height: 1.3;
        }
        .html-preview :global(p) { margin: 0.75em 0; }
        .html-preview :global(a) {
          color: #38bdf8;
          text-decoration: underline;
        }
        .html-preview :global(ul),
        .html-preview :global(ol) {
          padding-left: 1.4em;
          margin: 0.75em 0;
        }
        .html-preview :global(blockquote) {
          border-left: 3px solid #38bdf8;
          padding-left: 12px;
          color: #cbd5e1;
          margin: 0.75em 0;
        }
        .html-preview :global(code) {
          background: rgba(56, 189, 248, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.85em;
          color: #38bdf8;
        }
        .html-preview :global(pre) {
          background: #020617;
          padding: 14px 16px;
          border-radius: 8px;
          overflow-x: auto;
        }
        .html-preview :global(img) {
          max-width: 100%;
          height: auto;
          border-radius: 6px;
        }
        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .toggle-switch input { opacity: 0; width: 0; height: 0; }
        .toggle-slider {
          position: absolute;
          cursor: pointer;
          inset: 0;
          background: #334155;
          border-radius: 24px;
          transition: background 200ms;
        }
        .toggle-slider::before {
          content: '';
          position: absolute;
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background: #94a3b8;
          border-radius: 50%;
          transition: transform 200ms;
        }
        .toggle-switch input:checked + .toggle-slider { background: #38bdf8; }
        .toggle-switch input:checked + .toggle-slider::before {
          transform: translateX(20px);
          background: #0f172a;
        }
      `}</style>
    </div>
  );
}
