import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const requests = [];
const pending = new Set();
const fixtureToken = 'a'.repeat(64);
const fixtureUnsubscribe = 'v1.00000000-0000-0000-0000-000000000001.' + 'b'.repeat(64);
const upstream = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  requests.push({ method: req.method, url: req.url, body, internal: req.headers['x-internal-token'] });
  res.setHeader('Content-Type', 'application/json');
  if (req.headers['x-internal-token'] !== 'test-only-internal') {
    res.statusCode = 401; res.end('{}'); return;
  }
  if (req.url === '/api/subscriptions/confirm' && pending.delete(body.token)) {
    res.end(JSON.stringify({ subscriberId: 'test-subscriber', subscriberToken: 'test-management-token', channels: ['EMAIL'] }));
  } else if (req.url === '/api/subscriptions/unsubscribe' && body.token === fixtureUnsubscribe) {
    res.end(JSON.stringify({ unsubscribed: true }));
  } else { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid_token' })); }
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let output = '';
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only-placeholder', SUPABASE_SERVICE_ROLE_KEY: 'test-only-placeholder',
    NOTIFICATION_SERVICE_URL: `http://127.0.0.1:${upstream.address().port}`, NOTIFICATION_SERVICE_TOKEN: 'test-only-internal' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stdout.on('data', chunk => { output = (output + chunk).slice(-10000); });
app.stderr.on('data', chunk => { output = (output + chunk).slice(-10000); });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw new Error('Preview exited: ' + output);
    if (await fetch(origin + '/subscriptions/confirm').then(r => r.ok).catch(() => false)) break;
    if (i === 99) throw new Error('Preview did not start: ' + output);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await mkdir('test-artifacts/subscription-security', { recursive: true });
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce' });
    context.setDefaultTimeout(10000);
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
    const network = [];
    page.on('request', req => network.push(req.url()));
    pending.add(fixtureToken);
    const before = requests.length;
    await page.goto(`${origin}/subscriptions/confirm#token=${fixtureToken}`);
    try { await page.waitForFunction(() => !location.hash, null, { timeout: 10000 }); }
    catch (error) {
      await page.screenshot({ path: `test-artifacts/subscription-security/failure-${width}.png`, fullPage: true });
      console.error('Server:', output, 'Page:', await page.locator('body').innerText());
      throw error;
    }
    assert.equal(requests.length, before, 'Opening the email link must not activate a subscription.');
    assert.equal(await page.evaluate(() => localStorage.getItem('portfolioSubscriber:v1')), null);
    assert.ok(network.every(url => !url.includes(fixtureToken)), 'The confirmation token stays out of request URLs.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `test-artifacts/subscription-security/confirm-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Confirm subscription', exact: true }).click();
    await page.getByRole('heading', { name: 'Subscription confirmed' }).waitFor();
    const confirmation = requests.at(-1);
    assert.equal(confirmation.url, '/api/subscriptions/confirm');
    assert.equal(confirmation.method, 'POST');
    assert.deepEqual(confirmation.body, { token: fixtureToken });
    assert.equal(confirmation.internal, 'test-only-internal');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('portfolioSubscriber:v1')).subscriberToken), 'test-management-token');
    console.log(`${width}px: confirmation proxy and credential storage passed.`);
    await page.goto('about:blank');
    await page.goto(`${origin}/subscriptions/confirm#token=${fixtureToken}`);
    await page.getByRole('button', { name: 'Confirm subscription', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'already used' }).waitFor();
    const beforeUnsubscribe = requests.length;
    await page.goto(`${origin}/api/subscriptions/email-unsubscribe?token=${fixtureUnsubscribe}`);
    await page.waitForFunction(() => !location.hash);
    assert.equal(requests.length, beforeUnsubscribe, 'Mail-scanner GET must not unsubscribe.');
    await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
    await page.getByRole('heading', { name: 'You are unsubscribed' }).waitFor();
    assert.equal(requests.at(-1).url, '/api/subscriptions/unsubscribe');
    assert.deepEqual(requests.at(-1).body, { token: fixtureUnsubscribe });
    await page.screenshot({ path: `test-artifacts/subscription-security/unsubscribe-${width}.png`, fullPage: true });
    await page.goto(`${origin}/subscriptions/confirm`);
    assert.equal(await page.getByRole('button', { name: 'Confirm subscription', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${width}px: real browser -> Next.js proxy -> fixture service -> UI passed; no external messages.`);
  }
} finally {
  await browser?.close();
  if (app.exitCode === null) { app.kill('SIGTERM'); await once(app, 'exit'); }
  await new Promise(resolve => upstream.close(resolve));
}
