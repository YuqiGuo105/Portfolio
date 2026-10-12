import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VISITOR_PREVIEW_URL || 'http://127.0.0.1:3111';
const output = new URL('../test-artifacts/visitor-scroll-depth/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const tracker = (await readFile(new URL('../src/lib/behaviorAnalytics.js', import.meta.url), 'utf8')).replace(/^import .+;\r?$/gm, '');
const policy = await readFile(new URL('../src/lib/analyticsPagePolicy.mjs', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const tracked = [];
  // Isolated browser fixture: real tracker and scroll geometry, no production ingestion.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/api/track') {
      tracked.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/__scroll-depth-test') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Scroll-depth test fixture</title><style>body{margin:0;height:5000px}</style><h1>Isolated scroll test</h1><script type="module">
      const process = { env: {} };
      const isBrowserAnalyticsDisabled = () => false;
      ${policy}
      ${tracker}
      startPageBehaviorTracking(location.pathname);
      document.body.dataset.ready = 'true';
    </script>` });
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${base}/__scroll-depth-test`);
  await page.locator('body[data-ready="true"]').waitFor();
  for (const percent of [25, 50, 75, 100]) {
    const request = page.waitForRequest(request => request.url().endsWith('/api/track') && request.postDataJSON()?.properties?.progressPercent === percent);
    await page.evaluate(p => window.scrollTo(0, Math.ceil((document.documentElement.scrollHeight - innerHeight) * p / 100)), percent);
    await request;
  }
  await page.keyboard.press('Home'); await page.keyboard.press('End');
  await page.goto('about:blank');
  assert.deepEqual(tracked.filter(e => e.event === 'read_progress').map(e => e.properties.progressPercent), [25, 50, 75, 100]);
  assert.equal(tracked.filter(e => e.event === 'engaged_time').length, 0);
  tracked.length = 0;
  await page.goto(`${base}/__scroll-depth-test`);
  await page.locator('body[data-ready="true"]').waitFor();
  const bottom = page.waitForRequest(request => request.url().endsWith('/api/track') && request.postDataJSON()?.properties?.progressPercent === 100);
  await page.keyboard.press('End'); await bottom;
  await page.goto('about:blank');
  assert.deepEqual(tracked.filter(e => e.event === 'read_progress').map(e => e.properties.progressPercent), [100]);
  console.log('PASS real browser scrolling: 25/50/75/100, max four checkpoints, fast-bottom coalesces to one, no duration events');
  await context.close();

  for (const width of [1440, 390, 320]) {
    const ui = await browser.newContext({ viewport: { width, height: 1000 } });
    const preview = await ui.newPage(), errors = [], external = [];
    preview.on('pageerror', error => errors.push(error.message));
    preview.on('request', request => { if (['fetch','xhr'].includes(request.resourceType()) && !request.url().startsWith(base)) external.push(request.url()); });
    await preview.goto(`${base}/admin/visitor-preview`);
    await preview.getByLabel('Event', { exact: true }).fill('read_progress');
    await preview.getByRole('button', { name: 'Query', exact: true }).click();
    const card = preview.getByRole('article').filter({ hasText: 'About 75%' }).first();
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const depth = card.locator('[title^="Approximate furthest scroll"]');
    assert.ok(await depth.isVisible());
    assert.equal(await depth.locator('[aria-hidden="true"] > span').getAttribute('style'), 'width: 75%;');
    await card.screenshot({ path: `${output}/${width}-record.png` });
    await card.getByRole('button', { name: 'Timeline', exact: true }).click();
    const dialog = preview.getByRole('dialog', { name: 'Session details' });
    await dialog.getByText('About 75%', { exact: true }).first().waitFor();
    assert.doesNotMatch(await dialog.innerText(), /Reported engagement/);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await dialog.screenshot({ path: `${output}/${width}-timeline.png` });
    await preview.getByRole('button', { name: 'Close session details' }).click();
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(`PASS ${width}px: event-card percentage and bar, timeline, no overflow or external data requests`);
    await ui.close();
  }
} finally { await browser.close(); }
