import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { chromium } = playwright.default || playwright;
const behavior = (await readFile(new URL('../src/lib/behaviorAnalytics.js', import.meta.url), 'utf8'))
  .replace('process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY', JSON.stringify('browser-test-site-key'));
const hostFilter = (await readFile(new URL('../src/lib/analyticsHostFilter.js', import.meta.url), 'utf8'))
  .replaceAll('process.env.NODE_ENV', JSON.stringify('production'));
const policy = await readFile(new URL('../src/lib/analyticsPagePolicy.mjs', import.meta.url), 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const tracked = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/track') {
        tracked.push(request.postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      const modules = {
        '/behaviorAnalytics.js': behavior,
        '/analyticsHostFilter': hostFilter,
        '/analyticsPagePolicy.mjs': policy,
      };
      if (modules[path]) return route.fulfill({ contentType: 'text/javascript', body: modules[path] });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Managed bot assessment</title>
        <script>
          window.setTimeout(() => {
            window.grecaptcha = { enterprise: {
              ready(callback) { callback(); },
              execute(key, options) {
                window.executeCalls = (window.executeCalls || 0) + 1;
                return Promise.resolve('single-use-browser-token-123456789');
              }
            }};
          }, 75);
        </script>
        <script type="module">
          import { startPageBehaviorTracking } from '/behaviorAnalytics.js';
          startPageBehaviorTracking(location.pathname);
          window.ready = true;
        </script>` });
    });

    const page = await context.newPage();
    await page.goto('https://www.yuqi.site/');
    await page.waitForFunction(() => window.ready && window.executeCalls === 1);
    await page.waitForFunction(() => performance.getEntriesByType('resource').length >= 0);
    await page.waitForTimeout(50);
    const publicExecuteCalls = await page.evaluate(() => window.executeCalls);
    assert.equal(tracked.length, 1);
    assert.equal(tracked[0].event, 'page_view');
    assert.equal(tracked[0].recaptchaToken, 'single-use-browser-token-123456789');

    await page.goto('https://www.yuqi.site/admin/visitors');
    await page.waitForFunction(() => window.ready);
    await page.waitForTimeout(50);
    assert.equal(tracked.length, 1, 'private route must not emit analytics');
    assert.equal(await page.evaluate(() => window.executeCalls || 0), 0, 'private route must not execute risk SDK');
    assert.equal(publicExecuteCalls, 1);
    console.log(JSON.stringify({ width, tokenBound: true, privateRouteExcluded: true, passed: true }));
    await context.close();
  }
} finally {
  await browser.close();
}
