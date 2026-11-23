// Explicit release tool. Credentials stay in memory; only asset IDs/manifests are checkpointed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { LOCAL_DEMOS, LOCAL_INTRO } from '../src/lib/media/demoCatalog.mjs';
import { uploadMedia, waitUntilProcessed } from '../src/lib/media/upload.mjs';
import { publishedDemo } from '../src/lib/media/publishedCatalog.mjs';

const project = 'portfolio-notify-prod';
const admin = 'https://portfolio-admin-service-y45c2mnbja-uc.a.run.app';
const bucket = `${project}-media-public`;
const mediaBase = `https://storage.googleapis.com/${bucket}`;
const root = fileURLToPath(new URL('../', import.meta.url));
const checkpoint = path.join(root, '.media-review/release-state.json');
const demos = [...LOCAL_DEMOS, LOCAL_INTRO];
const mode = process.argv[2];
if (!['upload', 'publish'].includes(mode)) {
  console.log(JSON.stringify({ target: project, files: demos.map(d => d.id), mode: 'dry-run' }));
  process.exit(0);
}
assert.equal(process.env.MEDIA_RELEASE_CONFIRM, project, 'Explicit release confirmation is required');
const run = args => execFileSync('gcloud', [...args, '--project', project], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const secret = name => run(['secrets', 'versions', 'access', 'latest', '--secret', name]);
const adminSecret = secret('ADMIN_SECRET');
const recoveryToken = secret('MEDIA_RECOVERY_TOKEN');
const call = async (suffix, body) => {
  const response = await fetch(`${admin}/api/admin/media${suffix}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  assert.ok(response.ok, `Media API ${suffix.split('?')[0]} returned ${response.status}`);
  return response.json();
};
const api = { start: body => call('/uploads', body), get: id => call(`/${id}`),
  resume: (id, uploadId) => call(`/${id}/upload-parts`, { uploadId }),
  complete: (id, uploadId) => call(`/${id}/upload-complete`, { uploadId }) };
await mkdir(path.dirname(checkpoint), { recursive: true });
const state = JSON.parse(await readFile(checkpoint, 'utf8').catch(() => '{}'));
const save = () => writeFile(checkpoint, JSON.stringify(state, null, 2));
function localFile(url) {
  assert.match(url, /^\/demos\/[a-zA-Z0-9_.-]+$/);
  return path.join(root, 'public', url);
}
if (mode === 'upload') {
  const unauthenticated = await fetch(`${admin}/api/admin/media`, { signal: AbortSignal.timeout(30000) });
  assert.equal(unauthenticated.status, 401);
  console.log('Unauthenticated media access: rejected');
  for (const demo of demos) {
    const bytes = await readFile(localFile(demo.src));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const entry = state[demo.id];
    assert.ok(!entry || entry.hash === hash, `Source changed for ${demo.id}; review checkpoint before publishing`);
    if (!entry?.assetId) {
      const file = new File([bytes], path.basename(demo.src), { type: 'video/mp4', lastModified: 0 });
      let session;
      const asset = await uploadMedia(file, { api, title: demo.title, concurrency: 2,
        onSession: value => { session = value; } });
      state[demo.id] = { hash, assetId: asset.id };
      await save();
      const duplicate = await api.complete(session.assetId, session.uploadId);
      assert.equal(duplicate.id, asset.id);
      console.log(`${demo.id}: uploaded; duplicate completion safe`);
    }
    let wake;
    const current = await api.get(state[demo.id].assetId);
    if (current.status !== 'READY') {
      wake = fetch(`${admin}/api/internal/media/recover`, { method: 'POST',
        headers: { 'X-Media-Recovery-Token': recoveryToken }, signal: AbortSignal.timeout(900000) })
        .then(r => { assert.ok(r.ok, `Recovery HTTP ${r.status}`); }).catch(e => ({ error: e.message }));
    }
    const ready = await waitUntilProcessed(api, current.id, { intervalMs: 3000, timeoutMs: 900000 });
    assert.equal(ready.status, 'READY', `${demo.id} processing failed: ${ready.failureCode || 'unknown'}`);
    state[demo.id].manifest = ready.manifest;
    await save();
    const manifest = await fetch(`${mediaBase}/${ready.manifest.basePath}/${ready.manifest.hls}`);
    assert.ok(manifest.ok && (await manifest.text()).startsWith('#EXTM3U'), 'Published HLS must be readable');
    if (wake) await wake;
    console.log(`${demo.id}: READY; public HLS verified`);
  }
} else {
  const db = createClient('https://iyvhmpdfrnznxgyvvkvx.supabase.co', secret('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } });
  for (const demo of demos) {
    assert.ok(state[demo.id]?.assetId, `${demo.id} was not uploaded`);
    const ready = await api.get(state[demo.id].assetId);
    assert.equal(ready.status, 'READY');
    const prefix = `${ready.manifest.basePath}/presentation`;
    const files = [...new Set([demo.src, demo.preview, demo.poster, demo.captions, ...(demo.qualities || []).map(q => q.src)].filter(Boolean))];
    for (const file of files) {
      run(['storage', 'cp', localFile(file), `gs://${bucket}/${prefix}/${path.basename(file)}`, '--cache-control=public,max-age=31536000,immutable']);
    }
    const remote = url => url ? `${prefix}/${path.basename(url)}` : null;
    const presentation = { ...demo, src: remote(demo.src), poster: remote(demo.poster), preview: remote(demo.preview), captions: remote(demo.captions),
      qualities: (demo.qualities || []).map(q => ({ ...q, src: remote(q.src) })) };
    assert.ok(publishedDemo({ presentation, manifest: ready.manifest }, mediaBase));
    const { error } = await db.from('media_presentations').upsert({ placement_key: demo.id, asset_id: ready.id, presentation, enabled: true,
      updated_at: new Date().toISOString() }, { onConflict: 'placement_key' });
    assert.ok(!error, `Catalog publish failed: ${error?.code || ''}`);
    console.log(`${demo.id}: attached to public catalog`);
  }
  const { data, error } = await db.from('media_demo_catalog').select('placement_key');
  assert.ok(!error && demos.every(demo => data.some(row => row.placement_key === demo.id)));
  console.log(`Verified ${demos.length} ready catalog placements`);
}
