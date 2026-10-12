import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VISITOR_PREVIEW_URL || 'http://127.0.0.1:3111';
const output = new URL('../test-artifacts/visitor-overview/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 1024, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (['fetch', 'xhr'].includes(req.resourceType()) && !req.url().startsWith(base)) external.push(req.url()); });
    await page.goto(`${base}/admin/visitor-preview`, { waitUntil: 'domcontentloaded' });
    const overview = page.getByRole('region', { name: 'Visitor analytics' });
    await overview.getByRole('heading', { name: 'Traffic composition' }).waitFor();
    for (const name of ['Key metrics', 'Activity over time', 'Traffic composition', 'Top pages', 'Top sources', 'Top countries', 'Devices']) {
      const toggle = overview.getByRole('button', { name, exact: true });
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.ok(await toggle.evaluate(el => document.getElementById(el.getAttribute('aria-controls')).hidden));
      await toggle.press('Enter');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await toggle.press('Space');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
    }
    await overview.getByRole('button', { name: 'Top sources', exact: true }).click();
    await overview.getByRole('button', { name: 'Collapse traffic overview', exact: true }).click();
    assert.equal(await overview.getByRole('group', { name: 'Analytics time range' }).isVisible(), false);
    assert.equal(await overview.getByRole('group', { name: 'Trend metric' }).isVisible(), false);
    assert.ok(await page.getByText('Visitor event records', { exact: true }).isVisible());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${width}-collapsed.png` });
    await overview.getByRole('button', { name: 'Expand traffic overview', exact: true }).press('Enter');
    assert.equal(await overview.getByRole('button', { name: 'Top sources', exact: true }).getAttribute('aria-expanded'), 'false');
    const range = overview.getByRole('group', { name: 'Analytics time range' });
    for (const name of ['7 days', '30 days', '24 hours', '7 days']) {
      await range.getByRole('button', { name, exact: true }).click();
      await overview.getByRole('heading', { name: 'Traffic composition' }).waitFor();
      assert.equal(await range.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
    }
    assert.equal(await overview.getByRole('button', { name: 'Top sources', exact: true }).getAttribute('aria-expanded'), 'false');
    await overview.getByRole('button', { name: 'Top sources', exact: true }).click();
    const metric = overview.getByRole('group', { name: 'Trend metric' });
    await metric.getByRole('button', { name: 'Page views', exact: true }).click();
    await overview.getByRole('group', { name: 'Page views trend in UTC' }).waitFor();
    await overview.getByRole('group', { name: 'Page views trend in UTC' }).getByRole('button').first().focus();
    assert.ok(await overview.getByText('Selected day', { exact: true }).isVisible());
    await page.keyboard.press('Tab');
    await metric.getByRole('button', { name: 'Events', exact: true }).click();
    const traffic = overview.getByRole('group', { name: 'Analytics traffic filter' });
    await traffic.getByRole('button', { name: 'Likely people', exact: true }).click();
    await overview.getByRole('heading', { name: 'Traffic composition' }).waitFor();
    assert.ok(await page.getByLabel('Likely people only', { exact: true }).isChecked());
    assert.match(await overview.locator('[role="img"]').getAttribute('aria-label'), /Bots: 0, Unclassified: 0/);
    await overview.getByRole('region', { name: 'Top countries', exact: true }).getByRole('button', { name: /IN/ }).click();
    await overview.getByRole('heading', { name: 'Traffic composition' }).waitFor();
    assert.equal(await page.getByLabel('Country', { exact: true }).inputValue(), 'IN');
    assert.ok(await overview.getByText('country: IN', { exact: true }).isVisible());
    await overview.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await overview.getByRole('heading', { name: 'Traffic composition' }).waitFor();
    assert.equal(await traffic.getByRole('button', { name: 'All traffic', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByLabel('Country', { exact: true }).fill('XX');
    await page.getByRole('button', { name: 'Query', exact: true }).click();
    await overview.getByText('No traffic in this view', { exact: true }).waitFor();
    await overview.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
    await overview.getByRole('heading', { name: 'Traffic composition' }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `Overflow at ${width}px`);
    const boxes = await overview.locator('h2,h3,button').evaluateAll(nodes => nodes.map(el => ({ text: el.textContent, rect: el.getBoundingClientRect().toJSON(), color: getComputedStyle(el).color, scroll: el.scrollWidth, client: el.clientWidth })));
    assert.ok(boxes.filter(b => b.text?.includes('Traffic at')).every(b => b.color !== 'rgb(255, 255, 255)'));
    assert.ok(boxes.every(b => b.rect.right <= width + 1 && b.rect.left >= 0), `Clipped controls at ${width}px`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${width}-overview.png` });
    if (width < 500) await overview.screenshot({ path: `${output}/${width}-overview-full.png` });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(`PASS ${width}px: independent disclosures, keyboard toggles, retained collapse state, ranges, metrics, chart, filters, empty state and no overflow`);
    await context.close();
  }
} finally { await browser.close(); }
