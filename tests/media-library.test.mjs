import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaSteps, savedUpload, mediaWarnings } from '../src/lib/media/library.mjs';
import { publishedDemo, loadMediaCatalog } from '../src/lib/media/publishedCatalog.mjs';

test('inspector reports real progress, failed tasks and completion', () => {
  const asset = { kind: 'VIDEO', sourceVersion: 1, status: 'PROCESSING', jobs: [
    { type: 'PLAN', status: 'SUCCEEDED' }, { type: 'VIDEO_RENDITION', rendition: '720p', status: 'RUNNING' },
  ] };
  assert.deepEqual(mediaSteps(asset).map(s => s.state), ['done', 'done', 'active', 'waiting']);
  asset.jobs[1].status = 'DEAD'; asset.status = 'FAILED';
  assert.equal(mediaSteps(asset)[2].state, 'failed');
  asset.status = 'READY';
  assert.ok(mediaSteps(asset).every(s => s.state === 'done'));
});
test('resume metadata never stores signed URLs', () => {
  assert.equal(JSON.stringify(savedUpload({ assetId: 'a', uploadId: 'b', parts: [{ url: 'secret' }] })).includes('secret'), false);
});
test('size warnings compare actual source and placement', () => {
  assert.equal(mediaWarnings({ probe: { width: 400 }, usages: [{ displayWidth: 1000, label: 'Home' }] }).length, 1);
});
test('published catalog only exposes safe media paths and PR links', () => {
  const row = { manifest: {}, presentation: { id: 'yuqi-intro', seconds: 60, src: 'media/a/v1/intro.mp4', poster: 'media/a/v1/poster.webp',
    chapters: [{ seconds: 0, title: 'Start', href: 'javascript:alert(1)' }] } };
  const demo = publishedDemo(row, 'https://storage.googleapis.com/public');
  assert.equal(demo.src, 'https://storage.googleapis.com/public/media/a/v1/intro.mp4');
  assert.equal(demo.chapters[0].href, undefined);
  row.presentation.src = 'media/a/../original.mp4';
  assert.equal(publishedDemo(row, 'https://storage.googleapis.com/public'), null);
});
test('production never uses local catalog and lookup failure is harmless', async () => {
  assert.deepEqual(await loadMediaCatalog(null, { NODE_ENV: 'production', MEDIA_LOCAL_REVIEW: '1' }), { demos: [], intro: null });
  const client = { from() { throw new Error('offline'); } };
  assert.deepEqual(await loadMediaCatalog(client, { NEXT_PUBLIC_MEDIA_BASE_URL: 'https://example.com' }), { demos: [], intro: null });
});

test('asset-backed introduction resolves only processed full HLS, poster and levels', () => {
  const row = { placement_key: 'yuqi-intro', presentation: { version: 2, playback: 'asset', id: 'yuqi-intro',
    title: 'Introduction', chapters: [{ seconds: 0, title: 'Start' }] }, manifest: {
    basePath: 'media/video/v1', hls: 'master.m3u8', durationSeconds: 60, width: 1280, height: 720,
    poster: { path: 'poster.jpg' }, mp4: { path: 'short-loop.mp4' },
    renditions: [{ width: 640, height: 360, playlist: '360p/index.m3u8' }, { width: 1280, height: 720, playlist: '720p/index.m3u8' }],
  } };
  const demo = publishedDemo(row, 'https://media.example');
  assert.equal(demo.hls, 'https://media.example/media/video/v1/master.m3u8');
  assert.equal(demo.src, demo.hls);
  assert.deepEqual(demo.qualities.map(q => q.height), [360, 720]);
  assert.equal(JSON.stringify(demo).includes('short-loop'), false);
  for (const broken of ['../original.mp4', 'https://untrusted.example/a', '/master.m3u8', '']) {
    assert.equal(publishedDemo({ ...row, manifest: { ...row.manifest, hls: broken } }, 'https://media.example'), null);
  }
  assert.equal(publishedDemo({ ...row, placement_key: 'other' }, 'https://media.example'), null);
  assert.equal(publishedDemo({ ...row, manifest: { ...row.manifest, renditions: [] } }, 'https://media.example'), null);
});
