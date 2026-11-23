// The site's half of the media pipeline: turning stored references into markup, and uploading.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assetUrl, hydrateMedia, mediaIds, pictureHtml, placeholderHtml, videoHtml } from '../src/lib/media/markup.mjs';
import { processingProgress, uploadMedia, waitUntilProcessed } from '../src/lib/media/upload.mjs';

const BASE = 'https://storage.googleapis.com/portfolio-media-public';
const VIDEO_ID = '5a9715ea-8d30-45b8-b0da-7f9b413bda4f';
const IMAGE_ID = '10013a52-f955-43b4-94c5-2159c9420ffa';

// Shaped exactly like what the Media Service writes to media_assets.manifest.
const video = {
  version: 1, kind: 'VIDEO', basePath: `media/${VIDEO_ID}/1/v1`, hls: 'master-3a354f1f9bd6.m3u8',
  hlsCapped: 'master-720-ec7cb6dca9df.m3u8', width: 1920, height: 1080, durationSeconds: 14, hasAudio: true,
  poster: { path: 'a1/poster/poster.jpg', width: 1280, height: 720 },
  mp4: { path: 'a1/mp4/loop.mp4', width: 1280, height: 720 },
  renditions: [{ name: '360p', width: 640, height: 360, bandwidth: 903159, playlist: 'a1/360p/index.m3u8' }],
};
const image = {
  version: 1, kind: 'IMAGE', basePath: `media/${IMAGE_ID}/1/v1`, width: 3024, height: 4032, alpha: false,
  variants: [
    { format: 'webp', width: 640, height: 853, path: 'a1/image/w640.webp', bytes: 17000 },
    { format: 'avif', width: 640, height: 853, path: 'a1/image/w640.avif', bytes: 6000 },
    { format: 'avif', width: 320, height: 427, path: 'a1/image/w320.avif', bytes: 2000 },
    { format: 'webp', width: 320, height: 427, path: 'a1/image/w320.webp', bytes: 5000 },
  ],
  fallback: { format: 'jpeg', width: 1280, height: 1707, path: 'a1/image/w1280.jpg', bytes: 90000 },
};
const assets = new Map([[VIDEO_ID, { kind: 'VIDEO', manifest: video }], [IMAGE_ID, { kind: 'IMAGE', manifest: image }]]);

test('an article stores a reference and a preview, nothing else', () => {
  const stored = placeholderHtml({ id: VIDEO_ID, kind: 'VIDEO', previewUrl: `${BASE}/p.jpg`, alt: 'Demo "one" <b>' });
  assert.equal(stored, `<figure class="media-asset" data-media-id="${VIDEO_ID}" data-media-kind="VIDEO">`
    + `<img src="${BASE}/p.jpg" alt="Demo &quot;one&quot; &lt;b&gt;"></figure>`);
  const html = `<p>a</p>${stored}<p>b</p>${stored}${placeholderHtml({ id: IMAGE_ID.toUpperCase(), kind: 'IMAGE' })}`;
  assert.deepEqual(mediaIds(html), [VIDEO_ID, IMAGE_ID]);
  assert.deepEqual(mediaIds('<p>no media</p>'), []);
});

