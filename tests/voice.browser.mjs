import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import sharp from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs';

const port = Number(process.env.VOICE_E2E_PORT || 3119);
const origin = `http://127.0.0.1:${port}`;
const processEnv = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only-public-key', VOICE_PREVIEW_PORT: String(port), GEMINI_LIVE_API_KEY: 'e2e-not-a-real-key', GEMINI_LIVE_BILLING_ACK: 'true' };
const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./fixtures/voice-provider.mjs', import.meta.url)), 'scripts/dev-voice.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), env: processEnv, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', data => { log = (log + data).slice(-10000); });
child.stderr.on('data', data => { log = (log + data).slice(-10000); });
let browser;
const errors = [];
const sockets = [];
const pages = [];
const outbound = [];
let tokenCalls = 0;
let pcmFrames = 0;

async function until(check, label, attempts = 100) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await delay(150); }
  throw new Error(`Timed out: ${label}`);
}

async function preparePage(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, permissions: ['microphone'] });
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => {
    if (response.url().includes('/api/voice/') || response.url().includes('/voice/pcm-')) console.log('Voice resource', response.status(), new URL(response.url()).pathname);
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/voice/')) return route.fulfill({ json: {} });
    if (url.pathname === '/api/voice/session' && route.request().method() === 'POST') tokenCalls++;
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__voiceTest = { streams: [], contexts: [], focus: [] };
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
      focus.apply(this, args);
      window.__voiceTest.focus.push({ requested: this.getAttribute('aria-label'), connected: this.isConnected, visibility: getComputedStyle(this).visibility, active: document.activeElement?.getAttribute('aria-label'), inert: Boolean(this.closest('[inert]')) });
    };
    const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(...args) { super(...args); window.__voiceTest.contexts.push(this); } };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await capture(constraints);
      window.__voiceTest.streams.push(stream);
      return stream;
    };
  });
  await page.routeWebSocket('wss://generativelanguage.googleapis.com/**', ws => {
    sockets.push(ws);
    ws.onMessage(raw => {
      const message = JSON.parse(raw);
      outbound.push(message);
      if (message.setup) ws.send(JSON.stringify({ setupComplete: {} }));
      if (message.realtimeInput?.audio) pcmFrames++;
    });
  });
  await page.goto(`${origin}/admin/mr-pot-voice`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('__chat_widget_root'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cw:chat:open')));
  await page.getByRole('button', { name: 'Open live voice', exact: true }).waitFor();
  return { page, context };
}

function server(message) { sockets.at(-1).send(JSON.stringify(message)); }
function pcm(seconds = 3) {
  const samples = Buffer.alloc(24000 * 2 * seconds);
  for (let i = 0; i < samples.length / 2; i++) samples.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 240 / 24000) * 1200), i * 2);
  return samples.toString('base64');
}
async function resourcesClosed(page) {
  await page.waitForFunction(() => window.__voiceTest.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) && window.__voiceTest.contexts.every(c => c.state === 'closed'));
}

