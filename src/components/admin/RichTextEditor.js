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

import { forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '../../supabase/supabaseClient';
import { writerApi } from '../../lib/writerApi';
import { assetUrl } from '../../lib/media/markup.mjs';
import { processingProgress, uploadMedia, waitUntilProcessed } from '../../lib/media/upload.mjs';

// The media pipeline (upload -> transcode -> publish) is offered only once its backend is switched on.
const MEDIA_PIPELINE = process.env.NEXT_PUBLIC_MEDIA_PIPELINE === '1';
const MEDIA_BASE_URL = process.env.NEXT_PUBLIC_MEDIA_BASE_URL || '';
const MEDIA_ACCEPT = 'video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,image/avif,image/heic';

// An uploaded asset is stored in the article as a reference (see src/lib/media/markup.mjs).
// Quill only keeps HTML it has a blot for, so the reference gets one.
let QuillClass = null;
function registerMediaAsset(Quill) {
  QuillClass = Quill;
  if (Quill.imports['formats/media-asset']) return;
  const BlockEmbed = Quill.import('blots/block/embed');
  class MediaAsset extends BlockEmbed {
    static create(value) {
      const node = super.create();
      node.setAttribute('data-media-id', value.id);
      node.setAttribute('data-media-kind', value.kind);
      node.setAttribute('contenteditable', 'false');
      if (value.previewUrl) {
        const preview = document.createElement('img');
        preview.setAttribute('src', value.previewUrl);
        preview.setAttribute('alt', value.alt || '');
        node.appendChild(preview);
      }
      return node;
    }
    static value(node) {
      const preview = node.querySelector('img');
      return {
        id: node.getAttribute('data-media-id'),
        kind: node.getAttribute('data-media-kind'),
        previewUrl: preview ? preview.getAttribute('src') : '',
        alt: preview ? preview.getAttribute('alt') : '',
      };
    }
  }
  MediaAsset.blotName = 'media-asset';
  MediaAsset.tagName = 'FIGURE';
  MediaAsset.className = 'media-asset';
  Quill.register(MediaAsset, true);
  Quill.import('ui/icons').media = '<svg viewBox="0 0 18 18"><rect class="ql-stroke" x="2" y="3" width="14" height="12" rx="2" fill="none"/><polygon class="ql-fill" points="7,6 12,9 7,12"/></svg>';
}

/** The image a reference shows wherever it is not resolved: the video poster or the JPEG fallback. */
function previewOf(asset) {
  const file = asset?.manifest?.poster || asset?.manifest?.fallback;
  return file && MEDIA_BASE_URL ? assetUrl(MEDIA_BASE_URL, asset.manifest, file.path) : '';
}

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
    registerMediaAsset(RQ.Quill);
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
  'media-asset',
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
  const [mediaStatus, setMediaStatus] = useState('');
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

  // Upload through the media pipeline, insert the reference at once, fill in its preview when ready.
  const mediaHandler = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = MEDIA_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      const editor = quillRef.current?.getEditor?.();
      if (!file || !editor) return;
      const range = editor.getSelection(true) || { index: editor.getLength(), length: 0 };
      try {
        setMediaStatus(`Uploading ${file.name}…`);
        const uploaded = await uploadMedia(file, {
          api: writerApi.media,
          onProgress: fraction => setMediaStatus(`Uploading ${file.name}: ${Math.round(fraction * 100)}%`),
        });
        editor.insertEmbed(range.index, 'media-asset', { id: uploaded.id, kind: uploaded.kind, alt: file.name }, 'user');
        editor.setSelection(range.index + 1, 0, 'user');
        const asset = await waitUntilProcessed(writerApi.media, uploaded.id, {
          onUpdate: current => {
            const { done, total } = processingProgress(current);
            setMediaStatus(total ? `Processing ${file.name}: step ${done} of ${total}` : `Processing ${file.name}…`);
          },
        });
        if (asset.status !== 'READY') throw new Error(asset.failureMessage || 'Processing failed');
        const node = editor.root.querySelector(`figure[data-media-id="${asset.id}"]`);
        const blot = node && QuillClass ? QuillClass.find(node) : null;
        const index = blot ? editor.getIndex(blot) : -1;
        if (index >= 0) {
          editor.deleteText(index, 1, 'user');
          editor.insertEmbed(index, 'media-asset', { id: asset.id, kind: asset.kind, previewUrl: previewOf(asset), alt: file.name }, 'user');
        }
        setMediaStatus(`${file.name} is ready.`);
      } catch (err) {
        setMediaStatus(`${file.name}: ${err?.message || 'upload failed'}`);
      }
    };
    input.click();
  }, []);
  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          MEDIA_PIPELINE ? ['link', 'image', 'media'] : ['link', 'image'],
          ['clean'],
        ],
        handlers: {
          image: imageHandler,
          media: mediaHandler,
        },
      },
      clipboard: { matchVisual: false },
    }),
    [imageHandler, mediaHandler]
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
      {mediaStatus && <p className="rich-editor-media-status" role="status">{mediaStatus}</p>}
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
        .rich-editor .ql-editor figure.media-asset {
          margin: 12px 0;
          padding: 8px;
          border: 1px dashed #9aa5ae;
          border-radius: 6px;
          background: #f6f8f9;
        }
        .rich-editor .ql-editor figure.media-asset:empty::before {
          content: 'Media: processing';
          color: #66717d;
          font-size: 0.85rem;
        }
        .rich-editor .ql-editor figure.media-asset[data-media-kind='VIDEO']::after {
          content: 'Video';
          display: block;
          margin-top: 4px;
          color: #66717d;
          font-size: 0.8rem;
        }
        .rich-editor-media-status {
          margin: 6px 2px 0;
          color: #52606b;
          font-size: 0.85rem;
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
