// Media placeholders in article HTML, and the markup they turn into.
//
// An article stores only a reference to an uploaded asset:
//
//   <figure class="media-asset" data-media-id="<uuid>" data-media-kind="VIDEO"><img src="<preview>" alt="…"></figure>
//
// At render time the reference is resolved against `media_public`, the read model the Media
// Service publishes to. Visitors therefore always get whatever the publish pointer says now, and
// an asset that is still processing, or that failed, falls back to the stored preview image.
//
// Pure functions, no DOM: used by server-rendered pages, by the browser, and by the tests.

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const PLACEHOLDER = new RegExp(`<figure\\b[^>]*\\bdata-media-id="(${UUID})"[^>]*>([\\s\\S]*?)</figure>`, 'g');

/** Width of the article column in CSS pixels; tells the browser which image width to pick. */
export const DEFAULT_SIZES = '(max-width: 860px) 100vw, 820px';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Asset ids referenced in a piece of HTML, each once, in order of appearance. */
export function mediaIds(html) {
  const ids = [];
  for (const match of String(html || '').matchAll(PLACEHOLDER)) {
    const id = match[1].toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Absolute URL of one output file. Manifests hold paths relative to their own base path. */
export function assetUrl(baseUrl, manifest, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${manifest.basePath}/${path}`;
}

/** What the editor stores for an asset. `previewUrl` is shown wherever the reference is not resolved. */
export function placeholderHtml({ id, kind, previewUrl = '', alt = '' }) {
  const preview = previewUrl ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(alt)}">` : '';
  return `<figure class="media-asset" data-media-id="${escapeHtml(id)}" data-media-kind="${escapeHtml(kind)}">${preview}</figure>`;
}

/**
 * An adaptive video. The element carries the playlist address in `data-hls`; the page's enhancer
 * hands it to Safari's native player or to hls.js. Nothing is downloaded until the visitor plays.
 *
 * `maxHeight: 720` switches to the playlist without the 1080p rendition, and `video: false` shows
 * the poster only. Those are the two steps for saving bandwidth when the monthly budget runs low.
 */
export function videoHtml(manifest, { baseUrl, id, alt = '', maxHeight = 0, video = true } = {}) {
  const poster = manifest.poster ? assetUrl(baseUrl, manifest, manifest.poster.path) : '';
  const width = Number(manifest.width) || 16;
  const height = Number(manifest.height) || 9;
  const open = `<figure class="media-figure media-video" data-media-id="${escapeHtml(id)}">`;
  if (!video) {
    const still = poster
      ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(alt)}" width="${width}" height="${height}" loading="lazy" decoding="async">`
      : '';
    return `${open}${still}<figcaption>Video is paused to save bandwidth. Please check back later.</figcaption></figure>`;
  }
  const capped = maxHeight > 0 && Math.min(width, height) > maxHeight && manifest.hlsCapped;
  const playlist = assetUrl(baseUrl, manifest, capped ? manifest.hlsCapped : manifest.hls);
  // The optional MP4 is a muted loop, not an audio-preserving replacement for the HLS video.
  const mp4 = manifest.mp4 && manifest.hasAudio === false
    ? ` data-mp4="${escapeHtml(assetUrl(baseUrl, manifest, manifest.mp4.path))}"` : '';
  return `${open}<video controls playsinline preload="none" width="${width}" height="${height}"`
    + ` style="aspect-ratio: ${width} / ${height}"`
    + (poster ? ` poster="${escapeHtml(poster)}"` : '')
    + ` data-hls="${escapeHtml(playlist)}"${mp4}`
    + (alt ? ` aria-label="${escapeHtml(alt)}"` : '')
    + '></video></figure>';
}

/** A responsive image: AVIF first, WebP second, one JPEG for everything else. */
export function pictureHtml(manifest, { baseUrl, id, alt = '', sizes = DEFAULT_SIZES } = {}) {
  const variants = Array.isArray(manifest.variants) ? manifest.variants : [];
  const srcset = format => variants
    .filter(variant => variant.format === format)
    .sort((a, b) => a.width - b.width)
    .map(variant => `${escapeHtml(assetUrl(baseUrl, manifest, variant.path))} ${variant.width}w`)
    .join(', ');
  const sources = ['avif', 'webp']
    .map(format => [format, srcset(format)])
    .filter(([, set]) => set)
    .map(([format, set]) => `<source type="image/${format}" srcset="${set}" sizes="${escapeHtml(sizes)}">`)
    .join('');
  const fallback = manifest.fallback || variants[variants.length - 1];
  if (!fallback) return '';
  return `<figure class="media-figure media-image" data-media-id="${escapeHtml(id)}"><picture>${sources}`
    + `<img src="${escapeHtml(assetUrl(baseUrl, manifest, fallback.path))}" alt="${escapeHtml(alt)}"`
    + ` width="${Number(fallback.width) || ''}" height="${Number(fallback.height) || ''}" loading="lazy" decoding="async">`
    + '</picture></figure>';
}

/**
 * Replaces every placeholder whose asset is published. `assets` maps id → { kind, manifest } as
 * read from `media_public`. Placeholders without a published asset are left exactly as stored.
 */
export function hydrateMedia(html, assets, options = {}) {
  if (!html) return '';
  const lookup = assets instanceof Map ? id => assets.get(id) : id => (assets || {})[id];
  return String(html).replace(PLACEHOLDER, (stored, rawId, inner) => {
    const id = rawId.toLowerCase();
    const asset = lookup(id);
    if (!asset || !asset.manifest || !asset.manifest.basePath) return stored;
    const alt = (inner.match(/\balt="([^"]*)"/) || [])[1] || '';
    const settings = { ...options, id, alt: unescape(alt) };
    const markup = asset.kind === 'VIDEO' ? videoHtml(asset.manifest, settings) : pictureHtml(asset.manifest, settings);
    return markup || stored;
  });
}

function unescape(value) {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
