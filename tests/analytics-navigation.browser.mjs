import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { chromium } = playwright.default || playwright;
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stripImports = source => source.replace(/^import .+;\r?$/gm, '');
const policy = await read('../src/lib/analyticsPagePolicy.mjs');
const hostFilter = (await read('../src/lib/analyticsHostFilter.js')).replaceAll('process.env.NODE_ENV', '"production"');
const behavior = (await read('../src/lib/behaviorAnalytics.js'))
  .replace('process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY', 'undefined');
const requestPolicy = stripImports(await read('../src/lib/analyticsRequestPolicy.js'));
const ingestion = await import(dataModule(`
  import crypto from 'node:crypto';
  import { isPrivateAnalyticsEvent } from '${dataModule(policy)}';
  import { isLocalAnalyticsRequest, isLocalAnalyticsEvent } from '${dataModule(hostFilter)}';
  const requireSupabaseUser = async () => ({ roles: 'ADMIN' });
  ${requestPolicy}
  export const events = [];
  const produceRawEvent = async event => { events.push(event); return true; };
  const isRateLimited = async () => false;
  const createRecaptchaAssessment = async () => ({ status: 'SKIPPED' });
  const assessmentProperties = () => ({});
  const supabaseServer = { from() { throw new Error('No live database calls in browser regression'); } };
  const uuidv7 = () => crypto.randomUUID();
  ${stripImports(await read('../pages/api/track.js'))}
`));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const errors = [];
    const pending = [];
    const accepted = [];
    let onTracked;
    const nextTracked = () => new Promise(resolve => { onTracked = resolve; });
    const before = ingestion.events.length;
    await context.route('**/*', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/track') {
        pending.push({ route, request });
        onTracked?.();
        onTracked = null;
        return;
      }
      const modules = { '/behaviorAnalytics.js': behavior, '/analyticsHostFilter': hostFilter, '/analyticsPagePolicy.mjs': policy };
      if (modules[path]) return route.fulfill({ contentType: 'text/javascript', body: modules[path] });
      if (path.startsWith('/api/')) throw new Error(`Unexpected API call: ${path}`);
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Analytics navigation regression</title>
        <script type="module">
          import { startPageBehaviorTracking, setAnalyticsConsent } from '/behaviorAnalytics.js';
          let stop = startPageBehaviorTracking(location.pathname);
          window.navigate = (path, canceled = false) => {
            stop({ discard: true });
            if (!canceled) history.pushState({}, '', path);
            stop = startPageBehaviorTracking(location.pathname, { recordPageView: !canceled });
          };
          window.denyConsent = () => setAnalyticsConsent('denied');
          window.ready = true;
        </script>` });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const deliver = async () => {
      for (const { route, request } of pending.splice(0)) {
        const headers = await request.allHeaders();
        assert.equal(headers.authorization, undefined);
        const res = {
          statusCode: 200, body: '',
          status(code) { this.statusCode = code; return this; },
          json(body) { this.body = JSON.stringify(body); }, end() {},
        };
        await ingestion.default({ method: 'POST', headers, body: request.postDataJSON() }, res);
        assert.equal(res.statusCode, 200);
        accepted.push(request.postDataJSON());
        await route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body });
      }
    };

    // Simulate an existing admin session without connecting to real auth or analytics.
    await context.addInitScript(() => localStorage.setItem('test-admin-session', 'signed-in'));
    const firstRequest = nextTracked();
    await page.goto('https://www.yuqi.site/');
    await page.waitForFunction(() => window.ready);
    await firstRequest;
    assert.equal(pending.length, 1, 'homepage must be queued without waiting for identity');
    await page.evaluate(() => {
      window.navigate('/admin/login');
      localStorage.setItem('test-admin-session', 'new-admin-login');
      window.navigate('/admin/visitors');
    });
    await deliver();
    assert.equal(ingestion.events.length - before, 1);
    assert.equal(ingestion.events.at(-1).pageUrl, '/');
    assert.equal(accepted[0].page, '/');
    assert.equal(accepted[0].event, 'page_view');
    const originalTime = accepted[0].localTime;
    assert.equal(ingestion.events.at(-1).eventTime, originalTime);

    await page.reload();
    await page.waitForFunction(() => window.ready);
    assert.equal(pending.length, 0, 'direct admin load must not fabricate a homepage view');
    const request = nextTracked();
    await page.evaluate(() => window.navigate('/'));
    await request;
    await deliver();
    assert.equal(ingestion.events.length - before, 2, 'return to public homepage counts once');
    await page.evaluate(() => window.navigate('/admin', true));
    assert.equal(pending.length, 0, 'canceled admin navigation must not duplicate homepage');
    await page.evaluate(() => { window.denyConsent(); window.navigate('/blogs'); });
    assert.equal(pending.length, 0, 'privacy opt-out is preserved');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, publicVisits: 2, privateVisits: 0, retainedEventTime: true, passed: true }));
    await context.close();
  }
} finally {
  await browser.close();
}
