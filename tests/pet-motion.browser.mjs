// The guide's Mr. Pot in a real browser: start the site (npm run dev:chat, or any dev server) and run
//   TEST_ORIGIN=http://127.0.0.1:3168/ node tests/pet-motion.browser.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const REST = /rotate\(0 600 1150\) translate\(600 1150\) scale\(1 1\) translate\(-600 -1150\) rotate\(0 600 560\)$/;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.TEST_ORIGIN || 'http://127.0.0.1:3168/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2300);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cw:site-tour:start', { detail: { language: 'en' } })));

  // The opening screen: he walks on, and the guide picks him up from where he stopped.
  const actor = page.locator('[data-tour-actor]');
  await actor.waitFor({ timeout: 20000 });
  const entering = (await actor.boundingBox()).x;
  await page.waitForTimeout(700);
  assert.ok((await actor.boundingBox()).x > entering + 40, 'he walks on from the left');
  const pet = page.locator('.st-roaming-pet.is-ready');
  await pet.waitFor({ timeout: 20000 });
  const part = name => pet.locator(`[data-part="${name}"]`).getAttribute('transform');
  await page.waitForFunction(() => document.querySelector('.st-roaming-pet')?.classList.contains('is-walking'), null, { timeout: 5000 });
  await page.waitForFunction(() => { const el = document.querySelector('.st-roaming-pet'); return el && !el.classList.contains('is-walking') && !el.classList.contains('is-leading'); }, null, { timeout: 8000 });
  const home = await pet.boundingBox();
  assert.ok(home.x >= 0 && home.x + home.width <= 1441 && home.y >= 0 && home.y + home.height <= 1001, 'he lands inside the page');
  assert.equal(await pet.locator('.st-roaming-bubble strong').textContent(), 'Here we are');

  // The dark line between the hanging arm and the body is the body's side and the arm's inner edge at once.
  // Both layers hold it, so an arm that swings away leaves the body whole and takes an edge of its own along.
  const seam = await page.evaluate(async () => {
    const image = new Image(); image.src = '/assets/images/mr-pot-tour-guide.png'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1224; canvas.height = 1285;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, 1224, 1285).data;
    const clip = id => new Path2D(document.querySelector(`#st-pet-${id}-clip path`).getAttribute('d'));
    const core = clip('core'), arm = clip('left-arm'), leg = clip('left-leg'), head = clip('head');
    const dark = (x, y) => { const i = (y * 1224 + x) * 4; return data[i + 3] >= 128 && Math.max(data[i], data[i + 1], data[i + 2]) <= 100; };
    const count = (test, [x0, y0, x1, y1]) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (dark(x, y) && test(x + .5, y + .5)) n++; return n; };
    const inside = path => (x, y) => ctx.isPointInPath(path, x, y);
    const side = [436, 815, 470, 960];
    return {
      line: count(() => true, side), torso: count(inside(core), side), arm: count(inside(arm), side),
      // The hand hangs in front of the hip: none of it may stay behind with the body or the leg.
      handLeftBehind: count((x, y) => ctx.isPointInPath(core, x, y) || ctx.isPointInPath(leg, x, y), [360, 940, 432, 1010]),
      hand: count(inside(arm), [360, 940, 432, 1010]),
      // The chin is the head's alone: a copy in the torso would show as a second chin when the head tilts.
      chinInTorso: count(inside(core), [470, 735, 730, 768]), chin: count(inside(head), [470, 735, 730, 768]),
      // Every opaque pixel of the illustration belongs to some part.
      orphans: (() => {
        const parts = ['core', 'left-arm', 'right-arm', 'left-leg', 'right-leg', 'head', 'lid'].map(clip);
        let n = 0;
        for (let y = 206; y < 1180; y += 2) for (let x = 240; x < 1000; x += 2) {
          if (data[(y * 1224 + x) * 4 + 3] < 200) continue;
          if (!parts.some(part => ctx.isPointInPath(part, x + .5, y + .5))) n++;
        }
        return n;
      })(),
    };
  });
  assert.ok(seam.torso > seam.line * 0.9, `the body keeps its own side: ${JSON.stringify(seam)}`);
  assert.ok(seam.arm > seam.line * 0.9, 'the arm has an inner edge');
  assert.equal(seam.handLeftBehind, 0, 'no piece of the hand stays behind when the arm swings out');
  assert.ok(seam.hand > 400, 'the hand goes with the arm');
  assert.ok(seam.chinInTorso < seam.chin * 0.06, `the chin belongs to the head: ${JSON.stringify(seam)}`);
  assert.ok(seam.orphans < 12, `the cut-out parts cover the illustration, ${seam.orphans} sampled pixels left out`);

  // He performs on his own, and a click on the sparkle gets an answer once the current one is over.
  await page.waitForFunction(() => document.querySelector('.st-roaming-pet')?.dataset.gesture === 'curious', null, { timeout: 10000 });
  await pet.getByRole('button', { name: 'Play with Mr.Pot', exact: true }).dispatchEvent('click');
  await page.waitForTimeout(150);
  assert.equal(await pet.getAttribute('data-gesture'), 'curious', 'interaction must not snap an in-flight pose back to rest');
  // A whole turn in the air shows as the figure narrowing and coming back; a wave is the pointing arm going out.
  const moved = { happy: ['figure', /translate\(0 -\d/], spin: ['figure', /translate\(612 0\) scale\((?:-|0\.[0-7])/], greet: ['armR', /rotate\(-(?:[5-9]|1\d)/] };
  for (const gesture of ['happy', 'spin', 'greet']) {
    await pet.hover();
    await pet.getByRole('button', { name: 'Play with Mr.Pot', exact: true }).click();
    await page.waitForFunction(expected => document.querySelector('.st-roaming-pet')?.dataset.gesture === expected, gesture, { timeout: 12000 });
    assert.equal(await pet.evaluate(el => el.classList.contains('is-speaking')), false);
    const [name, pattern] = moved[gesture];
    let seen = false;
    for (let i = 0; i < 80 && !seen; i++) { seen = pattern.test(await part(name)); if (!seen) await page.waitForTimeout(25); }
    assert.ok(seen, `${gesture} moves his ${name}`);
  }

  // Carried by the pointer: he hangs from it, and stays where he is put.
  await page.waitForFunction(() => document.querySelector('.st-roaming-pet')?.dataset.gesture === 'rest', null, { timeout: 8000 });
  const box = await pet.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * .5);
  await page.mouse.down();
  let swung = false;
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(box.x + box.width / 2 - i * 22, box.y + box.height / 2 + i * 9);
    await page.waitForTimeout(16);
    swung ||= !/rotate\(-?0(?:\.\d+)? 600 560\)$/.test(await part('figure'));
  }
  assert.ok(await pet.evaluate(el => el.classList.contains('is-dragging')));
  assert.equal(await pet.getAttribute('data-gesture'), 'rest', 'dragging takes precedence over performances');
  assert.ok(swung, 'he swings from the hand that carries him');
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.st-roaming-pet')?.classList.contains('is-dragging'), null, { timeout: 2000 });
  await page.waitForTimeout(900);
  const dropped = await pet.boundingBox();
  // He may be on one of his strolls, which take him a few steps to either side and back.
  assert.ok(Math.abs(dropped.x - (box.x - 16 * 22)) < 100 && Math.abs(dropped.y - (box.y + 16 * 9)) < 4, `he stays where he was put down: ${JSON.stringify({ box, dropped })}`);

  // The next chapter: he leaves the ground and comes down by the new section.
  await page.mouse.move(10, 10);
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.st-roaming-pet')?.classList.contains('is-walking'), null, { timeout: 5000 });
  await page.waitForFunction(() => { const el = document.querySelector('.st-roaming-pet'); return el && !el.classList.contains('is-walking') && !el.classList.contains('is-leading'); }, null, { timeout: 8000 });
  const next = await pet.boundingBox();
  assert.ok(next.x >= 0 && next.x + next.width <= 1441 && next.y >= 0 && next.y + next.height <= 1001);

  const observed = new Set();
  const deadline = Date.now() + 120000;
  while (observed.size < 10 && Date.now() < deadline) {
    const gesture = await pet.getAttribute('data-gesture');
    if (gesture !== 'rest') observed.add(gesture);
    await page.waitForTimeout(100);
  }
  assert.deepEqual([...observed].sort(), ['balance', 'boil', 'curious', 'dance', 'greet', 'happy', 'sleepy', 'spin', 'stretch', 'tiphat']);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1600);
  assert.equal(await pet.getAttribute('data-gesture'), 'rest', 'hidden pages stop performances');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1800);
  const mobile = await pet.boundingBox();
  assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 391);
  assert.ok(mobile.y >= 0 && mobile.y + mobile.height <= 845);

  // With reduced motion he is where he should be and holds still.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.st-roaming-pet')?.dataset.gesture === 'rest');
  await page.waitForTimeout(300);
  const still = await part('figure');
  assert.match(still, REST);
  await page.getByRole('button', { name: 'Next chapter', exact: true }).click();
  await page.waitForTimeout(1500);
  assert.equal(await part('figure'), still, 'no pose changes with reduced motion');
  assert.equal(await pet.evaluate(el => el.classList.contains('is-walking')), false, 'and no travelling');
  await pet.getByRole('button', { name: 'Close Mr.Pot', exact: true }).click();
  assert.equal(await page.locator('.st-roaming-pet').count(), 0);
  await page.getByRole('button', { name: 'Show Mr.Pot', exact: true }).click();
  await page.locator('.st-roaming-pet.is-ready').waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, seam, checks: ['walks on', 'first jump', 'whole body when the parts move', '10 autonomous performances', '3 interaction responses', 'carried and put down', 'next chapter', 'hidden page pause', 'mobile bounds', 'reduced motion', 'close/reopen'], errors }));
} finally { await browser.close(); }
