// Server-side HTML sanitizer used by SSR pages before feeding admin-authored
// content into `dangerouslySetInnerHTML`.
//
// We previously used `isomorphic-dompurify`, which pulls in `jsdom` and its
// optional native deps (e.g. `canvas`). Vercel's Node.js Functions runtime
// does not bundle those, so importing `isomorphic-dompurify` at request time
// threw and every SSR page that touched it (work-single, blog-single) served
// a 500. `sanitize-html` is pure JavaScript with no native deps and works
// identically in local Node and Vercel serverless.
//
// The allow-list mirrors the tags the TinyMCE editor in `portfolio-admin`
// can emit — headings, formatting, links, images, tables, code blocks and
// the pre-formatted math/callout containers used in the article body.

import sanitizeHtml from 'sanitize-html';

const OPTIONS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'img', 'figure', 'figcaption',
    'span', 'section', 'article', 'aside',
    'sub', 'sup', 'kbd', 'mark',
    'video', 'source',
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': ['class', 'id', 'style', 'dir', 'lang'],
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'srcset', 'sizes'],
    video: ['src', 'controls', 'autoplay', 'loop', 'muted', 'poster', 'width', 'height'],
    source: ['src', 'type'],
    table: ['summary', 'border', 'cellpadding', 'cellspacing'],
    td: ['colspan', 'rowspan', 'align', 'valign'],
    th: ['colspan', 'rowspan', 'align', 'valign', 'scope'],
    code: ['class'],
    pre: ['class'],
  },
  // Keep https/mailto/tel links and allow relative or protocol-relative
  // hrefs; strip any javascript: URIs.
  allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: true,
  // Some rich-text editors emit `style="color: rgb(...)"` etc. Whitelist a
  // conservative set so basic formatting survives.
  allowedStyles: {
    '*': {
      color: [/^.*$/],
      'background-color': [/^.*$/],
      'text-align': [/^left$|^right$|^center$|^justify$/],
      'font-weight': [/^\d+$|^normal$|^bold$/],
      'font-style': [/^normal$|^italic$/],
      'text-decoration': [/^.*$/],
    },
  },
};

/**
 * Safely sanitize HTML for server rendering. Returns an empty string when
 * input is nullish so callers can `dangerouslySetInnerHTML` without extra
 * null checks.
 */
export function sanitize(html) {
  if (!html) return '';
  try {
    return sanitizeHtml(html, OPTIONS);
  } catch (err) {
    // Defense in depth: if the sanitizer itself throws (has happened in the
    // past with pathological inputs), fall back to stripping tags entirely
    // so the page still renders instead of 500ing.
    // eslint-disable-next-line no-console
    console.error('sanitize-html failed, falling back to text:', err.message);
    return String(html).replace(/<[^>]*>/g, '');
  }
}
