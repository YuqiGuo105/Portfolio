import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

if (!process.argv.includes('--approved-followup-call') || !/^[a-z0-9-]{8,80}$/.test(process.env.QWEN_APPROVED_SINGLE_TEST || '')) throw new Error('Explicit single-test approval ID required; no automatic retries');
const wav = await readFile('/tmp/qwen-education.wav');
assert.ok(wav.length > 32000);
const origin = `http://127.0.0.1:${process.env.VOICE_E2E_PORT || 3123}`;
const env = { ...process.env, NODE_OPTIONS: '' };
const child = spawn(process.execPath, [`--env-file=${process.env.QWEN_LOCAL_ENV_FILE || '.env.voice-qwen.local'}`, 'tests/fixtures/qwen-live-server.mjs'], { env, stdio: ['ignore', 'ignore', 'ignore'] });
let browser, cutoff, result = {}, attempts = 0;
const errors = [];
const metrics = async () => (await fetch(`${origin}/__qwen-live-status`)).json();
async function until(check, label, seconds = 30) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) { if (await check()) return; await delay(200); }
  throw new Error(`Timed out: ${label}`);
}
try {
  await until(async () => {
    if (child.exitCode !== null) throw new Error('Isolated test server exited');
    try { return (await fetch(`${origin}/__qwen-live-status`)).ok; } catch { return false; }
  }, 'local test server');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/__synthetic-education.wav') return route.fulfill({ contentType: 'audio/wav', body: wav });
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/voice/')) return route.fulfill({ json: {} });
    if (url.pathname === '/api/voice/qwen/session' && route.request().method() === 'POST') {
      if (++attempts > 1) return route.abort();
      cutoff = setTimeout(() => child.kill('SIGTERM'), 60000);
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    const Audio = window.AudioContext;
    window.__qwenLive = { contexts: [], streams: [], maxLevel: 0 };
    window.AudioContext = class extends Audio { constructor(...args) { super(...args); window.__qwenLive.contexts.push(this); } };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new window.AudioContext(); await context.resume();
      const speech = await context.decodeAudioData(await (await fetch('/__synthetic-education.wav')).arrayBuffer());
      const source = context.createBufferSource(); source.buffer = speech;
      const destination = context.createMediaStreamDestination(); source.connect(destination);
      let started = false;
      window.__qwenLive.speak = () => { started = true; source.start(context.currentTime + 0.5); };
      const stream = destination.stream; window.__qwenLive.streams.push(stream);
      const track = stream.getAudioTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { stop(); if (started) source.stop(); source.disconnect(); destination.disconnect(); context.close(); };
      return stream;
    };
    const observer = new MutationObserver(() => {
      for (const element of document.querySelectorAll('[style*="--voice-level"]')) window.__qwenLive.maxLevel = Math.max(window.__qwenLive.maxLevel, Number(element.style.getPropertyValue('--voice-level')) || 0);
    });
    document.addEventListener('DOMContentLoaded', () => observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['style'] }), { once: true });
  });
  await page.goto(`${origin}/admin/mr-pot-voice`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('__chat_widget_root'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cw:chat:open')));
  await page.getByRole('button', { name: 'Open live voice', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Voice provider' }).count(), 0);
  await until(async () => {
    result = await metrics();
    if (result.providerCode || result.closed) throw new Error(`Qwen setup failed: ${result.providerCode || result.closeCode}`);
    return result.ready;
  }, 'session ready', 25);
  await page.evaluate(() => window.__qwenLive.speak());
  await until(async () => {
    result = await metrics();
    if (result.providerCode) throw new Error(`Qwen rejected test: ${result.providerCode}`);
    if (result.closed && !result.complete) throw new Error('Provider closed before a complete answer');
    return result.complete;
  }, 'real voice answer', 45);
  assert.ok(result.ready && result.outputSeconds > 0.1);
  assert.match(result.inputCaption, /universit|attend/i);
  assert.match(result.outputCaption, /Syracuse|雪城/i);
  assert.match(result.outputCaption, /Liverpool|利物浦/i);
  await page.waitForFunction(() => window.__qwenLive.maxLevel > 0);
  const room = page.getByRole('dialog', { name: 'Live voice call' });
  await room.getByText('Listening', { exact: true }).waitFor({ timeout: 20000 });
  await page.screenshot({ path: '/tmp/mr-pot-qwen-real-call.png' });
  await room.getByRole('button', { name: 'End call' }).click();
  await page.waitForFunction(() => window.__qwenLive.contexts.every(c => c.state === 'closed') && window.__qwenLive.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  await until(async () => (await metrics()).closed, 'upstream cleanup', 5);
  result = await metrics();
  assert.equal((await (await fetch(`${origin}/api/voice/qwen/session`)).json()).remainingCalls, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...result, attempts, input: 'Synthetic speech only', screenshot: '/tmp/mr-pot-qwen-real-call.png' }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: error.message, attempts, ...result, errors })); process.exitCode = 1;
} finally {
  clearTimeout(cutoff); await browser?.close(); child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); }), delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