test('a published video becomes a player that loads nothing until play', () => {
  const html = videoHtml(video, { baseUrl: `${BASE}/`, id: VIDEO_ID, alt: 'Demo' });
  assert.match(html, /^<figure class="media-figure media-video" data-media-id="5a9715ea-/);
  assert.match(html, /<video controls playsinline preload="none" width="1920" height="1080" style="aspect-ratio: 1920 \/ 1080"/);
  assert.ok(html.includes(`poster="${BASE}/media/${VIDEO_ID}/1/v1/a1/poster/poster.jpg"`));
  assert.ok(html.includes(`data-hls="${BASE}/media/${VIDEO_ID}/1/v1/master-3a354f1f9bd6.m3u8"`));
  assert.ok(!html.includes('data-mp4='), 'a muted loop must never replace a video with audio');
  assert.ok(videoHtml({ ...video, hasAudio: false }, { baseUrl: BASE, id: VIDEO_ID }).includes('data-mp4='));
  assert.ok(!html.includes(' src='), 'no source is set in the markup itself');
});

test('the two bandwidth-saving steps: no 1080p, then posters only', () => {
  const capped = videoHtml(video, { baseUrl: BASE, id: VIDEO_ID, maxHeight: 720 });
  assert.ok(capped.includes('master-720-ec7cb6dca9df.m3u8'));
  const small = videoHtml({ ...video, width: 1280, height: 720, hlsCapped: undefined }, { baseUrl: BASE, id: VIDEO_ID, maxHeight: 720 });
  assert.ok(small.includes('master-3a354f1f9bd6.m3u8'), 'a 720p video has nothing to cap');
  const off = videoHtml(video, { baseUrl: BASE, id: VIDEO_ID, video: false });
  assert.ok(!off.includes('<video') && off.includes('poster.jpg') && off.includes('<figcaption>'));
});

test('a published image becomes AVIF and WebP by width, with one JPEG for everyone else', () => {
  const html = pictureHtml(image, { baseUrl: BASE, id: IMAGE_ID, alt: 'Screenshot' });
  const p = `${BASE}/media/${IMAGE_ID}/1/v1/a1/image`;
  assert.ok(html.includes(`<source type="image/avif" srcset="${p}/w320.avif 320w, ${p}/w640.avif 640w" sizes="(max-width: 860px) 100vw, 820px">`));
  assert.ok(html.includes(`<source type="image/webp" srcset="${p}/w320.webp 320w, ${p}/w640.webp 640w"`));
  assert.ok(html.includes(`<img src="${p}/w1280.jpg" alt="Screenshot" width="1280" height="1707" loading="lazy" decoding="async">`));
  assert.ok(html.indexOf('image/avif') < html.indexOf('image/webp'), 'the smaller format is offered first');
});

test('only published assets are replaced; everything else stays as the author stored it', () => {
  const pendingId = '00000000-0000-4000-8000-000000000001';
  const pending = placeholderHtml({ id: pendingId, kind: 'VIDEO', previewUrl: 'https://example.com/preview.jpg', alt: 'Soon' });
  const html = `<h2>Title</h2>${placeholderHtml({ id: VIDEO_ID, kind: 'VIDEO', previewUrl: 'https://example.com/p.jpg', alt: 'Demo & more' })}`
    + `<p>text</p>${placeholderHtml({ id: IMAGE_ID, kind: 'IMAGE', previewUrl: 'x.jpg', alt: 'Shot' })}${pending}`;

  const out = hydrateMedia(html, assets, { baseUrl: BASE });

  assert.ok(out.startsWith('<h2>Title</h2><figure class="media-figure media-video"'));
  assert.ok(out.includes('aria-label="Demo &amp; more"'));
  assert.ok(out.includes('<picture>') && out.includes('alt="Shot"'));
  assert.ok(out.endsWith(pending), 'an asset still processing keeps its preview');
  assert.equal(hydrateMedia(html, new Map(), { baseUrl: BASE }), html);
  assert.equal(hydrateMedia('', assets, { baseUrl: BASE }), '');
  assert.equal(assetUrl('https://cdn.example.com//', video, 'a1/x.m3u8'), `https://cdn.example.com/media/${VIDEO_ID}/1/v1/a1/x.m3u8`);
});

// ── uploading ────────────────────────────────────────────────────────────────

function fakeBackend({ partSize = 4, uploadedParts = [], failOnce = new Set(), refuse = new Set() } = {}) {
  const state = { puts: [], calls: [], inFlight: 0, maxInFlight: 0, failed: new Set() };
  const api = {
    async start(body) {
      state.calls.push(['start', body]);
      const partCount = Math.ceil(body.sizeBytes / partSize);
      return { assetId: 'asset-1', uploadId: 'upload-1', sizeBytes: body.sizeBytes, contentType: body.contentType, partSizeBytes: partSize, partCount, uploadedParts: [],
        parts: Array.from({ length: partCount }, (_, i) => ({ partNumber: i + 1, url: `https://bucket.example/part/${i + 1}` })) };
    },
    async resume(assetId, uploadId) {
      state.calls.push(['resume', assetId, uploadId]);
      return { assetId, uploadId, sizeBytes: 12, contentType: 'video/mp4', partSizeBytes: partSize, partCount: 3, uploadedParts,
        parts: [1, 2, 3].map(n => ({ partNumber: n, url: `https://bucket.example/part/${n}` })) };
    },
    async complete(assetId, uploadId) { state.calls.push(['complete', assetId, uploadId]); return { id: assetId, status: 'PROCESSING' }; },
  };
  const fetchImpl = async (url, { method, body }) => {
    const part = Number(url.split('/').pop());
    state.inFlight += 1; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise(resolve => setTimeout(resolve, 2));
    state.inFlight -= 1;
    if (refuse.has(part)) return { ok: false, status: 403 };
    if (failOnce.has(part) && !state.failed.has(part)) { state.failed.add(part); return { ok: false, status: 500 }; }
    state.puts.push({ part, method, text: await body.text() });
    return { ok: true, status: 200 };
  };
  return { api, fetchImpl, state };
}
const instant = () => Promise.resolve();

test('the file goes to the bucket in parts, a few at a time, and is confirmed once', async () => {
  const { api, fetchImpl, state } = fakeBackend();
  const file = new File(['abcdefghijklmnopqrstuv'], 'demo.mp4', { type: 'video/mp4' });   // 22 bytes → 6 parts of 4
  const progress = [];

  const asset = await uploadMedia(file, { api, fetchImpl, wait: instant, concurrency: 2, title: 'Demo', onProgress: p => progress.push(p) });

  assert.deepEqual(state.calls[0], ['start', { filename: 'demo.mp4', contentType: 'video/mp4', sizeBytes: 22, title: 'Demo' }]);
  assert.equal(state.puts.sort((a, b) => a.part - b.part).map(put => put.text).join(''), 'abcdefghijklmnopqrstuv');
  assert.ok(state.puts.every(put => put.method === 'PUT'));
  assert.ok(state.maxInFlight <= 2, 'never more uploads at once than asked for');
  assert.deepEqual(state.calls.at(-1), ['complete', 'asset-1', 'upload-1']);
  assert.equal(state.calls.filter(call => call[0] === 'complete').length, 1);
  assert.equal(progress.at(-1), 1);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b), 'progress never goes backwards');
  assert.equal(asset.status, 'PROCESSING');
});

