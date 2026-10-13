import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.OAUTH_PREVIEW_URL || 'http://127.0.0.1:3113';
const output = new URL('../test-artifacts/oauth-consent/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const callback = 'http://127.0.0.1:61631/callback/test-only?code=test-code&state=test-state';
const user = { id: 'test-user', email: 'admin@example.test', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: user.id, exp: expires, aud: 'authenticated' })).toString('base64url'), 'test-signature'].join('.');
try {
  for (const [width, clientName] of [[1440, 'Codex'], [390, 'Claude'], [320, 'Cursor'], [390, undefined], [320, 'CustomClientWithAVeryLongNameForMobileLayout']]) {
    const displayName = clientName || 'your AI client';
    const screenshotName = `${width}-${clientName || 'generic'}`;
    const context = await browser.newContext({ viewport: { width, height: 920 } });
    await context.addInitScript(({ user, token, expires }) => localStorage.setItem('sb-oauth-preview-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'test-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user,
    })), { user, token, expires });
    const page = await context.newPage();
    const errors = [];
    let decisions = 0, callbacks = 0, mode = 'ready';
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.port === '61631') {
        callbacks++;
        assert.equal(url.searchParams.get('state'), 'test-state');
        return route.fulfill({ contentType: 'text/plain', body: 'Mock client callback received.' });
      }
      if (url.pathname.endsWith('/api/admin/users/me')) return route.fulfill({ json: { email: user.email, role: 'ADMIN', permissions: ['admin.read'] } });
      if (url.hostname === 'oauth-preview.example.test') {
        if (url.pathname.endsWith('/consent')) {
          decisions++;
          return route.fulfill({ json: { redirect_url: mode === 'deny' ? callback.replace('code=test-code', 'error=access_denied') : callback } });
        }
        if (url.pathname.includes('/oauth/authorizations/')) {
          return mode === 'expired'
            ? route.fulfill({ status: 404, json: { code: 'authorization_not_found', message: 'authorization not found' } })
            : route.fulfill({ json: { authorization_id: 'test-request', client: { name: clientName }, scope: 'openid email profile', user } });
        }
        return route.fulfill({ json: user });
      }
      if (url.origin !== base) return route.abort();
      return route.continue();
    });
    await page.goto(`${base}/oauth/consent?authorization_id=test-request`);
    await page.getByRole('button', { name: 'Allow access', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByText(displayName, { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/${screenshotName}-consent.png`, fullPage: true });
    await page.getByRole('button', { name: 'Allow access', exact: true }).click();
    await page.getByRole('heading', { name: 'Authorization approved', exact: true }).waitFor();
    assert.equal(decisions, 1);
    assert.equal(callbacks, 0, 'Approval must not claim a completed client token exchange');
    assert.ok(await page.getByText(/only when your app confirms/).isVisible());
    assert.equal(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const button = page.getByRole('button', { name: `Return to ${displayName}`, exact: true });
    const box = await button.boundingBox();
    assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width);
    await page.screenshot({ path: `${output}/${screenshotName}-approved.png`, fullPage: true });
    await button.click();
    await page.getByText('Mock client callback received.').waitFor();
    assert.equal(callbacks, 1);

    mode = 'expired';
    await page.goto(`${base}/oauth/consent?authorization_id=test-request`);
    await page.getByRole('alert').getByText('Connection request expired', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Allow access' }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    mode = 'deny';
    await page.reload();
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    await page.getByText('Mock client callback received.').waitFor();
    assert.equal(callbacks, 2);
    assert.equal(new URL(page.url()).searchParams.get('error'), 'access_denied');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px ${displayName}: approve, handoff, deny, expired request, no overflow`);
  }
} finally { await browser.close(); }
