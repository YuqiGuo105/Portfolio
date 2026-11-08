import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const base = process.env.HEADER_TEST_URL || 'http://127.0.0.1:3140';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local preview only');
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const { chromium } = playwright.default || playwright;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const actions = ['search', 'notifications', 'theme', 'menu'];
const icon = { search: 'i', notifications: 'svg', theme: '.sw-after svg', menu: 'span' };
const styleOf = (locator, pseudo = null) => locator.evaluate((element, pseudo) => {
  const style = getComputedStyle(element, pseudo);
  return { animation: style.animationName, iterations: style.animationIterationCount,
    transform: style.transform, opacity: style.opacity, visibility: style.visibility,
    outline: style.outlineWidth, color: style.color, content: style.content };
}, pseudo);

try {
  for (const scenario of [
    { width: 1200 }, { width: 390, touch: true }, { width: 320, touch: true },
    { width: 1200, reduced: true }, { width: 1200, subscribed: true },
  ]) {
    const { width, touch = false, reduced = false, subscribed = false } = scenario;
    const context = await browser.newContext({ viewport: { width, height: 900 },
      hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await context.addInitScript(subscribed => {
      localStorage.setItem('ober-mood', 'day');
      localStorage.setItem('portfolioSubscriptionPrompt:v1', String(Date.now()));
      if (subscribed) localStorage.setItem('portfolioSubscriber:v1', JSON.stringify({
        subscriberId: 'header-fixture', subscriberToken: 'local-fixture-token',
      }));
    }, subscribed);
    let notificationRequests = 0, subscriptionRequests = 0;
    // Load public visual assets, but mock subscriptions, analytics and external APIs.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) {
        if (['stylesheet', 'font', 'image'].includes(route.request().resourceType())) return route.continue();
        return route.fulfill({ contentType: 'application/json', body: '[]' });
      }
      if (url.pathname === '/api/notifications') {
        notificationRequests++;
        return route.fulfill({ json: { unreadCount: 2, items: [] } });
      }
      if (url.pathname.includes('/subscribe')) subscriptionRequests++;
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?subscriptionPreview=0`, { waitUntil: 'domcontentloaded' });
    const nav = name => page.locator(`header [data-nav-action="${name}"]`);
    await nav('notifications').waitFor();
    await page.waitForLoadState('load');
    await page.locator('[data-preloader]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.locator('header.header').evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
    const bounds = await page.locator('header [data-nav-action]').evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    if (width === 1200) {
      assert.deepEqual(bounds.slice(1).map(({ width, height }) => [width, height]),
        [[34, 60], [25, 40], [25, 40]], 'Preserve original button sizes');
      for (let i = 1; i < bounds.length; i++) {
        assert.equal(bounds[i].x - bounds[i - 1].x - bounds[i - 1].width, 40, 'Keep original desktop spacing');
      }
    }
    const logo = page.getByRole('link', { name: 'Yuqi Guo home', exact: true });
    const logoImage = logo.locator('img');
    const logoBounds = await logo.boundingBox();
    assert.equal(await logo.getAttribute('href'), '/');
    assert.equal((await styleOf(logoImage)).animation, 'none', 'Logo stays still at rest');
    if (touch) await logo.focus();
    else await logo.hover();
    assert.equal((await styleOf(logoImage)).animation === 'none', reduced, 'Logo respects reduced motion');
    assert.equal((await styleOf(logoImage)).iterations, '1', 'Logo rotation does not loop');
    if (!reduced) {
      await page.waitForFunction(() => document.querySelector('header .logo img').getAnimations().some(animation => animation.currentTime > 220));
      assert.notEqual((await styleOf(logoImage)).transform, 'none', 'Logo actually rotates');
      if (width === 1200 && !subscribed) await page.locator('header.header').screenshot({ path: '/tmp/header-logo-turn.png' });
      await logoImage.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
      assert.equal((await styleOf(logoImage)).transform, 'none', 'Logo returns to the original orientation');
    }
    assert.deepEqual(await logo.boundingBox(), logoBounds, 'Logo link does not move or resize');
    await page.mouse.move(0, 500);
    await logo.focus();
    await page.keyboard.press('Tab');
    assert.equal(await nav('search').evaluate(element => document.activeElement === element), true);
    await nav('search').evaluate(element => element.blur());
    for (const [index, name] of actions.entries()) {
      const button = nav(name);
      const target = button.locator(icon[name]);
      const pseudo = name === 'menu' ? '::before' : null;
      assert.equal((await styleOf(target, pseudo)).animation, 'none', 'No idle animation');
      if (!touch) await button.hover();
      else await button.focus();
      const state = await styleOf(target, pseudo);
      assert.equal(state.animation === 'none', reduced, `${name}: motion preference respected`);
      assert.equal(state.iterations, '1', 'Never loop a hover animation');
      await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector), '::after').opacity === '1',
        `header [data-nav-action="${name}"]`);
      assert.equal((await styleOf(button, '::after')).visibility, 'visible');
      assert.deepEqual(await button.boundingBox(), bounds[index], 'Animation cannot shift the control');
      if (name === 'notifications') {
        await page.locator('header.header').screenshot({ path: `/tmp/header-hover-light-${width}${reduced ? '-reduced' : ''}${subscribed ? '-subscribed' : ''}.png` });
      }
      await page.mouse.move(0, 500);
      await button.evaluate(element => element.blur());
    }
    assert.equal(notificationRequests, subscribed ? 1 : 0, 'Hover makes no notification requests');
    await nav('search').focus();
    for (const name of actions) {
      assert.equal(await nav(name).evaluate(element => document.activeElement === element), true,
        'Header actions share a predictable keyboard order');
      assert.equal((await styleOf(nav(name))).outline, '2px');
      await page.keyboard.press('Tab');
    }
    await nav('search').click();
    await page.locator('[data-testid="search-panel"]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="search-panel"]').waitFor({ state: 'hidden' });
    await nav('notifications').click();
    if (!subscribed) await page.locator('#subscribe-title').waitFor();
    else {
      assert.equal(await nav('notifications').getAttribute('aria-expanded'), 'true');
      assert.equal(notificationRequests, 2);
    }
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(subscriptionRequests, 0);
    await nav('theme').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.classList.contains('dark-skin'));
    assert.equal(await nav('theme').getAttribute('aria-label'), 'Switch to light mode');
    await page.locator('header.header').screenshot({ path: `/tmp/header-hover-dark-${width}.png` });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.body.classList.contains('light-skin'));
    await nav('menu').focus();
    await page.keyboard.press('Enter');
    assert.equal(await nav('menu').getAttribute('aria-expanded'), 'true');
    await page.locator('.menu-full-overlay.is-open').waitFor();
    assert.equal((await styleOf(nav('menu').locator('span'), '::before')).animation, 'none', 'Do not animate the close icon');
    await page.waitForFunction(() => !document.querySelector('.menu-btn').classList.contains('no-touch'));
    await page.keyboard.press('Space');
    assert.equal(await nav('menu').getAttribute('aria-expanded'), 'false');
    await page.locator('.menu-full-overlay.visible').waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
    assert.deepEqual(errors, []);
    console.log(`PASS header: ${width}px, touch=${touch}, reduced=${reduced}, subscribed=${subscribed}`);
    await context.close();
  }
} finally {
  await browser.close();
}
