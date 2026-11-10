import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.ADMIN_PREVIEW_URL || 'http://127.0.0.1:3141';
const output = new URL('../test-artifacts/admin-jobs/', import.meta.url).pathname;
await mkdir(output, { recursive: true });

for (const [name, engine, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await engine.launch({ ...options, headless: true });
  try {
    for (const width of [1280, 768, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errors = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() !== 'GET') writes.push(request.method()); });
      await page.goto(`${base}/admin/jobs-preview`, { waitUntil: 'domcontentloaded' });
      const cards = page.locator('[class*="JobsPage_operationCard"]');
      await cards.first().waitFor();
      assert.equal(await cards.count(), 3);
      for (const card of await cards.all()) {
        const layout = await card.evaluate(el => {
          const copy = el.lastElementChild, title = copy.children[0], detail = copy.children[1];
          const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
          return { card: box(el), title: box(title), detail: box(detail) };
        });
        assert.ok(layout.detail.width >= 150, `${name}/${width}: description must not occupy the arrow column`);
        assert.ok(layout.detail.y >= layout.title.bottom - 1);
        assert.ok(layout.detail.right <= layout.card.right);
        assert.ok(layout.detail.bottom <= layout.card.bottom);
        assert.ok(layout.card.height < 230, `${name}/${width}: card must remain compact`);
      }
      const docs = page.getByRole('link', { name: 'Open Admin API' });
      assert.equal(await docs.getAttribute('href'), '/admin/api-docs');
      for (const cell of await page.locator('tbody td:last-child').all()) {
        assert.ok((await cell.boundingBox()).width >= 220, `${name}/${width}: table description must remain readable`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('main').screenshot({ path: `${output}/${name}-${width}.png` });
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      console.log(`PASS ${name} ${width}px: readable cards, correct documentation link, no overflow`);
      if (width === 1280) {
        await docs.click();
        await page.waitForURL('**/admin/login?**', { timeout: 30000 });
        assert.equal(await page.locator('.swagger-ui').count(), 0);
        assert.equal(new URL(page.url()).searchParams.get('redirect'), '/admin/api-docs');
        console.log(`PASS ${name}: anonymous visitors go to login without documentation`);
      }
      await page.close();
    }
  } finally { await browser.close(); }
}
