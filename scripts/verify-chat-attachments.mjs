import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

assert.equal(process.env.RUN_LIVE_ATTACHMENT_TEST, '1', 'Explicit opt-in required: test writes temporary files and makes one AI request.');
const base = process.env.CHAT_LIVE_TEST_URL || 'https://www.yuqi.site';
const storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(storageBase && key, 'Storage verification credentials are required.');
const bucket = process.env.AGENT_ATTACHMENT_BUCKET || 'chat-agent-private';
const sessionId = randomUUID(), deviceId = randomUUID();
const headers = { 'Content-Type': 'application/json', 'X-CW-Device-Id': deviceId };
const storageHeaders = { apikey: key, Authorization: `Bearer ${key}` };
let attachmentId;
async function erase() {
  if (!attachmentId) return;
  const response = await fetch(`${base}/api/rag/attachments/${attachmentId}?sessionId=${sessionId}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 204, 'Cleanup API failed');
}
async function stored() {
  return fetch(`${storageBase}/storage/v1/object/authenticated/${bucket}/attachments/${attachmentId}/content`, { headers: storageHeaders, signal: AbortSignal.timeout(30000) });
}
async function absent() {
  const response = await stored();
  const error = await response.json().catch(() => ({}));
  assert.ok(response.status === 404 || response.status === 400 && String(error.statusCode) === '404', 'Temporary file still exists or Storage verification failed');
}
async function upload(content) {
  const permission = await fetch(`${base}/api/rag/attachments/upload-url`, { method: 'POST', headers, body: JSON.stringify({ sessionId, name: 'synthetic-verification.txt', mimeType: 'text/plain', sizeBytes: content.length }), signal: AbortSignal.timeout(30000) });
  assert.equal(permission.status, 201, 'Upload grant failed');
  const grant = await permission.json();
  attachmentId = grant.attachmentId;
  assert.equal(new URL(grant.uploadUrl).protocol, 'https:', 'Upload grant must not cause mixed content');
  const response = await fetch(grant.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: content, signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, 'Upload failed');
  const object = await stored();
  assert.equal(object.status, 200, 'Uploaded object not found in private Storage');
  assert.equal((await object.arrayBuffer()).byteLength, content.length);
  return grant;
}
try {
  await upload(Buffer.alloc(512 * 1024, 'a'));
  await erase();
  await absent();
  console.log('PASS 512 KiB upload, private Storage readback, and explicit physical deletion');
  attachmentId = undefined;

  const marker = `fixture-${randomUUID().slice(0, 8)}`;
  const content = Buffer.from(`Synthetic test document. The verification label is ${marker}.`);
  const grant = await upload(content);
  const response = await fetch(`${base}/api/rag/answer/stream`, {
    method: 'POST', headers: { ...headers, Accept: 'text/event-stream' }, signal: AbortSignal.timeout(180000),
    body: JSON.stringify({ sessionId, question: 'What verification label appears in the attached synthetic test document? Reply with the exact label.', mode: 'FAST', scopeMode: 'GENERAL', attachments: [{ id: attachmentId, name: grant.name, mimeType: grant.mimeType, sizeBytes: content.length }] }),
  });
  assert.equal(response.status, 200, 'Chat request failed');
  const stream = await response.text();
  const finals = stream.split('\n').filter(line => line.startsWith('data:')).map(line => {
    try { return JSON.parse(line.slice(5)); } catch { return {}; }
  });
  assert.ok(finals.some(event => String(event.payload?.answer || '').includes(marker)), 'Model did not demonstrate reading the test file');
  // Check BEFORE client cleanup: the parser itself must remove the original.
  await absent();
  console.log('PASS real attachment analysis and server-side physical deletion after use');
} finally {
  await erase();
}
