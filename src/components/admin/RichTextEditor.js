// src/components/admin/RichTextEditor.js
// SSR-safe wrapper around react-quill (Quill is browser-only).
// Loaded via dynamic import from ContentEditor.

import { useMemo } from 'react';
import dynamic from 'next/dynamic';

const QuillNoSSR = dynamic(
  async () => {
    const { default: RQ } = await import('react-quill');
    return RQ;
  },
  { ssr: false, loading: () => <div className="quill-loading">Loading editor…</div> }
);

const TOOLBAR_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    ['blockquote', 'code-block'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link', 'image'],
    ['clean'],
  ],
};

const FORMATS = [
  'header', 'bold', 'italic', 'underline', 'strike',
  'blockquote', 'code-block', 'list', 'bullet', 'link', 'image',
];

export default function RichTextEditor({ value, onChange, placeholder }) {
  const modules = useMemo(() => TOOLBAR_MODULES, []);

  return (
    <>
      <QuillNoSSR
        theme="snow"
        value={value || ''}
        onChange={onChange}
        modules={modules}
        formats={FORMATS}
        placeholder={placeholder || 'Write your content here…'}
        className="rich-editor"
      />
      <style jsx global>{`
        .rich-editor .ql-toolbar {
          background: #1e293b;
          border-color: rgba(148, 163, 184, 0.3) !important;
          border-radius: 8px 8px 0 0;
        }
        .rich-editor .ql-container {
          background: #0f172a;
          border-color: rgba(148, 163, 184, 0.3) !important;
          border-radius: 0 0 8px 8px;
          min-height: 300px;
          font-size: 0.95rem;
          color: #e2e8f0;
        }
        .rich-editor .ql-editor {
          min-height: 300px;
          color: #e2e8f0;
        }
        .rich-editor .ql-editor.ql-blank::before {
          color: rgba(148, 163, 184, 0.5);
        }
        .rich-editor .ql-stroke {
          stroke: #94a3b8 !important;
        }
        .rich-editor .ql-fill {
          fill: #94a3b8 !important;
        }
        .rich-editor .ql-picker-label {
          color: #94a3b8 !important;
        }
        .quill-loading {
          height: 300px;
          background: #1e293b;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #94a3b8;
          font-size: 0.9rem;
        }
      `}</style>
    </>
  );
}
