import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.TEST_ORIGIN || 'http://127.0.0.1:3062/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2300);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cw:site-tour:start')));
  const pet = page.locator('.st-roaming-pet.is-ready');
  await pet.waitFor({ timeout: 20000 });
  await page.waitForTimeout(1100);
  await page.waitForFunction(() => document.querySelector('.st-roaming-pet')?.dataset.gesture === 'curious', null, { timeout: 10000 });
  assert.match(await pet.locator('.st-pet-head').evaluate(el => getComputedStyle(el).animationName), /curiousHead/);
  const curiosityTime = await pet.locator('.st-pet-head').evaluate(el => el.getAnimations()[0].currentTime);
  await pet.getByRole('button', { name: 'Play with Mr.Pot', exact: true }).dispatchEvent('click');
  await page.waitForTimeout(150);
  assert.equal(await pet.getAttribute('data-gesture'), 'curious', 'interaction must not snap an in-flight pose back to rest');
  assert.ok(await pet.locator('.st-pet-head').evaluate((el, previous) => el.getAnimations()[0].currentTime > previous, curiosityTime));
  for (const gesture of ['happy', 'greet', 'balance']) {
    await pet.hover();
    await pet.getByRole('button', { name: 'Play with Mr.Pot', exact: true }).click();
    await page.waitForFunction(expected => document.querySelector('.st-roaming-pet')?.dataset.gesture === expected, gesture);
    assert.equal(await pet.evaluate(el => el.classList.contains('is-speaking')), false);
  }

  const seam = await page.evaluate(async () => {
    const image = new Image(); image.src = '/assets/images/mr-pot-tour-guide.png'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1224; canvas.height = 1285;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, 1224, 1285).data;
    const core = new Path2D(document.querySelector('#st-pet-core-clip path').getAttribute('d'));
    const arm = new Path2D(document.querySelector('#st-pet-left-arm-clip path').getAttribute('d'));
    let duplicate = 0, torsoOutline = 0, armOutline = 0;
    for (let y = 810; y < 950; y++) for (let x = 420; x < 480; x++) {
      const i = (y * 1224 + x) * 4;
      if (data[i + 3] < 128 || Math.max(data[i], data[i + 1], data[i + 2]) > 100) continue;
      const inArm = ctx.isPointInPath(arm, x + .5, y + .5);
      const inCore = ctx.isPointInPath(core, x + .5, y + .5);
      if (inArm) armOutline++;
      if (inCore) torsoOutline++;
      if (inCore && inArm) duplicate++;
    }
    return { duplicate, torsoOutline, armOutline };
  });
  assert.equal(seam.duplicate, 0, 'arm contour must not be duplicated in the torso');
  assert.equal(seam.torsoOutline, 0, 'stationary torso must not retain the arm line');
  assert.ok(seam.armOutline > 500, 'arm retains its original contour');

  const box = await pet.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * .6);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 100, { steps: 8 });
  assert.ok(await pet.evaluate(el => el.classList.contains('is-dragging')));
  assert.equal(await pet.getAttribute('data-gesture'), 'rest', 'dragging takes precedence over performances');
  const dangling = await pet.locator('.st-pet-leg-left').evaluate(el => getComputedStyle(el).animationName);
  assert.match(dangling, /dangle-left/);
  await page.mouse.up();
  assert.equal(await pet.evaluate(el => el.classList.contains('is-dragging')), false);

  await page.mouse.move(10, 10);
  const observed = new Set();
  const deadline = Date.now() + 55000;
  while (observed.size < 6 && Date.now() < deadline) {
    const gesture = await pet.getAttribute('data-gesture');
    if (gesture !== 'rest') observed.add(gesture);
    await page.waitForTimeout(100);
  }
  assert.deepEqual([...observed].sort(), ['balance', 'curious', 'greet', 'happy', 'sleepy', 'stretch']);
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

  // Inspect fixed animation phases at a larger scale without altering production assets.
  await page.evaluate(() => {
    const svg = document.querySelector('.st-pet-rig');
    const sheet = document.createElement('div'); sheet.id = 'pet-motion-audit';
    Object.assign(sheet.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: '#222a34', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', padding: '32px' });
    for (const [label, gesture, time] of [['Curious', 'curious', 1000], ['Stretch', 'stretch', 1500], ['Happy hop', 'happy', 840], ['Balance', 'balance', 1500], ['Sleepy', 'sleepy', 1860], ['Greeting', 'greet', 1290]]) {
      const item = document.createElement('div');
      const title = document.createElement('div'); title.textContent = label; Object.assign(title.style, { color: 'white', font: '16px sans-serif', textAlign: 'center' });
      const rig = document.createElement('div'); rig.className = document.querySelector('.st-roaming-pet').className.replace(/is-walking|is-dragging|is-speaking/g, '');
      rig.dataset.gesture = gesture;
      Object.assign(rig.style, { position: 'relative', width: '300px', height: '330px', margin: 'auto', transform: 'none', opacity: '1', filter: 'none' });
      const body = document.createElement('div'); body.className = 'st-roaming-pet-body';
      body.append(svg.cloneNode(true)); rig.append(body); item.append(title, rig); sheet.append(item);
      rig.dataset.auditTime = time;
    }
    document.body.append(sheet);
    for (const rig of sheet.querySelectorAll('.st-roaming-pet')) for (const animation of rig.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = Number(rig.dataset.auditTime); }
  });
  await page.locator('#pet-motion-audit').screenshot({ path: '/private/tmp/yuqi-pet-motion-poses.png' });
  for (const [gesture, part, animation] of [
    ['curious', 'head', 'curiousHead'], ['stretch', 'arm-left', 'stretchArm'],
    ['happy', 'arm-left', 'happyArm'], ['balance', 'leg-left', 'balanceFoot'],
    ['sleepy', 'head', 'sleepyHead'], ['greet', 'arm-right', 'greetArm'],
  ]) {
    const style = await page.locator(`#pet-motion-audit [data-gesture="${gesture}"] .st-pet-${part}`).evaluate(el => ({ name: getComputedStyle(el).animationName, transform: getComputedStyle(el).transform }));
    assert.ok(style.name.includes(animation), `${gesture} must use its own animation`);
    assert.notEqual(style.transform, 'none', `${gesture} must articulate its target body part`);
  }
  await page.evaluate(() => document.querySelector('#pet-motion-audit').remove());

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const mobile = await pet.boundingBox();
  assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 391);
  assert.ok(mobile.y >= 0 && mobile.y + mobile.height <= 845);
  await page.screenshot({ path: '/private/tmp/yuqi-pet-mobile.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.st-roaming-pet')?.dataset.gesture === 'rest');
  assert.ok(await pet.locator('.st-pet-layer').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).animationName === 'none')));
  assert.equal(await pet.locator('.st-pet-rig').evaluate(el => getComputedStyle(el).animationName), 'none');
  await pet.getByRole('button', { name: 'Close Mr.Pot', exact: true }).click();
  assert.equal(await page.locator('.st-roaming-pet').count(), 0);
  await page.getByRole('button', { name: 'Show Mr.Pot', exact: true }).click();
  await page.locator('.st-roaming-pet').waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, seam, checks: ['6 autonomous performances', '3 interaction responses', 'drag priority', 'hidden page pause', '6 articulated poses', 'mobile bounds', 'reduced motion', 'close/reopen'], errors }));
} finally { await browser.close(); }
