import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SERVICE_PREVIEW_URL || 'http://127.0.0.1:3112';
const output = new URL('../test-artifacts/service-hover/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [], errors = [];
let livePayload;

async function setup(width, height = 950) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500 });
  await context.addInitScript(() => localStorage.setItem('portfolioSubscriptionPrompt:v1', String(Date.now())));
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.stack || error.message));
  // Tests never emit visitor, contact, subscription or chat writes.
  await page.route('**/api/**', route => route.request().method() !== 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : route.continue());
  const requests = [];
  page.on('request', request => { if (request.url().includes('/api/metrics/service?')) requests.push(request.url()); });
  await page.goto(`${base}/?subscriptionPreview=0#platform-monitoring`, { waitUntil: 'domcontentloaded' });
  // Auto-scrolling to an offscreen card must finish before opening its popover.
  await page.addStyleTag({ content: 'html, body, * { scroll-behavior: auto !important; }' });
  await page.locator('[data-monitor-service]').first().waitFor();
  await page.locator('#platform-monitoring').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  return { context, page, requests };
}
async function assertGeometry(page, width, height) {
  const popup = page.locator('#service-hover-details');
  await popup.waitFor({ state: 'visible' });
  const box = await popup.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'Popover outside horizontal viewport');
  assert.ok(box.y >= 0 && box.y + box.height <= height - 75, 'Popover overlaps launcher zone');
  assert.ok(box.width <= 420 && box.height <= 481, 'Service details must stay compact');
  assert.equal(await popup.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
  for (const metric of await popup.locator('dl > div').all()) {
    const bounds = await metric.boundingBox();
    const value = await metric.locator('dd').boundingBox();
    const label = await metric.locator('dt').boundingBox();
    assert.ok(value.x >= bounds.x - 1 && value.x + value.width <= bounds.x + bounds.width + 1, 'Metric value overflows its column');
    assert.ok(label.y + label.height <= value.y + 1 || label.x + label.width <= value.x + 1, 'Metric label and value overlap');
  }
  const elements = await popup.locator('footer a').all();
  for (let index = 0; index < elements.length - 1; index++) {
    const a = await elements[index].boundingBox(), b = await elements[index + 1].boundingBox();
    assert.ok(a.x + a.width <= b.x + 1 || a.y + a.height <= b.y + 1, 'Links overlap');
  }
}
async function shot(page, name) { await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' }); }

try {
  const { context, page, requests } = await setup(1440, 1000);
  assert.equal(requests.length, 0, 'No service detail prefetch during homepage loading');
  const admin = page.getByRole('button', { name: 'Admin service details', exact: true });
  await admin.scrollIntoViewIfNeeded();
  const rect = await admin.boundingBox();
  await page.mouse.move(rect.x + 25, rect.y + 25);
  await page.waitForTimeout(40);
  await page.mouse.move(5, 200);
  await page.waitForTimeout(260);
  assert.equal(requests.length, 0, 'Brief pointer pass must not fetch metrics');
  const response = page.waitForResponse(r => r.url().includes('/api/metrics/service?job=portfolio-admin-service') && r.status() === 200);
  await admin.hover();
  livePayload = await (await response).json();
  assert.ok(livePayload.metrics.heapUsedBytes > 0, 'Live Grafana data reached browser');
  assert.equal(livePayload.job, 'portfolio-admin-service');
  await page.getByRole('dialog', { name: 'Admin service details' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#service-hover-details').textContent.includes('Loading Grafana'));
  const popup = page.locator('#service-hover-details');
  assert.equal(await popup.locator('dt[aria-label="Heap used / limit"]').innerText(), 'Heap');
  assert.equal(await popup.locator('dl > div').count(), 11, 'All primary and runtime metrics are retained');
  assert.ok(await popup.locator('header + div').evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'Default desktop details should not require scrolling');
  assert.equal(await popup.getByRole('link', { name: 'Source code' }).getAttribute('href'), 'https://github.com/YuqiGuo105/portfolio-admin-service');
  assert.equal(await popup.getByRole('link', { name: 'Source code' }).getAttribute('target'), '_blank');
  await popup.hover(); await page.waitForTimeout(350);
  assert.ok(await popup.isVisible(), 'Hover remains open when pointer enters popup');
  await assertGeometry(page, 1440, 1000);
  await shot(page, 'desktop-live-hover');
  await page.keyboard.press('Escape');
  assert.equal(await popup.count(), 0);
  assert.ok(await admin.evaluate(el => el === document.activeElement));
  const count = requests.length;
  const reusable = !livePayload.stale && !livePayload.partial && Date.now() - Date.parse(livePayload.capturedAt) < 55_000;
  await page.mouse.move(5, 200);
  await admin.hover();
  await popup.waitFor();
  await page.waitForTimeout(300);
  if (reusable) assert.equal(requests.length, count, 'Repeated hover should use fresh browser cache');
  else assert.ok(requests.length <= count + 1, 'Expired or partial samples may revalidate once');
  await page.keyboard.press('Escape');

  await admin.press('Enter');
  await popup.waitFor();
  await admin.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close service details');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show 2 more services', exact: true }).click();
  assert.equal(await page.locator('[data-monitor-service]').count(), 10);
  await page.getByRole('button', { name: 'Career Workflow Service service details', exact: true }).click();
  await page.getByRole('dialog', { name: 'Career Workflow Service service details' }).waitFor();
  assert.match(await popup.getByRole('link', { name: 'Source code' }).getAttribute('href'), /portfolio-application-copilot$/);
  await assertGeometry(page, 1440, 1000);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.body.classList.remove('light-skin'); document.body.classList.add('dark-skin'); });
  // Switching back from the last row can scroll; settle before opening details.
  await admin.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await admin.click();
  await popup.waitFor();
  await shot(page, 'desktop-dark-hover');
  await page.keyboard.press('Escape');
  checks.push('Live Grafana, lazy loading, 200ms intent, cache, hoverable popup, keyboard, Escape, links, 10 services, dark theme');
  await context.close();

  const together = await setup(1126, 726);
  await together.page.locator('#__chat_widget_root .launch-button').click();
  await together.page.locator('#__chat_widget_root .bot-container').waitFor();
  await together.page.getByRole('button', { name: 'Admin service details', exact: true }).click();
  await together.page.locator('#service-hover-details').waitFor();
  await together.page.waitForFunction(() => !document.querySelector('#service-hover-details').textContent.includes('Loading Grafana'));
  await assertGeometry(together.page, 1126, 726);
  const detailBox = await together.page.locator('#service-hover-details').boundingBox();
  const chatBox = await together.page.locator('#__chat_widget_root .bot-container').boundingBox();
  assert.ok(detailBox.x + detailBox.width <= chatBox.x || detailBox.y + detailBox.height <= chatBox.y, 'Service details should avoid the expanded chat when room is available');
  await shot(together.page, 'compact-with-chat');
  checks.push(`Alongside chat: ${Math.round(detailBox.width)}x${Math.round(detailBox.height)}, no overlap`);
  await together.context.close();

  for (const width of [768, 390, 320]) {
    const { context, page } = await setup(width, 844);
    const card = page.getByRole('button', { name: 'Admin service details', exact: true });
    await card.scrollIntoViewIfNeeded();
    if (width < 500) await card.tap(); else await card.click();
    await page.locator('#service-hover-details').waitFor();
    await page.waitForFunction(() => !document.querySelector('#service-hover-details').textContent.includes('Loading Grafana'));
    await assertGeometry(page, width, 844);
    const close = page.getByRole('button', { name: 'Close service details', exact: true });
    if (width < 500) {
      const bounds = await close.boundingBox(); assert.ok(bounds.width >= 44 && bounds.height >= 44);
    }
    await shot(page, `${width}-live-hover`);
    await close.click();
    assert.equal(await page.locator('#service-hover-details').count(), 0);
    checks.push(`${width}px: same popover, click/tap, no clipping, launcher clearance, close`);
    await context.close();
  }

  const errorTest = await setup(1440, 1000);
  await errorTest.page.route('**/api/metrics/service?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' }));
  await errorTest.page.getByRole('button', { name: 'Admin service details', exact: true }).hover();
  await errorTest.page.getByRole('status').filter({ hasText: 'Extra metrics unavailable' }).waitFor();
  await errorTest.page.locator('#service-hover-details').getByRole('link', { name: 'Source code' }).waitFor({ state: 'visible' });
  await assertGeometry(errorTest.page, 1440, 1000);
  await shot(errorTest.page, 'unavailable-fallback');
  await errorTest.context.close();
  checks.push('Grafana failure retains summary and working repository links');
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  const result = { checks, errors, live: { capturedAt: livePayload.capturedAt, fields: Object.keys(livePayload.metrics), points: livePayload.requests.length } };
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
