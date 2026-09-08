import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { isPrivateAnalyticsPage, isPrivateAnalyticsEvent } from '../src/lib/analyticsPagePolicy.mjs';

test('operator routes, including localized and encoded URLs, are excluded', () => {
  for (const path of ['/admin', '/admin/visitors?hours=24', '/zh-CN/admin/login', '/en/oauth/consent', '/auth/callback', '/api/admin/users/me', '/%61dmin/jobs', 'https://www.yuqi.site/admin/agent']) {
    assert.equal(isPrivateAnalyticsPage(path), true, path);
  }
  for (const path of ['/', '/en', '/blogs', '/analytics', '/blog-single/admin-guide', '/administrator', '/mcp-guide']) {
    assert.equal(isPrivateAnalyticsPage(path), false, path);
  }
  assert.equal(isPrivateAnalyticsEvent({ page: '/' }, 'https://www.yuqi.site/admin'), true);
  assert.equal(isPrivateAnalyticsEvent({ page: '/blogs', target: '/admin' }), false);
});

test('both ingestion endpoints ignore admin events before rate limiting or storage', async () => {
  for (const endpoint of ['track', 'click']) {
    const source = await readFile(new URL(`../pages/api/${endpoint}.js`, import.meta.url), 'utf8');
    const dependencies = `
      const supabaseServer = { from() { throw new Error('Storage must not run'); } };
      const produceRawEvent = () => { throw new Error('Kafka must not run'); };
      const isRateLimited = () => { throw new Error('Rate limiter must not run'); };
      const uuidv7 = () => 'test';
      const isLocalAnalyticsRequest = () => false;
      const isLocalAnalyticsEvent = () => false;
      const isPrivateAnalyticsPage = ${isPrivateAnalyticsPage.toString()};
      const PRIVATE_ROUTE = /^\\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*\\/)?(?:admin|auth|oauth|api)(?:\\/|$)/i;
      const isPrivateAnalyticsEvent = ${isPrivateAnalyticsEvent.toString()};
    `;
    const module = await import(`data:text/javascript;base64,${Buffer.from(dependencies + source.replace(/^import .+;\r?$/gm, '')).toString('base64')}`);
    for (const [page, referer] of [['/admin', 'https://www.yuqi.site/'], ['/zh/admin/jobs', ''], ['/', 'https://www.yuqi.site/admin']]) {
      const response = { statusCode: null, status(code) { this.statusCode = code; return this; }, end() {}, json() {} };
      await module.default({ method: 'POST', headers: { referer }, body: { page, event: 'page_view' } }, response);
      assert.equal(response.statusCode, 204, `${endpoint} ${page}`);
    }
  }
});

test('browser tracking excludes admin navigation without creating session data', async () => {
  const source = await readFile(new URL('../src/lib/behaviorAnalytics.js', import.meta.url), 'utf8');
  const prefix = `const isBrowserAnalyticsDisabled = () => false;
    const PRIVATE_ROUTE = /^\\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*\\/)?(?:admin|auth|oauth|api)(?:\\/|$)/i;
    const isPrivateAnalyticsPage = ${isPrivateAnalyticsPage.toString()};`;
  const module = await import(`data:text/javascript;base64,${Buffer.from(prefix + source.replace(/^import .+;\r?$/gm, '')).toString('base64')}`);
  globalThis.window = { location: { href: 'https://www.yuqi.site/admin/visitors', hostname: 'www.yuqi.site' } };
  try {
    assert.equal(module.trackBehavior('page_view'), false);
    assert.doesNotThrow(() => module.startPageBehaviorTracking('/admin')());
  } finally { delete globalThis.window; }
});
