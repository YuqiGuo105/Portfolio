// src/components/admin/SlugField.js
// Auto-generates a URL slug from the title. User can unlock and edit manually.

import { useState, useEffect } from 'react';

function toSlug(str) {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 200);
}

export default function SlugField({ title, value, onChange, error }) {
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (!manual) {
      onChange(toSlug(title));
    }
  }, [title, manual]);

  return (
    <div className="slug-field">
      <div className="slug-row">
        <input
          type="text"
          value={value || ''}
          onChange={(e) => {
            setManual(true);
            onChange(e.target.value);
          }}
          placeholder="url-slug"
          className={`admin-input${error ? ' input-error' : ''}`}
          readOnly={!manual}
        />
        <button
          type="button"
          className={`slug-toggle${manual ? ' active' : ''}`}
          onClick={() => {
            if (manual) {
              setManual(false);
              onChange(toSlug(title));
            } else {
              setManual(true);
            }
          }}
          title={manual ? 'Reset to auto-generated' : 'Edit manually'}
        >
          {manual ? 'auto' : 'edit'}
        </button>
      </div>
      {error && <span className="field-error">{error}</span>}

      <style jsx>{`
        .slug-field { width: 100%; }
        .slug-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .slug-row :global(.admin-input) {
          flex: 1;
        }
        .slug-toggle {
          padding: 8px 14px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.3);
          border-radius: 6px;
          color: #38bdf8;
          font-size: 0.8rem;
          cursor: pointer;
          white-space: nowrap;
          transition: background 150ms;
        }
        .slug-toggle:hover,
        .slug-toggle.active {
          background: rgba(56, 189, 248, 0.2);
        }
        .field-error {
          display: block;
          margin-top: 4px;
          font-size: 0.8rem;
          color: #f87171;
        }
      `}</style>
    </div>
  );
}
