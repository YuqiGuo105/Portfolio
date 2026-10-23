import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

if (!process.argv.includes('--approved-single-call')) throw new Error('One paid verification call requires explicit approval. No automatic retry.');
const origin = 'https://www.yuqi.site';
const wav = await readFile(process.env.VOICE_TEST_WAV || '/tmp/mr-pot-production-input.wav');
assert.ok(wav.length > 48000, 'Synthetic speech must be nonempty before reserving a call');
const marker = await open(process.env.VOICE_APPROVAL_MARKER || '/tmp/mr-pot-production-20261021-attempt', 'wx', 0o600);
await marker.close();
let browser, page, peer, socket, cutoff, attempts = 0, outputSeconds = 0, inputSeconds = 0;
let userText = '', answer = '', greeting = '', greetingEnded = false, answerComplete = false, complete = false, reason = '', setup = false, conversationId = '';
const close = () => { try { socket?.close(); peer?.close(); } catch {} };
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/__voice-verification.wav') return route.fulfill({ contentType: 'audio/wav', body: wav });
    if (url.origin === origin && ['/api/track', '/api/click'].includes(url.pathname)) return route.fulfill({ json: { skipped: true } });
    if (url.origin === origin && url.pathname === '/api/voice/session' && route.request().method() === 'POST') {
      if (++attempts > 1) return route.abort();
      cutoff = setTimeout(close, 55000);
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.__voiceProof = { contexts: [], streams: [], maxLevel: 0 };
    window.AudioContext = class extends Context { constructor(...args) { super(...args); window.__voiceProof.contexts.push(this); } };
    // Generate a test stream, never request or record the owner's microphone.
    navigator.mediaDevices.getUserMedia = async () => {
      const c = new window.AudioContext(); await c.resume();
      const audio = await c.decodeAudioData(await (await fetch('/__voice-verification.wav')).arrayBuffer());
      const padded = c.createBuffer(1, c.sampleRate * 55, c.sampleRate);
      padded.getChannelData(0).set(audio.getChannelData(0).subarray(0, c.sampleRate * 12), c.sampleRate * 7);
      const src = c.createBufferSource(); src.buffer = padded;
      const dest = c.createMediaStreamDestination(); src.connect(dest); src.start();
      const track = dest.stream.getAudioTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { stop(); src.stop(); src.disconnect(); dest.disconnect(); c.close(); };
      window.__voiceProof.streams.push(dest.stream); return dest.stream;
    };
    document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
      for (const el of document.querySelectorAll('[style*="--voice-level"]')) window.__voiceProof.maxLevel = Math.max(window.__voiceProof.maxLevel, Number(el.style.getPropertyValue('--voice-level')) || 0);
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['style'] }), { once: true });
  });
  await page.routeWebSocket('wss://portfolio-voice-relay-*/voice', ws => {
    socket = ws; peer = ws.connectToServer();
    ws.onMessage(raw => {
      const m = JSON.parse(String(raw));
      assert.ok(!m.setup && !m.toolResponse, 'Browser must not configure provider or forge tool results');
      if (m.realtimeInput?.audio) inputSeconds += Buffer.from(m.realtimeInput.audio.data, 'base64').length / 32000;
      peer.send(raw);
    });
    peer.onMessage(raw => {
      const m = JSON.parse(String(raw));
      if (m.setupComplete) setup = true;
      if (m.type === 'relay.closed') { reason = m.reason; conversationId = m.conversationId || ''; }
      const c = m.serverContent;
      userText += c?.inputTranscription?.text || '';
      answer += c?.outputTranscription?.text || '';
      if (!greetingEnded) greeting += c?.outputTranscription?.text || '';
      for (const p of c?.modelTurn?.parts || []) if (p.inlineData?.data) outputSeconds += Buffer.from(p.inlineData.data, 'base64').length / 48000;
      if (c?.turnComplete) {
        if (greetingEnded) answerComplete = true;
        greetingEnded = true;
      }
      if (c?.interrupted) greetingEnded = true;
      complete = answerComplete && outputSeconds > 0 && Boolean(userText.trim());
      ws.send(raw);
      if (outputSeconds > 25) close();
    });
    ws.onClose(() => peer.close());
    peer.onClose((code, why) => ws.close({ code, reason: why }));
  });
  await page.goto(`${origin}/?openChat=1&subscriptionPreview=0`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open live voice', exact: true }).click();
  for (let i = 0; i < 240 && !complete && !reason; i++) {
    if (await page.getByRole('dialog', { name: 'Live voice call' }).getAttribute('data-status') === 'error') break;
    await delay(200);
  }
  assert.ok(setup, 'Relay/provider session must become ready');
  assert.ok(complete, 'A real spoken response must complete');
  assert.match(greeting, /Mr\.?\s*Pot/i, 'Mr. Pot greets before the visitor speaks');
  assert.ok(userText.trim()); assert.ok(answer.trim()); assert.ok(outputSeconds > 0);
  await page.waitForFunction(() => window.__voiceProof.maxLevel > 0);
  await page.screenshot({ path: '/tmp/mr-pot-production-voice.png' });
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await page.waitForFunction(() => window.__voiceProof.contexts.every(c => c.state === 'closed') && window.__voiceProof.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  for (let i = 0; i < 65 && !reason; i++) await delay(100);
  assert.equal(reason, 'client_hangup', 'Relay acknowledges hangup after its final history write');
  assert.match(conversationId, /^[a-f0-9-]{36}$/);
  assert.match(answer, /Syracuse/i);
  assert.match(answer, /Liverpool/i);
  console.log(JSON.stringify({ passed: true, attempts, setup, greeting, inputSeconds, outputSeconds, userText, answer, conversationId, reason, educationGrounded: true, screenshot: '/tmp/mr-pot-production-voice.png' }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: error.message, attempts, setup, reason, inputSeconds, outputSeconds, userText, answer, ui: await page?.getByRole('dialog', { name: 'Live voice call' }).textContent().catch(() => '') }));
  process.exitCode = 1;
} finally { clearTimeout(cutoff); close(); await browser?.close(); }
