// src/components/admin/RichTextEditor.js
// SSR-safe wrapper around react-quill (Quill is browser-only).
// Loaded via dynamic import from ContentEditor.
//
// Toolbar: heading, bold, italic, underline, blockquote, ordered/bullet
// lists, link, image, plus strike / code-block / clean for convenience.
// Image button:
//   1. Opens a file picker for the local image.
//   2. Uploads it to Supabase Storage (bucket configurable via
//      NEXT_PUBLIC_SUPABASE_CONTENT_BUCKET, default "content-images").
//   3. Inserts the returned public URL at the current cursor position.
//   4. If upload fails (bucket missing, permission denied, offline, ...)
//      it falls back to prompting the user for an image URL so the
//      editor never gets stuck behind a broken upload flow.

import { forwardRef, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '../../supabase/supabaseClient';

const CONTENT_BUCKET =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_SUPABASE_CONTENT_BUCKET) ||
  'content-images';

// Mirror cv.js' sanitizer so Supabase Storage paths stay ASCII-safe.
function sanitizeFilename(name) {
  const original = String(name || 'upload').trim();
  const dot = original.lastIndexOf('.');
  const ext = dot >= 0 ? original.slice(dot) : '';
  const base = dot >= 0 ? original.slice(0, dot) : original;
  const safeBase =
    base
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'file';
  const safeExt = ext.replace(/[^a-zA-Z0-9.]+/g, '').slice(0, 10);
  return safeBase + safeExt;
}

async function defaultUploadImage(file) {
  const safeName = sanitizeFilename(file.name);
  const path = `content/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(CONTENT_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from(CONTENT_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Upload succeeded but no public URL');
  return data.publicUrl;
}

// Wrap react-quill in forwardRef so next/dynamic still propagates refs
// to the underlying Quill component. Without this we can't reach
// .getEditor() from the image handler.
//
// Also pull in Quill's "snow" theme CSS here (browser-only — Quill must
// never run server-side). Without quill.snow.css the toolbar buttons
// have no icons, the editor frame has no border, and the whole control
// looks invisible.
const QuillNoSSR = dynamic(
  async () => {
    const { default: RQ } = await import('react-quill');
    require('react-quill/dist/quill.snow.css');
    const Wrapped = forwardRef(function QuillForwardRef(props, ref) {
      return <RQ ref={ref} {...props} />;
    });
    Wrapped.displayName = 'QuillForwardRef';
    return Wrapped;
  },
  {
    ssr: false,
    loading: () => <div className="quill-loading">Loading editor…</div>,
  }
);

const FORMATS = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'blockquote',
  'code-block',
  'list',
  'bullet',
  'link',
  'image',
];

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  uploadImage,
}) {
  const quillRef = useRef(null);
  const uploader = uploadImage || defaultUploadImage;

  const imageHandler = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const editor = quillRef.current?.getEditor?.();
      if (!editor) return;
      const range = editor.getSelection(true) || { index: editor.getLength(), length: 0 };

      let url = '';
      try {
        url = await uploader(file);
      } catch (err) {
        // Upload failed (bucket missing, permission denied, offline, ...).
        // Fall back to a manual URL prompt so the editor never gets stuck
        // behind a broken upload flow.
        const msg = err?.message || 'unknown error';
        // eslint-disable-next-line no-alert
        const manual = window.prompt(
          `Image upload failed (${msg}). Paste a public image URL instead:`,
          ''
        );
        url = (manual || '').trim();
      }

      if (!url) return;
      editor.insertEmbed(range.index, 'image', url, 'user');
      editor.setSelection(range.index + 1, 0, 'user');
    };
    input.click();
  }, [uploader]);

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'image'],
          ['clean'],
        ],
        handlers: {
          image: imageHandler,
        },
      },
      clipboard: { matchVisual: false },
    }),
    [imageHandler]
  );

  return (
    <>
      <QuillNoSSR
        ref={quillRef}
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
          background: #f1f3f4;
          border-color: #cfd6db !important;
          border-radius: 6px 6px 0 0;
        }
        .rich-editor .ql-container {
          background: #ffffff;
          border-color: #cfd6db !important;
          border-radius: 0 0 6px 6px;
          min-height: 320px;
          font-size: 0.95rem;
          color: #25313b;
        }
        .rich-editor .ql-editor {
          min-height: 320px;
          color: #25313b;
        }
        .rich-editor .ql-editor.ql-blank::before {
          color: #909aa2;
        }
        .rich-editor .ql-editor img {
          max-width: 100%;
          height: auto;
          border-radius: 6px;
        }
        .rich-editor .ql-editor blockquote {
          border-left: 3px solid #0f766e;
          padding-left: 12px;
          color: #52606b;
          margin: 8px 0;
        }
        .rich-editor .ql-editor pre.ql-syntax,
        .rich-editor .ql-editor pre {
          background: #20272e;
          color: #eef2f4;
          padding: 12px 14px;
          border-radius: 6px;
          overflow-x: auto;
        }
        .rich-editor .ql-stroke {
          stroke: #5f6b75 !important;
        }
        .rich-editor .ql-fill {
          fill: #5f6b75 !important;
        }
        .rich-editor .ql-picker-label,
        .rich-editor .ql-picker-item {
          color: #5f6b75 !important;
        }
        .rich-editor .ql-picker-options {
          background: #ffffff !important;
          border-color: #cfd6db !important;
        }
        .rich-editor .ql-snow .ql-tooltip {
          background: #ffffff;
          color: #25313b;
          border-color: #cfd6db;
          box-shadow: 0 4px 16px rgba(23, 33, 43, 0.14);
        }
        .rich-editor .ql-snow .ql-tooltip input[type='text'] {
          background: #ffffff;
          color: #25313b;
          border-color: #cfd6db;
        }
        .quill-loading {
          height: 320px;
          background: #ffffff;
          border: 1px solid #cfd6db;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #66717d;
          font-size: 0.9rem;
        }
      `}</style>
    </>
  );
}
