import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import sharp from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs';

const origin = process.env.VOICE_MOTION_ORIGIN || 'http://127.0.0.1:3122';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await context.newPage();
const errors = [], voiceRequests = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/voice')) voiceRequests.push(url.pathname);
  if (url.origin !== origin) return route.abort();
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
  return route.continue();
});
await page.addInitScript(() => {
  window.__motionMicAttempts = 0;
  navigator.mediaDevices.getUserMedia = () => { window.__motionMicAttempts++; throw new Error('Motion preview must not capture audio'); };
});
const canvas = page.locator('[data-engine]');
const frames = async () => Number(await canvas.getAttribute('data-frames'));
async function pixels() {
  const image = await canvas.screenshot();
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0, left = info.width, right = 0, top = info.height, bottom = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const p = (y * info.width + x) * 4;
    if (data[p] < 100 && data[p + 1] < 110 && data[p + 2] < 110 && data[p + 3] > 200) {
      count++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  assert.ok(count > 400, 'character has visible model pixels');
  assert.ok(right - left > info.width * 0.32, 'character is large enough in the stage');
  assert.ok(bottom - top > info.height * 0.58, 'full body fills the vertical frame');
  assert.ok(left > 2 && right < info.width - 2 && top > 2 && bottom < info.height - 2, 'character is not clipped');
  return image;
}

async function visiblePupils(image) {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height), cheeks = [];
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    mask[i] = data[p] > 225 && data[p + 1] > 95 && data[p + 1] < 190 && data[p + 2] < 185 ? 1 : 0;
  }
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const stack = [i]; mask[i] = 0;
    let count = 0, x = 0, y = 0;
    while (stack.length) {
      const p = stack.pop(), px = p % info.width, py = Math.floor(p / info.width);
      count++; x += px; y += py;
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        const n = ny * info.width + nx;
        if (nx >= 0 && nx < info.width && ny >= 0 && ny < info.height && mask[n]) { mask[n] = 0; stack.push(n); }
      }
    }
    if (count > 12) cheeks.push({ count, x: x / count, y: y / count });
  }
  const pair = cheeks.sort((a, b) => b.count - a.count).slice(0, 2).sort((a, b) => a.x - b.x);
  assert.equal(pair.length, 2, 'both reference blush patches render');
  const gap = pair[1].x - pair[0].x;
  return pair.map((cheek, i) => {
    const x = cheek.x + gap * (i ? -0.15 : 0.15), y = cheek.y - gap * 0.225;
    let dark = 0;
    for (let py = Math.floor(y - gap * 0.06); py <= y + gap * 0.06; py++) {
      for (let px = Math.floor(x - gap * 0.045); px <= x + gap * 0.045; px++) {
        const p = (py * info.width + px) * 4;
        if (data[p] < 100 && data[p + 1] < 110 && data[p + 2] < 110) dark++;
      }
    }
    assert.ok(dark > 8, `pupil ${i} has ${dark} dark core pixels, excluding its outer border`);
    return dark;
  });
}

async function gazeSweep(label) {
  await page.getByRole('combobox', { name: 'Preview state' }).selectOption('ready');
  await page.mouse.move(5, 5); await delay(5500);
  const box = await canvas.boundingBox();
  const neutral = await pixels();
  const corners = [[0.03, 0.03], [0.97, 0.97], [0.97, 0.03], [0.03, 0.97]];
  for (const [index, [x, y]] of corners.entries()) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 10 });
    await delay(3400);
    const held = await pixels();
    await visiblePupils(held);
    assert.ok(!held.equals(neutral), `${label} corner ${index}: stationary pointer still holds the gaze after three seconds`);
    const stableFrames = await frames(); await delay(300);
    assert.equal(await frames(), stableFrames, 'a held cursor does not require continuous rendering');
    await page.screenshot({ path: `/tmp/mr-pot-gaze-${label}-${index}.png` });
  }
  await page.mouse.move(5, 5); await delay(3400);
  await visiblePupils(await pixels());
}

try {
  await page.goto(`${origin}/admin/mr-pot-voice-motion`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-renderer="3d"]').waitFor();
  const study = page.getByRole('region', { name: 'Voice animation preview' });
  assert.equal((await study.boundingBox()).width, 380);
  assert.equal((await study.boundingBox()).height, 580);
  await page.mouse.move(10, 10);
  await delay(5500);
  const rest = await frames(); await delay(500);
  assert.equal(await frames(), rest, 'welcome settles with no continuous RAF');
  const baseline = await pixels();
  await page.screenshot({ path: '/tmp/mr-pot-motion-welcome.png' });
  await delay(12500);
  assert.ok(await frames() > rest, 'occasional idle glance wakes without continuous rendering');
  for (const state of ['listening', 'thinking', 'speaking', 'ended']) {
    await page.getByRole('combobox', { name: 'Preview state' }).selectOption(state);
    await delay(state === 'thinking' ? 2500 : 1000);
    const before = await frames(); await delay(500);
    const advanced = await frames() - before;
    assert.ok(advanced > 0 && advanced <= 15, `${state} respects frame budget`);
    assert.ok(!(await pixels()).equals(baseline), `${state} changes visible pose`);
    await page.screenshot({ path: `/tmp/mr-pot-motion-${state}.png` });
  }
  await page.getByRole('combobox', { name: 'Preview state' }).selectOption('ready');
  await delay(5500);
  await gazeSweep('desktop');
  const settled = await pixels();
  await page.getByRole('button', { name: 'Animate Mr. Pot' }).click();
  await page.mouse.move(10, 10); await delay(900);
  assert.ok(!(await pixels()).equals(settled), 'tap opens the lid and looks up');
  await page.screenshot({ path: '/tmp/mr-pot-motion-lid.png' });
  await page.getByRole('button', { name: 'Pause animation' }).click();
  const paused = await frames(); await delay(500);
  assert.equal(await frames(), paused, 'paused animation stops rendering');
  await page.getByRole('button', { name: 'Replay animation' }).click();
  await delay(500); assert.ok(await frames() > paused);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.getByRole('combobox', { name: 'Preview state' }).selectOption('listening');
    await delay(500); await pixels();
    assert.ok(await study.evaluate(element => element.scrollWidth <= element.clientWidth));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `/tmp/mr-pot-motion-mobile-${width}.png` });
  }
  await gazeSweep('mobile');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-renderer="image"]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Animate Mr. Pot' }).count(), 0);
  assert.equal(await page.locator('[aria-label="Full-body Mr. Pot"] img').evaluate(element => element.complete && element.naturalWidth > 0), true);
  assert.equal(await page.evaluate(() => window.__motionMicAttempts), 0);
  assert.deepEqual(voiceRequests, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['five poses', 'bounded rendering', 'idle sleep and wake', 'lid interaction', 'pause and replay', 'large nonblank unclipped model', 'desktop and 390/320px layouts', 'both pupils visible at four gaze extremes', 'held pointer retains gaze without continuous rendering', 'reduced motion fallback', 'no microphone or voice API requests'] }));
} finally { await browser.close(); }
