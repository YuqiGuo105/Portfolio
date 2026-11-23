// Used by the Java media-e2e profile against loopback services only.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadMedia, waitUntilProcessed } from '../src/lib/media/upload.mjs';

const base = new URL(process.env.MEDIA_E2E_ADMIN_URL);
assert.equal(base.hostname, '127.0.0.1');
assert.equal(base.protocol, 'http:');
const output = process.env.MEDIA_E2E_OUTPUT;
await mkdir(output, { recursive: true });
const catalogPath = process.env.MEDIA_E2E_CATALOG;
const catalog = catalogPath
  ? JSON.parse(await readFile(catalogPath, 'utf8'))
  : [{ file: 'clip.mp4', type: 'video/mp4' }, { file: 'image.png', type: 'image/png' }];
assert.ok(catalog.length >= 1 && catalog.length <= 20);
const call = async (suffix, body) => {
  const response = await fetch(new URL(`/api/admin/media${suffix}`, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': process.env.MEDIA_E2E_ADMIN_SECRET },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000),
  });
  assert.ok(response.ok, `Media API HTTP ${response.status}`);
  return response.json();
};
const api = {
  start: body => call('/uploads', body),
  resume: (id, uploadId) => call(`/${id}/upload-parts`, { uploadId }),
  complete: (id, uploadId) => call(`/${id}/upload-complete`, { uploadId }),
  get: id => call(`/${id}`),
};
const results = [];
for (const item of catalog) {
  const { file: filename, type } = item;
  const inputRoot = catalogPath ? path.dirname(path.resolve(catalogPath)) : path.resolve(output);
  const input = path.resolve(inputRoot, filename);
  assert.ok(input.startsWith(inputRoot + path.sep), 'Input must remain inside the local catalog');
  const file = new File([await readFile(input)], path.basename(filename), { type });
  let session;
  let progress = 0;
  let injectedFailure = false;
  const asset = await uploadMedia(file, {
    api, concurrency: 2, title: item.title || 'Local end-to-end verification',
    onSession: value => { session = value; },
    onProgress: value => { assert.ok(value >= progress); progress = value; },
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).hostname, '127.0.0.1');
      if (!injectedFailure) { injectedFailure = true; return new Response('', { status: 503 }); }
      return fetch(url, options);
    },
  });
  assert.equal(progress, 1);
  if (!catalogPath && type === 'video/mp4') assert.ok(session.partCount >= 2, 'Exercise multipart completion');
  if (file.size > 5242880) assert.ok(session.partCount >= 2);
  const again = await api.complete(session.assetId, session.uploadId);
  assert.equal(again.id, asset.id);
  const ready = await waitUntilProcessed(api, asset.id, { intervalMs: 500, timeoutMs: 240000 });
  assert.equal(ready.status, 'READY', JSON.stringify(ready));
  assert.ok(ready.manifest);
  results.push({ ...(catalogPath ? item : {}), id: ready.id, kind: ready.kind, manifest: ready.manifest });
  await writeFile(path.join(output, 'manifests.json'), JSON.stringify(results, null, 2));
  console.log(`Verified ${ready.kind}: ${session.partCount} parts, retry, duplicate completion, READY`);
}
