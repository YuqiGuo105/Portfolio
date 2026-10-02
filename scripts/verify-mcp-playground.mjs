import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// PLAYWRIGHT_MODULE may point to a shared local runtime; no browser dependency ships with the site.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:3104';
const output = process.env.PLAYGROUND_ARTIFACTS || '/tmp/mcp-playground-verification';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let requests = 0;
page.on('request', req => { if (req.url().endsWith('/api/mcp/playground')) requests++; });
const section = page.locator('#playground');
const run = () => section.getByRole('button', { name: 'Run example', exact: true }).click();
async function noOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const clipped = await section.locator('button, label > span, h3, h4, p').evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
  assert.deepEqual(clipped, []);
  assert.equal(await section.locator('button[type="submit"]').evaluate(el => getComputedStyle(el, '::before').content), 'none');
}

try {
  await page.goto(`${base}/mcp-guide`, { waitUntil: 'networkidle' });
  assert.equal(requests, 0, 'No calls should run on page load');
  for (const image of await page.locator('article figure img').all()) {
    const response = await page.request.get(new URL(await image.getAttribute('src'), base).href);
    assert.equal(response.status(), 200, 'Existing guide screenshot must still load');
  }
  assert.equal(await page.locator('article figure img').count(), 5);

  let realResult;
  for (const [id, label, tool] of [['projects', 'Project match', 'search_portfolio'], ['kubernetes', 'Article search', 'search_articles'], ['publishing', 'Publish flow', 'get_project']]) {
    await section.getByText(label, { exact: true }).click();
    const pending = page.waitForResponse(res => res.url().endsWith('/api/mcp/playground') && res.request().method() === 'POST');
    await run();
    const response = await pending;
    const body = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(body));
    assert.equal(body.scenario, id); assert.equal(body.status, 'complete');
    assert.ok(body.items.length > 0); assert.equal(body.calls[0].name, tool);
    assert.ok(body.elapsedMs > 0);
    await section.getByRole('status').filter({ hasText: 'Completed' }).waitFor();
    assert.equal(await section.locator('details').getAttribute('open'), null);
    for (const source of body.sources) assert.equal(await section.locator(`a[href="${source.url}"]`).count(), 1);
    if (id === 'publishing') {
      assert.deepEqual(body.steps.map(step => step.title), ['Validate', 'Commit', 'Publish', 'Project']);
      assert.equal(await section.locator('ol > li').count(), 4);
      realResult = body;
    }
    await noOverflow();
    await section.screenshot({ path: `${output}/${id}-desktop.png` });
    await section.locator('summary').click();
    await section.getByText(tool, { exact: true }).waitFor();
    await noOverflow();
    await section.locator('summary').click();
    console.log(`LIVE ${id}: ${body.items.length} result(s), ${body.elapsedMs}ms, ${body.steps.length} workflow steps`);
  }

  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow();
    await section.screenshot({ path: `${output}/publishing-${width}.png` });
    await section.locator('summary').click(); await noOverflow(); await section.locator('summary').click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await section.getByRole('radio', { name: 'Project match' }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await section.getByRole('radio', { name: 'Article search' }).isChecked(), true);
  assert.equal(await section.locator('details').count(), 0, 'Changing examples clears the previous result');

  // Fault injection is browser-local; it never changes or adds production records.
  const api = '**/api/mcp/playground';
  await page.route(api, route => route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'timeout' }) }));
  await run(); await section.getByRole('alert').filter({ hasText: 'timed out' }).waitFor();
  await section.screenshot({ path: `${output}/timeout.png` });
  await page.unroute(api);
  await page.route(api, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...realResult, scenario: 'kubernetes' }) }));
  await section.getByRole('button', { name: 'Try again' }).click();
  await section.getByRole('status').filter({ hasText: 'Completed' }).waitFor();
  await page.unroute(api);

  await section.getByText('Project match', { exact: true }).click();
  let pendingRoute;
  await page.route(api, route => { pendingRoute = route; });
  await run(); await section.getByRole('button', { name: 'Stop example' }).waitFor();
  await section.getByRole('button', { name: 'Stop example' }).click();
  await section.getByRole('status').filter({ hasText: 'Stopped' }).waitFor();
  await pendingRoute?.abort().catch(() => {}); await page.unroute(api);
  assert.equal(await section.locator('details').count(), 0);

  await page.route(api, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...realResult, scenario: 'projects', status: 'empty', items: [], sources: [], steps: [] }) }));
  await run(); await section.getByText('No matching public records were returned for this query.').waitFor();
  await page.unroute(api);

  await page.route(api, route => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited' }) }));
  await run(); await section.getByRole('alert').filter({ hasText: 'Too many requests' }).waitFor();
  assert.equal(await section.locator('button[type="submit"]').isDisabled(), true);
  await section.getByText('Article search', { exact: true }).click();
  assert.equal(await section.locator('button[type="submit"]').isDisabled(), true, 'Scenario changes must not bypass client cooldown');
  await noOverflow();
  assert.deepEqual(errors, []);
  console.log('PASS: original images, sources, folded traces, mobile 320/390/768, keyboard, timeout/retry, cancellation, empty and rate-limit states; no page errors.');
} finally { await browser.close(); }
