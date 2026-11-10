import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.ADMIN_PREVIEW_URL || 'http://127.0.0.1:3141';
const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://supabase-not-configured.invalid').hostname.split('.')[0]}-auth-token`;
const exp = Math.floor(Date.now() / 1000) + 3600;
const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: 'docs-ui-test', exp }]
  .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.test-signature';
const stylesheet = await readFile(require.resolve('swagger-ui-dist/swagger-ui.css'), 'utf8');
const output = new URL('../test-artifacts/admin-docs/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const spec = { openapi: '3.0.1', info: { title: 'Protected API fixture', version: 'test' },
  tags: [{ name: 'Admin Indexing Jobs', description: 'List and retry failed RAG and search indexing jobs after reviewing their errors.' }], paths: {
  '/api/admin/indexing-jobs/{jobId}/status': { get: { tags: ['Admin Indexing Jobs'], summary: 'List indexing jobs', responses: { 200: { description: 'Success' } } } },
} };

for (const [name, engine, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await engine.launch({ ...options, headless: true });
  try {
    for (const width of [1280, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(({ storageKey, token, exp }) => localStorage.setItem(storageKey, JSON.stringify({
        access_token: token, refresh_token: 'fixture-only', expires_at: exp, token_type: 'bearer',
        user: { id: 'docs-ui-test', email: 'admin@example.test' },
      })), { storageKey, token, exp });
      let docsStatus = 200, docsRequests = 0;
      const unexpected = [], errors = [];
      // Synthetic auth and OpenAPI are confined to this browser. No real credentials or operations.
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.endsWith('/api/admin/users/me')) return route.fulfill({ json: {
          email: 'admin@example.test', role: 'ADMIN', owner: true, permissions: ['admin.read'],
        } });
        if (url.pathname === '/api/admin/api-docs') {
          docsRequests++;
          assert.equal(request.headers().authorization, `Bearer ${token}`);
          assert.equal(request.method(), 'GET');
          return route.fulfill({ status: docsStatus, json: docsStatus === 200 ? { spec, stylesheet } : { error: 'forbidden' } });
        }
        if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: {} });
        if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
        if (url.origin === base && (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/assets/') || ['/favicon.ico', '/manifest.webmanifest'].includes(url.pathname))) return route.continue();
        unexpected.push(request.url());
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/admin/jobs`);
      await page.getByRole('link', { name: 'Open Admin API', exact: true }).click();
      await page.locator('.swagger-ui .opblock-summary-method').waitFor({ timeout: 60000 });
      const description = await page.locator('.swagger-ui .opblock-tag small').boundingBox();
      assert.ok(description.width > 200, 'Group description must not collapse into a narrow column');
      assert.ok(description.height < 100, 'Group description should wrap into a few readable lines');
      await page.getByText('List indexing jobs', { exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Try it out', exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.equal(docsRequests, 1);
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
      docsStatus = 403;
      await page.reload();
      await page.getByText('An active administrator session is required.', { exact: true }).waitFor();
      assert.equal(await page.locator('.swagger-ui').count(), 0);
      docsStatus = 200;
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.locator('.swagger-ui .opblock-summary-method').waitFor();
      if (width < 881) await page.getByRole('button', { name: 'Open admin navigation' }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForURL('**/admin/login**');
      assert.equal(await page.locator('.swagger-ui').count(), 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpected, []);
      console.log(`PASS ${name}/${width}: signed-in viewer, permission denial, retry, logout, no execution or external requests`);
      await context.close();
    }
    const anonymous = await browser.newContext();
    const res = await anonymous.request.get(`${base}/api/admin/api-docs`);
    assert.equal(res.status(), 401);
    assert.match(res.headers()['cache-control'], /no-store/);
    assert.equal((await res.json()).spec, undefined);
    await anonymous.close();
    console.log(`PASS ${name}: actual local documentation API denies anonymous requests`);
  } finally { await browser.close(); }
}
