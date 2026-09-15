import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3075';
const output = process.env.TEST_ARTIFACTS || '/private/tmp/mcp-guide-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'reduce' });
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1280, 720]]) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto(origin + '/mcp-guide');
    await page.getByRole('heading', { name: 'Portfolio MCP Gateway', exact: true }).waitFor();
    const images = page.locator('main figure img');
    assert.equal(await images.count(), 5);
    for (const img of await images.all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(el => el.decode());
      const rect = await img.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width, 'Image stays within viewport');
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow');
    assert.ok(await page.locator('#authorization').innerText().then(t => t.includes('Authorized administrator login required.')));
    await page.getByRole('button', { name: 'Copy Public endpoint', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://www.yuqi.site/mcp');
    await page.getByRole('button', { name: 'Copy Admin endpoint', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://www.yuqi.site/mcp/admin');
    await page.getByRole('link', { name: '02 Administrator edition', exact: true }).click();
    await page.waitForURL('**/mcp-guide#authorization');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/mcp-guide-${width}.png`, fullPage: true });
    assert.deepEqual(errors, [], 'No page runtime errors');
    console.log(`PASS ${width}x${height}: 5 images, copy endpoints, admin anchor, no overflow or runtime errors`);
    await page.close();
  }
} finally {
  await browser.close();
}
