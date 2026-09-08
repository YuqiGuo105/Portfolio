import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3066';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
try {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/admin/users/me')) return route.fulfill({ json: { email: 'operator@example.com', role: 'ADMIN', permissions: ['admin.read'], owner: true } });
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: { user: { id: 'ui-test', email: 'operator@example.com' } } });
    if (url.pathname.includes('/rest/v1/')) return route.fulfill({ json: [] });
    if (url.pathname.includes('/api/admin/chat-conversations')) return route.fulfill({ json: { items: [
      { runId: 'fixture-complete', question: 'What did the agent answer?', answer: '## Recorded answer\n\nA **verified** response.\n\n- First result\n- Second result\n\n```js\nconst result = true;\n```\n\n$E = mc^2$\n\n<img src=x onerror=alert(1)>', status: 'completed', completedAt: '2026-09-07T12:00:00Z', steps: [{ type: 'retrieval.completed', detail: { returnedChunks: 2 } }] },
      { runId: 'fixture-missing', question: 'An older question', status: 'completed', completedAt: '2026-09-07T12:00:00Z' },
      { runId: 'fixture-running', question: 'A pending question', status: 'running' },
    ] } });
    if (url.pathname.includes('/api/admin/content')) return route.fulfill({ json: { items: Array.from({ length: 8 }, (_, i) => ({ id: i, title: `Test content ${i}`, status: 'PUBLISHED' })), total: 8 } });
    if (url.pathname.includes('/api/admin/') || url.pathname.startsWith('/api/')) return route.fulfill({ json: { items: [], total: url.pathname.includes('subscribers') ? 128 : url.pathname.includes('conversation') ? 12 : 36 } });
    return route.continue();
  });
  const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  const jwt = [{ alg: 'HS256', typ: 'JWT' }, { sub: 'ui-test', exp: Math.floor(Date.now() / 1000) + 3600 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.test-signature';
  await context.addInitScript(({ storageKey, jwt }) => localStorage.setItem(storageKey, JSON.stringify({ access_token: jwt, refresh_token: 'test-only', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: 'ui-test', email: 'operator@example.com' } })), { storageKey, jwt });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/admin`);
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 30000 });
  await page.locator('#admin-navigation img').evaluate(img => img.decode());
  await page.getByRole('link', { name: 'Create tech blogs', exact: true }).click({ trial: true });
  await page.screenshot({ path: '/private/tmp/admin-modern-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Operate console', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Operate console', exact: true }).waitFor();
  await page.getByText('Session details', { exact: true }).click();
  assert.ok(await page.getByText('operator@example.com', { exact: true }).last().isVisible());
  await page.getByText('Session details', { exact: true }).click();
  await page.getByRole('button', { name: 'check delivery stats', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Platform command' }).inputValue(), 'check delivery stats');
  assert.equal(await page.getByRole('button', { name: 'Send command', exact: true }).isEnabled(), true);
  await page.screenshot({ path: '/private/tmp/admin-modern-console.png', fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/admin`);
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `dashboard overflow at ${width}`);
    await page.screenshot({ path: `/private/tmp/admin-modern-${width}.png`, fullPage: true });
    const toggle = page.getByRole('button', { name: 'Open admin navigation' });
    await toggle.click();
    await page.getByRole('navigation', { name: 'Admin navigation' }).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await page.goto(`${origin}/admin/agent`);
    await page.getByRole('heading', { name: 'Operate console', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `console overflow at ${width}`);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/admin/conversations`);
    await page.getByRole('heading', { name: 'Recorded answer', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Final response', exact: true }).count(), 3);
    assert.ok(await page.getByText('No final response was saved for this run.', { exact: false }).isVisible());
    assert.ok(await page.getByText('The agent has not recorded a final response yet.', { exact: false }).isVisible());
    assert.ok(await page.locator('mjx-container').isVisible());
    assert.equal(await page.getByRole('heading', { name: 'Recorded answer' }).evaluate(el => getComputedStyle(el).color), 'rgb(39, 58, 52)');
    assert.equal(await page.locator('section[aria-label="Final response"] img').count(), 0);
    await page.getByText('Pipeline steps (1)', { exact: true }).click();
    assert.ok(await page.getByText('"returnedChunks": 2', { exact: false }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `conversation overflow at ${width}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/private/tmp/admin-conversations-${width}.png`, fullPage: true });
  }
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy final response', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /A \*\*verified\*\* response/);
  assert.deepEqual(errors, []);
  console.log('PASS: dashboard, console, desktop/tablet/mobile, navigation, command presets; mocked auth/data only.');
} finally { await browser.close(); }
