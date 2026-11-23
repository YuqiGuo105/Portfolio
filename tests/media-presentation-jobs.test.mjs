import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canUploadPresentation, pendingPresentationJob, presentationJobLabel,
  presentationJobMessage, presentationUploadApi, validJobId } from '../src/lib/media/presentationJobs.mjs';

const id = '95ec863a-8b73-4928-9b68-ed0014176433';
const job = { id, status: 'WAITING_UPLOAD', expiresAt: new Date(Date.now() + 3600000).toISOString() };
test('only unexpired waiting uploads accept files', () => {
  assert.equal(canUploadPresentation(job), true);
  assert.equal(canUploadPresentation({ ...job, expiresAt: '2000-01-01' }), false);
  assert.equal(canUploadPresentation({ ...job, status: 'WAITING_MEDIA', assetId: id, assetStatus: 'UPLOADING' }), true);
  for (const status of ['READY', 'PROCESSING', 'FAILED']) assert.equal(canUploadPresentation({ ...job, status: 'WAITING_MEDIA', assetId: id, assetStatus: status }), false);
  for (const status of ['SUCCEEDED', 'FAILED', 'CONFLICT', 'CANCELLED', 'EXPIRED']) {
    assert.equal(pendingPresentationJob({ ...job, status }), false);
    assert.equal(canUploadPresentation({ ...job, status }), false);
    assert.ok(presentationJobMessage({ ...job, status }));
  }
  assert.equal(presentationJobLabel({ ...job, status: 'WAITING_MEDIA', assetStatus: 'READY' }), 'Ready to replace Introduction');
  assert.match(presentationJobMessage({ status: 'SUCCEEDED' }), /five minutes/);
});
test('existing upload client is bound to one validated task, no base64 proxy', async () => {
  const calls = [];
  const api = { uploadPresentationJob: (...args) => calls.push(args), complete() {}, resume() {} };
  const adapter = presentationUploadApi(api, id);
  const file = { filename: 'intro.mp4', contentType: 'video/mp4', sizeBytes: 100 };
  await adapter.start(file);
  assert.deepEqual(calls, [[id, file]]);
  assert.equal(adapter.complete, api.complete);
  assert.equal(adapter.resume, api.resume);
  assert.equal(validJobId(['a']), false);
  assert.throws(() => presentationUploadApi(api, '../admin'));
});
test('uploader stays behind existing administrator authentication and main media entry', () => {
  const page = readFileSync(new URL('../pages/admin/media-intro.js', import.meta.url), 'utf8');
  assert.match(page, /<AdminLayout requiredPermission="operations.manage">/);
  assert.doesNotMatch(page, /getServerSideProps.*bypass|admin-secret|service.role/i);
  assert.match(readFileSync(new URL('../pages/admin/media.js', import.meta.url), 'utf8'), /href="\/admin\/media-intro"/);
  const component = readFileSync(new URL('../src/components/media/IntroductionManager.js', import.meta.url), 'utf8');
  assert.match(component, /document.hidden/);
  assert.match(component, /clearInterval/);
  assert.match(component, /Upload & replace Introduction/);
});