try {
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`Preview server exited: ${log}`);
    try { return (await fetch(`${origin}/api/voice/session`)).ok; } catch { return false; }
  }, 'local server', 160);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const { page, context } = await preparePage();
  assert.equal(await page.evaluate(() => window.__voiceTest.contexts.length), 0, 'no audio resources before click');
  assert.equal(tokenCalls, 0, 'no provider request before click');
  const before = await page.locator('.bot-container').boundingBox();
  const avatar = await page.locator('.cw-pot-header').boundingBox();
  assert.equal(await page.locator('.input-area [aria-label="Open live voice"]').count(), 0, 'call entry is outside composer');
  assert.equal(await page.locator('.bot-header [aria-label="Open live voice"]').count(), 1);
  assert.equal(await page.locator('[data-engine]').count(), 0, 'no 3D renderer until call opens');
  await page.getByRole('button', { name: 'Open live voice', exact: true }).click();
  assert.equal(tokenCalls, 0, 'opening consent is not a call');
  const room = page.getByRole('dialog', { name: 'Live voice call' });
  assert.equal(await room.locator('footer p').count(), 0, 'ready call has no explanatory footer');
  assert.equal(await room.getAttribute('aria-modal'), 'false');
  const bounds = await room.boundingBox();
  assert.equal(bounds.width, 380); assert.equal(bounds.height, 580);
  assert.ok(bounds.x > 800 && bounds.y > 300, 'compact bottom-right window');
  assert.equal(await page.evaluate(() => document.querySelector('#__next').inert), false, 'page remains interactive');
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  assert.equal(await page.locator('.bot-container').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'text and voice windows do not stack');
  assert.equal(await page.locator('.bot-container').evaluate(el => getComputedStyle(el).opacity), '0', 'legacy child visibility transitions cannot leak behind the call');
  assert.equal(await room.evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + 30, b.y + 30)); }), true);
  await page.locator('[data-renderer="3d"]').waitFor();
  const canvas = page.locator('[data-engine]');
  const helloFrame = Number(await canvas.getAttribute('data-frames'));
  await delay(700);
  assert.ok(Number(await canvas.getAttribute('data-frames')) > helloFrame, 'finite welcome gesture before starting');
  await delay(4900);
  const staticFrame = Number(await canvas.getAttribute('data-frames'));
  await delay(600);
  assert.equal(Number(await canvas.getAttribute('data-frames')), staticFrame, 'ready scene has no continuous render loop');
  const screenshot = await canvas.screenshot();
  const stats = await sharp(screenshot).stats();
  assert.ok(stats.channels[0].min < 80 && stats.channels[0].max > 200 && stats.channels[0].stdev > 15, '3D canvas contains model pixels');
  await page.screenshot({ path: '/tmp/mr-pot-call-ready.png' });
  await page.getByRole('button', { name: 'Start voice call', exact: true }).click();
  await page.getByRole('dialog', { name: 'Live voice call' }).getByText('Listening', { exact: true }).waitFor();
  assert.equal(await room.locator('footer p').count(), 0, 'active call has no explanatory footer');
  await until(() => pcmFrames > 1, 'real AudioWorklet microphone packets');
  assert.ok(outbound[0].setup.generationConfig.responseModalities.includes('AUDIO'));
  assert.match(outbound[0].setup.systemInstruction.parts[0].text, /Syracuse University/);
  server({ toolCall: { functionCalls: [{ id: 'profile-1', name: 'get_profile', args: {} }] } });
  await until(() => outbound.some(m => m.toolResponse?.functionResponses?.[0]?.id === 'profile-1'), 'education tool response');
  assert.match(JSON.stringify(outbound.find(m => m.toolResponse?.functionResponses?.[0]?.id === 'profile-1')), /University of Liverpool/);
  server({ serverContent: { inputTranscription: { text: '请介绍一下这个页面。' }, outputTranscription: { text: '这里是 Yuqi 的作品集，你可以查看项目和文章。' }, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm() } }] } } });
  await page.getByRole('dialog', { name: 'Live voice call' }).getByText('Speaking', { exact: true }).waitFor();
  await page.getByRole('dialog', { name: 'Live voice call' }).getByText(/这里是 Yuqi/).waitFor();
  const after = await page.locator('.bot-container').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  const afterAvatar = await page.locator('.cw-pot-header').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  assert.equal(after.width, before.width); assert.equal(after.height, before.height);
  assert.equal(afterAvatar.width, avatar.width); assert.equal(afterAvatar.height, avatar.height);
  await page.screenshot({ path: '/tmp/mr-pot-voice-desktop.png' });
  const moving = Number(await canvas.getAttribute('data-frames'));
  await delay(400);
  const advanced = Number(await canvas.getAttribute('data-frames')) - moving;
  assert.ok(advanced > 0 && advanced <= 13, 'live scene moves at a bounded frame rate');
  assert.ok(!(await canvas.screenshot()).equals(screenshot), 'rendered pose differs during call');
  await page.getByRole('button', { name: 'Minimize call', exact: true }).click();
  assert.equal((await room.boundingBox()).height, 68);
  const paused = Number(await canvas.getAttribute('data-frames'));
  const packets = pcmFrames;
  await delay(500);
  assert.equal(Number(await canvas.getAttribute('data-frames')), paused, 'collapsed scene does not render');
  assert.ok(pcmFrames > packets, 'minimizing does not hang up');
  await page.getByRole('button', { name: 'Expand call', exact: true }).click();
  await page.getByRole('button', { name: 'Show transcript', exact: true }).click();
  await page.getByRole('log', { name: 'Voice captions' }).getByText(/这里是 Yuqi/).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: 'Live voice call' }).count(), 1, 'Escape collapses transcript without ending call');
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__voiceTest.streams.at(-1).getAudioTracks()[0].enabled), false);
  await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
  server({ toolCall: { functionCalls: [{ id: 'navigation-1', name: 'navigate_section', args: { target: 'projects' } }] } });
  await page.getByRole('dialog', { name: 'Live voice call' }).getByRole('button', { name: 'Projects' }).waitFor();
  assert.ok(page.url().includes('/admin/mr-pot-voice'), 'tool cannot auto-navigate');
  server({ serverContent: { interrupted: true } });
  await page.getByRole('dialog', { name: 'Live voice call' }).getByText('Listening', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Live voice call' }).getByRole('button', { name: 'Projects' }).count(), 0);
  server({ toolCall: { functionCalls: [{ id: 'read-1', name: 'read_page', args: {} }] } });
  await until(() => outbound.some(m => m.toolResponse?.functionResponses?.[0]?.id === 'read-1'), 'page evidence');
  const evidence = outbound.find(m => m.toolResponse?.functionResponses?.[0]?.id === 'read-1').toolResponse.functionResponses[0].response;
  assert.match(evidence.text, /Yuqi Guo/); assert.equal(evidence.text.includes('这里是 Yuqi'), false, 'chat is not shared as page evidence');
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = '<span>Public start</span><span data-private>PRIVATE_SENTINEL</span><span>Public end</span>';
    document.querySelector('main').appendChild(host);
    const range = document.createRange();
    range.setStart(host.firstChild.firstChild, 0);
    range.setEnd(host.lastChild.firstChild, 10);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  server({ toolCall: { functionCalls: [{ id: 'read-selection', name: 'read_page', args: {} }] } });
  await until(() => outbound.some(m => m.toolResponse?.functionResponses?.[0]?.id === 'read-selection'), 'selection privacy');
  const selectionEvidence = outbound.find(m => m.toolResponse?.functionResponses?.[0]?.id === 'read-selection').toolResponse.functionResponses[0].response;
  assert.equal(selectionEvidence.selection, ''); assert.equal(selectionEvidence.text.includes('PRIVATE_SENTINEL'), false);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await resourcesClosed(page);
  console.log('Desktop call verified', { tokenCalls, pcmFrames });
  await page.getByRole('button', { name: 'Show transcript', exact: true }).click();
  await page.getByRole('log').getByText(/这里是 Yuqi/).waitFor();
  await page.getByRole('button', { name: 'Collapse transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Close voice', exact: true }).click();
  await page.getByRole('button', { name: 'Open live voice', exact: true }).waitFor();
  assert.equal(await page.locator('[data-engine]').count(), 0, 'closing removes renderer');
  assert.equal(await page.evaluate(() => document.querySelector('#__next').inert), false);
  console.log('Close focus', await page.evaluate(() => ({ active: document.activeElement?.getAttribute('aria-label'), visible: getComputedStyle(document.querySelector('.bot-container')).visibility, inert: document.querySelector('.bot-container').inert })));
  await until(() => page.getByRole('button', { name: 'Open live voice', exact: true }).evaluate(el => el === document.activeElement), 'focus returns to call entry', 10);
  await context.close();

  const mobile = await preparePage({ width: 390, height: 844 });
  await mobile.page.getByRole('button', { name: 'Open live voice', exact: true }).click();
  await mobile.page.getByRole('button', { name: 'Start voice call', exact: true }).click();
  await mobile.page.getByRole('dialog', { name: 'Live voice call' }).getByText('Listening', { exact: true }).waitFor();
  server({ serverContent: { inputTranscription: { text: 'Tell me about the projects.' }, outputTranscription: { text: 'We can open Projects and review the public case studies together.' }, turnComplete: true } });
  await mobile.page.getByRole('dialog', { name: 'Live voice call' }).getByText(/public case studies/).waitFor();
  assert.ok(await mobile.page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await mobile.page.locator('[data-renderer="3d"]').waitFor();
  const mobileStats = await sharp(await mobile.page.locator('[data-engine]').screenshot()).stats();
  assert.ok(mobileStats.channels[0].min < 80 && mobileStats.channels[0].stdev > 15);
  await mobile.page.screenshot({ path: '/tmp/mr-pot-voice-mobile.png' });
  await mobile.page.evaluate(() => document.documentElement.classList.add('dark'));
  await mobile.page.screenshot({ path: '/tmp/mr-pot-voice-mobile-dark.png' });
  await mobile.page.setViewportSize({ width: 320, height: 700 });
  await until(async () => {
    const bounds = await mobile.page.getByRole('dialog').boundingBox();
    return bounds && bounds.y >= 0 && bounds.y + bounds.height <= 700;
  }, 'small-screen widget inside viewport');
  assert.ok(await mobile.page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await mobile.page.screenshot({ path: '/tmp/mr-pot-voice-small.png' });
  assert.ok(await mobile.page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
  await mobile.page.emulateMedia({ reducedMotion: 'reduce' });
  await mobile.page.locator('[data-renderer="image"]').waitFor();
  assert.equal(await mobile.page.locator('[aria-label="Full-body Mr. Pot"] img').evaluate(el => el.complete && el.naturalWidth > 0), true);
  sockets.at(-1).close();
  await mobile.page.getByRole('alert').getByText(/connection ended/).waitFor();
  await resourcesClosed(mobile.page);
  await mobile.context.close();

  const denied = await preparePage();
  await denied.page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await denied.page.getByRole('button', { name: 'Open live voice', exact: true }).click();
  await denied.page.getByRole('button', { name: 'Start voice call', exact: true }).click();
  await denied.page.getByRole('alert').getByText(/permission was denied/).waitFor();
  await resourcesClosed(denied.page);
  await denied.context.close();
  const limited = await fetch(`${origin}/api/voice/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ page: { path: '/', text: 'public' } }) });
  assert.equal(limited.status, 429);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, tokenCalls, pcmFrames, checks: ['header entry', 'non-modal 380x580 floating call', 'lazy audio and 3D', 'finite welcome gesture', 'ready scene renders on demand', 'bounded live animation', 'minimize pauses rendering but preserves audio', 'nonblank desktop/mobile canvas pixels', 'public education in setup and tool response', 'real local token API with fake Google', 'AudioWorklet capture', 'PCM playback', 'Chinese and English captions', 'barge-in', 'mute', 'safe navigation offer', 'page evidence', 'private selection filtering', 'hangup cleanup and transcript', 'keyboard focus restoration', 'mobile 390px and 320px', 'reduced motion image fallback', 'disconnect cleanup', 'permission denial', 'quota'], screenshots: ['/tmp/mr-pot-call-ready.png', '/tmp/mr-pot-voice-desktop.png', '/tmp/mr-pot-voice-mobile.png', '/tmp/mr-pot-voice-mobile-dark.png', '/tmp/mr-pot-voice-small.png'] }));
} catch (error) {
  console.error('Browser errors:', errors);
  for (const page of pages.filter(p => !p.isClosed())) {
    console.error('Voice state:', await page.locator('[aria-label="Live voice call"]').allTextContents());
    console.error('Focus:', await page.evaluate(() => ({ calls: window.__voiceTest.focus, active: document.activeElement?.outerHTML?.slice(0, 500), trigger: document.querySelector('[aria-label="Open live voice"]')?.outerHTML?.slice(0, 500) })));
    await page.screenshot({ path: '/tmp/mr-pot-call-failure.png' });
  }
  console.error(log);
  throw error;
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
}
