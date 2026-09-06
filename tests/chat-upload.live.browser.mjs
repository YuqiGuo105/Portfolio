import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

assert.equal(process.env.RUN_LIVE_ATTACHMENT_TEST, '1', 'Explicit live-test opt-in required.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.CHAT_LIVE_TEST_URL || 'https://www.yuqi.site';
const storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(storageBase && key, 'Private Storage verification credentials required.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let page, grant, sessionId, deviceId;
try {
  const label = `pdf-${randomUUID().slice(0, 8)}`;
  const fixture = await browser.newPage();
  await fixture.setContent(`<h1>Synthetic upload verification</h1><p>The verification label is ${label}.</p>`);
  const pdf = await fixture.pdf({ format: 'A4' });
  await fixture.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30000);
  await page.goto(`${base}/?openChat=1`, { waitUntil: 'domcontentloaded' });
  const input = page.getByRole('textbox', { name: 'Message input', exact: true });
  await input.fill('What verification label appears in the attached PDF? Reply with the exact label.');
  const grantResponse = page.waitForResponse(r => r.url().includes('/attachments/upload-url') && r.request().method() === 'POST');
  const uploadResponse = page.waitForResponse(r => r.url().includes('/content?') && r.request().method() === 'PUT');
  uploadResponse.catch(() => {});
  await page.locator('#__chat_widget_root input[type=file]').setInputFiles({ name: 'synthetic-verification.pdf', mimeType: 'application/pdf', buffer: pdf });
  const permission = await grantResponse;
  assert.equal(permission.status(), 201, 'Upload grant failed');
  grant = await permission.json();
  sessionId = permission.request().postDataJSON().sessionId;
  deviceId = permission.request().headers()['x-cw-device-id'];
  assert.equal(new URL(grant.uploadUrl).protocol, 'https:');
  assert.equal((await uploadResponse).status(), 200, 'Real browser upload failed');
  const answerResponse = page.waitForResponse(r => r.url().includes('/answer/stream') && r.request().method() === 'POST', { timeout: 180000 });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const answer = await answerResponse;
  const stream = await answer.text();
  assert.ok(stream.includes(label), 'AI did not read the PDF label');
  await page.getByText(label, { exact: false }).first().waitFor({ timeout: 30000 });
  const stored = await fetch(`${storageBase}/storage/v1/object/authenticated/${process.env.AGENT_ATTACHMENT_BUCKET || 'chat-agent-private'}/attachments/${grant.attachmentId}/content?cacheNonce=${randomUUID()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
  });
  const result = await stored.json().catch(() => ({}));
  assert.ok(stored.status === 404 || stored.status === 400 && String(result.statusCode) === '404', 'Original PDF was not deleted');
  await page.screenshot({ path: '/private/tmp/chat-upload-live.png' });
  console.log('PASS real Chrome PDF selection, HTTPS upload, AI answer, rendered response, and private Storage deletion');
} finally {
  try {
    if (grant?.attachmentId && sessionId && deviceId) {
      const cleanup = await fetch(`${base}/api/rag/attachments/${grant.attachmentId}?sessionId=${sessionId}`, { method: 'DELETE', headers: { 'X-CW-Device-Id': deviceId }, signal: AbortSignal.timeout(30000) });
      if (cleanup.status !== 204) console.error(`Cleanup requires investigation: HTTP ${cleanup.status}`);
    }
  } finally {
    await browser.close();
  }
}
