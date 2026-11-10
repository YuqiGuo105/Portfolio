import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VISITOR_PREVIEW_URL || 'http://127.0.0.1:3141';
const output = new URL('../test-artifacts/visitor-social-links/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/')) writes.push(request.url()); });
    await page.goto(`${base}/admin/visitor-preview`, { waitUntil: 'domcontentloaded' });
    for (const [name, host] of [['GitHub', 'github.com'], ['LinkedIn', 'www.linkedin.com'], ['Instagram', 'www.instagram.com'], ['LeetCode', 'leetcode.com']]) {
      const card = page.locator('article').filter({ hasText: `${name} link` }).first();
      await card.scrollIntoViewIfNeeded();
      const target = card.getByRole('link', { name: new RegExp(`Target https://`) });
      assert.equal(new URL(await target.getAttribute('href')).hostname, host);
      assert.equal(await target.getAttribute('target'), '_blank');
      await card.screenshot({ path: `${output}/${width}-${name.toLowerCase()}.png` });
    }
    await page.locator('article').filter({ hasText: 'GitHub link' }).first().getByRole('button', { name: 'Timeline', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Session details' });
    for (const name of ['GitHub', 'LinkedIn', 'Instagram', 'LeetCode']) {
      await dialog.getByText(`${name} link`, { exact: true }).first().waitFor();
    }
    for (const link of await dialog.locator('ol > li a').all()) {
      assert.match(await link.getAttribute('href'), /^https:\/\//);
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    }
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: `${output}/${width}-timeline.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    await page.close();
    console.log(`PASS ${width}px: four platform labels, external destinations, timeline, no overflow, no live writes`);
  }
} finally {
  await browser.close();
}