test('a part that fails is retried on its own; a refused URL is not retried', async () => {
  const flaky = fakeBackend({ failOnce: new Set([2]) });
  await uploadMedia(new File(['abcdefghij'], 'a.mp4', { type: 'video/mp4' }), { api: flaky.api, fetchImpl: flaky.fetchImpl, wait: instant });
  assert.equal(flaky.state.puts.length, 3);
  assert.equal(flaky.state.calls.at(-1)[0], 'complete');

  const refused = fakeBackend({ refuse: new Set([1]) });
  await assert.rejects(
    uploadMedia(new File(['abcdefghij'], 'a.mp4', { type: 'video/mp4' }), { api: refused.api, fetchImpl: refused.fetchImpl, wait: instant, concurrency: 1 }),
    /refused \(403\)/);
  assert.ok(!refused.state.calls.some(call => call[0] === 'complete'), 'an incomplete upload is never confirmed');
});

test('an interrupted upload continues with the parts that are missing', async () => {
  const { api, fetchImpl, state } = fakeBackend({ uploadedParts: [1, 3] });
  const progress = [];
  await uploadMedia(new File(['abcdefghijkl'], 'a.mp4', { type: 'video/mp4', lastModified: 123 }),
    { api, fetchImpl, wait: instant, resume: { assetId: 'asset-9', uploadId: 'upload-9',
      fileIdentity: { name: 'a.mp4', size: 12, type: 'video/mp4', lastModified: 123 } }, onProgress: p => progress.push(p) });

  assert.deepEqual(state.calls[0], ['resume', 'asset-9', 'upload-9']);
  assert.deepEqual(state.puts.map(put => [put.part, put.text]), [[2, 'efgh']]);
  assert.ok(Math.abs(progress[0] - 8 / 12) < 1e-9, 'starts from what is already stored');
  assert.deepEqual(state.calls.at(-1), ['complete', 'asset-9', 'upload-9']);
});

test('wrong-file resume, expired metadata and cancellation never confirm an upload', async () => {
  const backend = fakeBackend();
  const file = new File(['abcd'], 'a.mp4', { type: 'video/mp4' });
  await assert.rejects(uploadMedia(file, { ...backend, resume: { assetId: 'x', uploadId: 'y' } }), /original file/);
  assert.equal(backend.state.calls.length, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(uploadMedia(file, { ...backend, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(backend.state.calls.length, 0);
  const invalid = { ...backend.api, start: async () => ({ sizeBytes: 100, contentType: 'video/mp4' }) };
  await assert.rejects(uploadMedia(file, { ...backend, api: invalid }), /does not match/);
});

test('a failed parallel upload stops scheduling more parts and never completes', async () => {
  const backend = fakeBackend({ refuse: new Set([1]) });
  await assert.rejects(uploadMedia(new File(['abcdefghijklmnopqrstuvwx'], 'a.mp4', { type: 'video/mp4' }),
    { ...backend, concurrency: 2, wait: instant }), /refused/);
  assert.ok(backend.state.puts.every(part => part.part <= 2));
  assert.ok(!backend.state.calls.some(call => call[0] === 'complete'));
});

test('waiting for processing ends at READY or FAILED and reports each step', async () => {
  const states = [
    { status: 'PROCESSING', jobs: [{ status: 'SUCCEEDED' }, { status: 'RUNNING' }, { status: 'PENDING' }] },
    { status: 'PROCESSING', jobs: [{ status: 'SUCCEEDED' }, { status: 'SUCCEEDED' }, { status: 'RUNNING' }] },
    { status: 'READY', jobs: [{ status: 'SUCCEEDED' }, { status: 'SUCCEEDED' }, { status: 'SUCCEEDED' }] },
  ];
  const seen = [];
  const final = await waitUntilProcessed({ get: async () => states.shift() }, 'asset-1', { wait: instant, onUpdate: a => seen.push(processingProgress(a)) });
  assert.equal(final.status, 'READY');
  assert.deepEqual(seen, [{ done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);

  const failed = await waitUntilProcessed({ get: async () => ({ status: 'FAILED', failureMessage: 'the file has no video stream' }) }, 'asset-2', { wait: instant });
  assert.equal(failed.failureMessage, 'the file has no video stream');
  assert.deepEqual(processingProgress(null), { done: 0, total: 0 });
});
