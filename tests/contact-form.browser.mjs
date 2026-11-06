import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createContactHandler } from '../src/lib/contactGuard.mjs';

const base = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:3140';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local preview only');
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const { chromium } = playwright.default || playwright;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const widgetScript = `window.turnstile = {
  render(container, options) {
    window.testVerification = options;
    container.innerHTML = '<div data-test-verification style="height:65px;max-width:100%;border:1px solid #b6c7c1;padding:16px;box-sizing:border-box">Verification fixture</div>';
    return 'fixture';
  },
  remove() { document.querySelector('[data-test-verification]')?.remove(); }
};`;

try {
  // Exercise the real Next route without SMTP credentials or a valid challenge.
  const rejected = await fetch(`${base}/api/contact`, {
    method: 'POST', headers: { origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'fixture@example.com', message: 'Local test' }),
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).code, 'verification_required');

  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('portfolioSubscriptionPrompt:v1', String(Date.now())));
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => console.log('Preview error:', error.message));
    let scriptLoads = 0, requests = 0, delivered = 0, mode = 'valid', release;
    const used = new Set();
    const handler = createContactHandler({
      env: { NODE_ENV: 'development', TURNSTILE_SECRET_KEY: 'fixture-secret' },
      isRateLimited: async () => false,
      fetchImpl: async (_url, options) => {
        const token = JSON.parse(options.body).response;
        if (mode === 'outage') throw new Error('Fixture provider unavailable');
        if (mode === 'invalid' || used.has(token)) return Response.json({ success: false });
        used.add(token);
        return Response.json({ success: true, hostname: 'www.yuqi.site', action: 'contact_submit', challenge_ts: new Date().toISOString() });
      },
      sendMail: async () => { if (mode === 'slow') await new Promise(resolve => { release = resolve; }); delivered++; },
      audit: () => {},
    });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname === 'challenges.cloudflare.com') {
        scriptLoads++;
        return route.fulfill({ contentType: 'application/javascript', body: widgetScript });
      }
      if (url.origin !== base) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (url.pathname === '/api/contact') {
        requests++;
        const headers = {};
        const response = { statusCode: 200, setHeader(key, value) { headers[key] = value; },
          status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
        await handler({ method: req.method(), headers: { ...req.headers(), host: new URL(base).host }, body: req.postDataJSON(), socket: { remoteAddress: '127.0.0.1' } }, response);
        return route.fulfill({ status: response.statusCode, headers, contentType: 'application/json', body: JSON.stringify(response.body) });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    await page.goto(`${base}/?subscriptionPreview=0`, { waitUntil: 'domcontentloaded' });
    const form = page.locator('#contact-section form');
    await form.waitFor();
    assert.equal(scriptLoads, 0, 'Challenge must not load at the top of the page');
    await form.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.testVerification);
    const name = form.getByLabel('Name', { exact: true });
    const email = form.getByLabel('Email Address', { exact: true });
    const message = form.locator('textarea[name="message"]');
    const submit = form.getByRole('button', { name: 'Submit', exact: true });
    await name.fill('Local visitor');
    await email.fill('fixture@example.com');
    await message.fill('Please keep this message after a failed verification.');
    await submit.click();
    assert.equal(requests, 0, 'Do not submit without a token');
    await form.getByRole('alert').filter({ hasText: 'complete the verification' }).waitFor();

    const token = async value => page.evaluate(value => window.testVerification.callback(value), value);
    mode = 'invalid'; await token('invalid'); await submit.click();
    await form.getByRole('alert').filter({ hasText: 'expired or failed' }).waitFor();
    assert.equal(await name.inputValue(), 'Local visitor');
    assert.equal(delivered, 0);
    mode = 'outage'; await token('outage'); await submit.click();
    await form.getByRole('alert').filter({ hasText: 'temporarily unavailable' }).waitFor();
    console.log(`${width}px: invalid token and outage rejected`);
    assert.ok((await message.inputValue()).startsWith('Please keep'));
    assert.equal(delivered, 0);

    await token('expired');
    await page.evaluate(() => window.testVerification['expired-callback']());
    const before = requests; await submit.click();
    assert.equal(requests, before, 'Expired token cannot be submitted');
    await page.evaluate(() => window.testVerification['error-callback']());
    await form.getByRole('button', { name: 'Retry verification' }).click();
    await page.locator('[data-test-verification]').waitFor();

    mode = 'slow'; await token('fresh'); await submit.click();
    await page.waitForFunction(() => document.querySelector('#contact-section form').getAttribute('aria-busy') === 'true');
    assert.equal(await form.getByRole('button', { name: 'Sending...' }).isDisabled(), true);
    await form.evaluate(element => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const deadline = Date.now() + 5000;
    while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(release, 'Valid request must reach the mail sink');
    assert.equal(requests, before + 1, 'In-flight submit must not be duplicated');
    release();
    await page.getByText('Thanks, your message has been sent successfully.').waitFor();
    assert.equal(delivered, 1);
    assert.equal(await message.inputValue(), '');
    assert.equal(scriptLoads, 1, 'Reuse the challenge script after resets');

    await form.scrollIntoViewIfNeeded();
    const overflow = await form.evaluate(element => {
      const box = element.getBoundingClientRect();
      return [...element.querySelectorAll('input:not([name="website"]),textarea,[data-test-verification]')]
        .some(node => node.getBoundingClientRect().right > Math.min(innerWidth, box.right) + 1);
    });
    assert.equal(overflow, false, `No contact field overflow at ${width}px`);
    await page.locator('#contact-section').screenshot({ path: `/tmp/contact-guard-${width}.png` });
    console.log(`${width}px: lazy loading, failed/expired verification, retry, preserved input, duplicate prevention and successful submit passed`);
    await context.close();
  }
} finally { await browser.close(); }
