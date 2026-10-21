import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

if (!process.argv.includes('--approved-single-call')) throw new Error('Requires explicit approval for one paid test. No automatic retry.');
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const privateEnv = require('dotenv').parse(await readFile(new URL('../.env.local', import.meta.url)));
const key = privateEnv.GEMINI_API_KEY;
assert.ok(key, 'Existing approved Google key missing');
const wav = await readFile('/tmp/mr-pot-voice-input.wav');
assert.ok(wav.length > 48000, 'Synthetic speech file is empty or too short');
if (process.env.VOICE_APPROVAL_MARKER) {
  const marker = await open(process.env.VOICE_APPROVAL_MARKER, 'wx', 0o600);
  await marker.close();
}
const origin = 'http://127.0.0.1:3120';
const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./fixtures/voice-live-guard.mjs', import.meta.url)), 'scripts/dev-voice.mjs'], {
  cwd: root, env: { ...process.env, VOICE_PREVIEW_PORT: '3120', GEMINI_LIVE_API_KEY: key, GEMINI_LIVE_BILLING_ACK: 'true',
    GEMINI_LIVE_MAX_SECONDS: '60', GEMINI_LIVE_MAX_CALLS: '1', GEMINI_LIVE_MAX_OUTPUT_TOKENS: '256' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', data => { log = (log + data).slice(-10000); });
child.stderr.on('data', data => { log = (log + data).slice(-10000); });
let browser, page, cutoff, peer, client;
let inputSeconds = 0, outputSeconds = 0, textBytes = 0, usageUpper = 0, toolCalls = 0, tokenCalls = 0;
let connectedAt = 0, firstAudioAt = 0, finished = false, providerError = '', audioEnded = false, inputCaption = '', outputCaption = '';
const errors = [];
const stop = () => { try { peer?.close(); client?.close(); } catch {} };
const estimatedUpper = () => textBytes * 0.75 / 1e6 + inputSeconds * .005 / 60 + outputSeconds * .018 / 60 + .02;

try {
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null) throw new Error('Local paid-test server exited');
    try { if ((await fetch(`${origin}/api/voice/session`)).ok) break; } catch {}
    await delay(150);
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/__voice-e2e.wav') return route.fulfill({ contentType: 'audio/wav', body: wav });
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/voice/')) return route.fulfill({ json: {} });
    if (url.pathname === '/api/voice/session' && route.request().method() === 'POST') {
      if (++tokenCalls > 1) return route.abort();
      cutoff = setTimeout(stop, 55000);
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.__voiceTest = { contexts: [], streams: [], maxLevel: 0 };
    window.AudioContext = class extends Context {
      constructor(...args) { super(...args); window.__voiceTest.contexts.push(this); }
    };
    // Synthetic speech only: never request or read the user's microphone.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new window.AudioContext();
      await context.resume();
      const speech = await context.decodeAudioData(await (await fetch('/__voice-e2e.wav')).arrayBuffer());
      const padded = context.createBuffer(1, context.sampleRate * 55, context.sampleRate);
      padded.getChannelData(0).set(speech.getChannelData(0).subarray(0, context.sampleRate * 8), context.sampleRate * 3);
      const source = context.createBufferSource();
      source.buffer = padded;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      const stream = destination.stream;
      window.__voiceTest.streams.push(stream);
      const track = stream.getAudioTracks()[0];
      const stopTrack = track.stop.bind(track);
      track.stop = () => { stopTrack(); source.stop(); source.disconnect(); destination.disconnect(); context.close(); };
      return stream;
    };
    const observer = new MutationObserver(() => {
      for (const element of document.querySelectorAll('[style*="--voice-level"]')) {
        window.__voiceTest.maxLevel = Math.max(window.__voiceTest.maxLevel, Number(element.style.getPropertyValue('--voice-level')) || 0);
      }
    });
    document.addEventListener('DOMContentLoaded', () => observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['style'] }), { once: true });
  });
  await page.routeWebSocket('wss://generativelanguage.googleapis.com/**', ws => {
    client = ws;
    const remote = ws.connectToServer();
    peer = remote;
    ws.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.realtimeInput?.audio) {
        if (inputSeconds >= 12) {
          if (!audioEnded) { remote.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); audioEnded = true; }
          return;
        }
        inputSeconds += Buffer.from(message.realtimeInput.audio.data, 'base64').length / 32000;
      } else {
        textBytes += Buffer.byteLength(String(raw));
        if (textBytes > 16000) { providerError = 'Test text budget exceeded'; stop(); return; }
      }
      remote.send(raw);
    });
    remote.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.setupComplete) connectedAt = Date.now();
      if (message.error) providerError = String(message.error.message || 'Provider error').replaceAll(key, '[redacted]').slice(0, 500);
      if (message.usageMetadata) usageUpper += Number(message.usageMetadata.totalTokenCount || 0) * 12 / 1e6;
      toolCalls += message.toolCall?.functionCalls?.length || 0;
      const content = message.serverContent;
      inputCaption += content?.inputTranscription?.text || '';
      outputCaption += content?.outputTranscription?.text || '';
      for (const part of content?.modelTurn?.parts || []) {
        if (part.inlineData?.data) {
          firstAudioAt ||= Date.now();
          outputSeconds += Buffer.from(part.inlineData.data, 'base64').length / 48000;
        }
      }
      if (usageUpper >= .08 || estimatedUpper() >= .08 || toolCalls > 2 || outputSeconds > 15) {
        providerError = 'Conservative paid-test budget cutoff'; stop(); return;
      }
      if (content?.turnComplete && outputSeconds > 0) finished = true;
      ws.send(raw);
    });
    remote.onClose((code, reason) => { if (!finished) providerError ||= `Provider closed ${code}: ${String(reason).replaceAll(key, '[redacted]').slice(0, 200)}`; ws.close({ code, reason }); });
    ws.onClose(() => remote.close());
  });
  await page.goto(`${origin}/admin/mr-pot-voice`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('__chat_widget_root'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cw:chat:open')));
  await page.getByRole('button', { name: 'Open live voice', exact: true }).click();
  await page.getByRole('button', { name: 'Start voice call', exact: true }).click();
  const start = Date.now();
  while (!finished && !providerError && Date.now() - start < 45000) {
    const status = await page.locator('[aria-label="Live voice call"]').getAttribute('data-status');
    if (status === 'error') throw new Error(await page.locator('[aria-label="Live voice call"]').getByRole('alert').innerText());
    await delay(150);
  }
  assert.equal(providerError, '');
  assert.ok(finished, 'No complete real voice response within test deadline');
  assert.ok(inputCaption.trim(), 'Google did not transcribe synthetic speech');
  assert.ok(outputCaption.trim(), 'Google did not return spoken-response captions');
  if (process.env.VOICE_VERIFY_EDUCATION === 'true') {
    assert.match(outputCaption, /Syracuse/i, 'Real voice response must include the verified masters institution');
    assert.match(outputCaption, /Liverpool/i, 'Real voice response must include the verified bachelors institution');
  }
  assert.ok(outputSeconds > .1, 'No real PCM audio received');
  await page.waitForFunction(() => window.__voiceTest.maxLevel > 0, null, { timeout: 5000 });
  await page.screenshot({ path: '/tmp/mr-pot-voice-live.png' });
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  clearTimeout(cutoff);
  await page.waitForFunction(() => window.__voiceTest.contexts.every(c => c.state === 'closed') && window.__voiceTest.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  const second = await fetch(`${origin}/api/voice/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ page: { path: '/', text: 'public' } }) });
  assert.equal(second.status, 429, 'Further calls must remain blocked');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, provider: 'Google', model: 'gemini-3.8-live', tokenCalls, inputSeconds, outputSeconds,
    firstAudioAfterConnectionMs: firstAudioAt - connectedAt, inputCaption, outputCaption, conservativeEstimatedUSD: Math.max(usageUpper, estimatedUpper()),
    billedAmount: 'Not yet available; estimate is not an invoice', screenshot: '/tmp/mr-pot-voice-live.png' }));
} catch (error) {
  console.error(log.replaceAll(key, '[redacted]'));
  console.error(JSON.stringify({ passed: false, error: String(error.message).replaceAll(key, '[redacted]'), tokenCalls, inputSeconds, outputSeconds, inputCaption, outputCaption, providerError, errors }));
  process.exitCode = 1;
} finally {
  clearTimeout(cutoff);
  stop();
  await browser?.close();
  child.kill('SIGTERM');
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
}
