// Layout and navigation only. External traffic is blocked and no message is submitted.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const base = process.env.TALK_TEST_URL || 'http://127.0.0.1:3148';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      localStorage.setItem('portfolioSubscriptionPrompt:v1', String(Date.now()));
      localStorage.setItem('ober-mood', 'day');
    });
    const writes = [];
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (!['GET', 'HEAD'].includes(req.method())) { writes.push(url.pathname); return route.abort(); }
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?subscriptionPreview=0`, { waitUntil: 'domcontentloaded' });
    const section = page.locator('#contact-section');
    await section.scrollIntoViewIfNeeded();
    assert.equal(await section.locator('.m-titles > #tour-contact').textContent(), 'Contact Me');
    assert.equal(await section.locator('.contact-details .numbers-item').count(), 3);
    assert.equal(await section.locator('.vertical-line.contact-form-column').count(), 1);
    const tabs = section.getByRole('tab');
    assert.equal(await tabs.count(), 2);
    const form = section.locator('form');
    const name = form.getByLabel('Name', { exact: true });
    await name.fill('Layout preview');
    await form.getByLabel('Email Address', { exact: true }).fill('layout@example.com');
    await form.locator('textarea[name="message"]').fill('Keep this draft when switching tabs.');
    for (const theme of ['light', 'dark']) {
      if (await page.locator('body').evaluate(node => node.classList.contains('dark-skin')) !== (theme === 'dark')) await page.locator('.switcher-btn').click();
      await page.waitForFunction(theme => getComputedStyle(document.querySelector('#contact-section')).backgroundColor
        === (theme === 'dark' ? 'rgb(24, 30, 39)' : 'rgb(235, 231, 224)'), theme);
      const boxes = await tabs.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, height: rect.height, width: rect.width };
      }));
      assert.ok(boxes.every(box => Math.abs(box.top - boxes[0].top) < 1 && box.height >= 44), 'two tabs share a touch-friendly row');
      const fields = await form.evaluate(node => ['name', 'email'].map(field => {
        const rect = node.querySelector(`input[name="${field}"]`).getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
      }));
      assert.ok(fields[1].top >= fields[0].bottom, 'original single-column form is unchanged');
      const overflow = await section.evaluate(node => [...node.querySelectorAll('a,input:not([name="website"]),textarea,[role="tab"],button')].filter(el => el.getClientRects().length)
        .some(el => { const rect = el.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1; }));
      assert.equal(overflow, false, `${theme} ${width}px: contact controls stay on screen`);
      await section.screenshot({ path: `/tmp/contact-layout-${theme}-${width}.png` });
    }
    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
    assert.equal(await tabs.nth(1).evaluate(node => node === document.activeElement), true);
    await section.getByRole('link', { name: 'Request a referral', exact: true }).waitFor();
    const live = section.getByRole('link', { name: 'Open TalkNest' });
    assert.equal(await live.getAttribute('target'), '_blank');
    assert.equal(await live.getAttribute('rel'), 'noopener noreferrer');
    await tabs.nth(0).click();
    assert.equal(await name.inputValue(), 'Layout preview');
    assert.equal(await form.locator('textarea[name="message"]').inputValue(), 'Keep this draft when switching tabs.');
    assert.deepEqual(writes, [], 'layout and navigation send no data');
    assert.deepEqual(errors, []);
    console.log(`${width}px: both themes, field layout, tabs, keyboard, draft retention and safe links passed`);
    await context.close();
  }
} finally { await browser.close(); }
