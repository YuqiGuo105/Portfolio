import assert from 'node:assert/strict';
import { chromium } from '/Users/yuqiguo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_ORIGIN || 'http://127.0.0.1:3062/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2300);
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const section of ['.hero-started', '.footer']) {
      const group = page.locator(`${section} [aria-label="Social profiles"]`);
      assert.equal(await group.locator('a').count(), 3);
      const links = await group.locator('a').evaluateAll(nodes => nodes.map(node => ({
        url: node.href, label: node.getAttribute('aria-label'), rel: node.rel,
        width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
        y: node.getBoundingClientRect().y,
      })));
      assert.ok(links.every(link => link.width === 44 && link.height === 44 && link.y === links[0].y));
      assert.ok(links.every(link => link.url.startsWith('https://') && link.rel.includes('noopener')));
      assert.match(links[1].url, /^https:\/\/leetcode.com\/u\//);
      assert.match(links[1].label, /LeetCode/);
    }
  }
  const response = await page.request.get(new URL('/assets/icons/leetcode.svg', page.url()).href);
  assert.equal(response.status(), 200);
  const group = page.locator('.footer [aria-label="Social profiles"]');
  await group.scrollIntoViewIfNeeded();
  await group.getByRole('link', { name: /LeetCode/ }).focus();
  assert.equal(await group.getByText('LeetCode', { exact: true }).evaluate(el => getComputedStyle(el).opacity), '1');
  await page.evaluate(() => { document.activeElement.blur(); document.body.classList.remove('light-skin'); document.body.classList.add('dark-skin'); });
  await group.screenshot({ path: '/private/tmp/yuqi-social-links-dark.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('Passed: HTTPS destinations, 44px targets, desktop/mobile alignment, LeetCode asset and keyboard tooltip.');
} finally { await browser.close(); }
