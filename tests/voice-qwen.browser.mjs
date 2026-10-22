import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import sharp from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs';

const port = Number(process.env.VOICE_E2E_PORT || 3121);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['tests/fixtures/qwen-voice-server.mjs'], { env: { ...process.env, VOICE_E2E_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', browser;
child.stdout.on('data', data => { log = (log + data).slice(-6000); });
child.stderr.on('data', data => { log = (log + data).slice(-6000); });
async function until(check, label) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
const metrics = async () => (await fetch(`${origin}/__test/status`)).json();
try {
  await until(async () => { if (child.exitCode !== null) throw new Error(log); try { return (await fetch(`${origin}/api/voice/qwen/session`)).ok; } catch { return false; } }, 'server');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, permissions: ['microphone'] });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/voice/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__voice = { streams: [], contexts: [] };
    const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(...args) { super(...args); window.__voice.contexts.push(this); } };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async opts => { const stream = await getMedia(opts); window.__voice.streams.push(stream); return stream; };
  });
  await page.goto(`${origin}/admin/mr-pot-voice`);
  await page.waitForFunction(() => document.getElementById('__chat_widget_root'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cw:chat:open')));
  await page.getByRole('button', { name: 'Open live voice', exact: true }).click();
  const room = page.getByRole('dialog', { name: 'Live voice call' });
  await page.getByRole('combobox', { name: 'Voice provider' }).selectOption('qwen');
  assert.equal((await room.boundingBox()).width, 380); assert.equal((await room.boundingBox()).height, 580);
  assert.equal(await room.getByRole('button', { name: 'Start voice call' }).count(), 0);
  await room.getByText('Speaking', { exact: true }).waitFor();
  await room.getByText(/master degree at Syracuse/).waitFor();
  await room.getByRole('button', { name: 'My Background' }).waitFor();
  assert.equal(page.url().includes('#tour-background'), false, 'navigation needs user click');
  const data = await metrics();
  assert.ok(data.pcm > 0 && data.grounded);
  assert.match(data.tools[0].output, /Syracuse/);
  await page.locator('[data-engine]').waitFor();
  const canvas = page.locator('[data-engine]');
  const first = await canvas.screenshot();
  const stats = await sharp(first).stats(); assert.ok(stats.channels[0].stdev > 15);
  await delay(250); assert.ok(!(await canvas.screenshot()).equals(first), 'speaking model moves');
  await page.screenshot({ path: '/tmp/mr-pot-qwen-e2e.png' });
  await fetch(`${origin}/__test/interrupt`, { method: 'POST' });
  await room.getByText('Interrupted', { exact: true }).waitFor();
  assert.equal(await room.getByRole('button', { name: 'My Background' }).count(), 0);
  assert.equal((await room.innerText()).includes('MUST NOT APPEAR'), false);
  await page.getByRole('button', { name: 'Mute microphone' }).click();
  const before = (await metrics()).pcm; await delay(350); assert.ok((await metrics()).pcm <= before + 1);
  await page.getByRole('button', { name: 'End call' }).click();
  await page.waitForFunction(() => window.__voice.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) && window.__voice.contexts.every(c => c.state === 'closed'));
  await until(async () => (await metrics()).terminated === 1, 'upstream closed');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'Call Mr. Pot again' }).click();
  await room.getByText('Listening', { exact: true }).waitFor();
  const bounds = await room.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320 && bounds.y >= 0);
  await page.screenshot({ path: '/tmp/mr-pot-qwen-mobile.png' });
  await page.getByRole('button', { name: 'End call' }).click();
  await page.getByRole('button', { name: 'Close voice' }).click();
  await page.getByRole('button', { name: 'Open live voice', exact: true }).click();
  await page.getByRole('combobox', { name: 'Voice provider' }).selectOption('qwen');
  await room.getByText('Qwen local trial has ended.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Call Mr. Pot again' }).isEnabled(), false);
  assert.equal((await metrics()).connections, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: Qwen browser -> local relay -> fake provider; PCM, profile, tools, playback, interruption, mute, cleanup, mobile and quota. No real API calls.');
} catch (error) { console.error(log); throw error; }
finally {
  await browser?.close(); child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
