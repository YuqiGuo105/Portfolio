import assert from 'node:assert/strict';

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3105';
const browser = process.env.TEST_BROWSER === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [];
async function openPage({ width = 1440, height = 1000, subscriber = false, dark = false, preview = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: width < 520, hasTouch: width < 520 });
  contexts.push(context);
  await context.addInitScript(({ subscriber, dark }) => {
    localStorage.setItem('ober-mood', dark ? 'night' : 'day');
    if (subscriber) localStorage.setItem('portfolioSubscriber:v1', JSON.stringify({
      subscriberId: 'browser-test-only', subscriberToken: 'browser-test-only',
    }));
  }, { subscriber, dark });
  let submissions = 0;
  await context.route('**/api/track', route => route.fulfill({ status: 204 }));
  await context.route('**/api/click', route => route.fulfill({ status: 204 }));
  await context.route('**/api/push/config', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await context.route('**/api/subscriptions', route => {
    submissions++;
    return route.fulfill({ json: { subscriberId: 'browser-test-only', subscriberToken: 'browser-test-only' } });
  });
  await context.route('**/api/notifications?*', route => route.fulfill({ json: { items: [], unreadCount: 0 } }));
  const page = await context.newPage();
  // Exercise production cooldown locally unless a case explicitly tests preview.
  await page.goto(preview ? origin : `${origin}/?subscriptionPreview=0`, { waitUntil: 'domcontentloaded' });
  await page.locator('.header').waitFor();
  if (dark && !await page.locator('body').evaluate(el => el.classList.contains('dark-skin'))) {
    await page.locator('.switcher-btn').click();
    await page.locator('body.dark-skin').waitFor();
  }
  return { page, context, get submissions() { return submissions; } };
}

async function scrollToBackground(page, viewportFraction = 0.65) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#tour-background').evaluate((heading, fraction) => window.scrollTo({
    top: window.scrollY + heading.getBoundingClientRect().top - window.innerHeight * fraction, behavior: 'instant',
  }), viewportFraction);
}

async function checkBounds(page) {
  const panel = page.getByRole('dialog', { name: 'Stay in the loop?' });
  const box = await panel.boundingBox(), viewport = page.viewportSize();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1);
  assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
  assert.equal(await panel.locator('form').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
  assert.equal(await panel.evaluate(el => document.activeElement === el), true);
  assert.equal(await panel.getByRole('button', { name: 'Subscribe', exact: true }).evaluate(el =>
    getComputedStyle(el, '::before').display), 'none');
  assert.equal(await page.locator('#__chat_widget_root').evaluate(el => getComputedStyle(el).display), 'none');
  assert.equal(await page.locator('#__chat_widget_root .launch-button').isVisible(), false);
  const submit = await panel.getByRole('button', { name: 'Subscribe', exact: true }).boundingBox();
  assert.ok(submit.y >= 0 && submit.y + submit.height <= viewport.height + 1, 'Submit stays within the viewport');
  assert.ok(submit.height >= 44, 'Touch target is at least 44px');
  assert.equal(await panel.getByLabel('Email', { exact: true }).evaluate(el => getComputedStyle(el).fontSize), '16px');
  return panel;
}

try {
  const timed = await openPage();
  await timed.page.getByRole('button', { name: 'Subscribe to notifications' }).waitFor();
  await timed.page.getByRole('dialog', { name: 'Stay in the loop?' }).waitFor({ timeout: 22000 });
  assert.equal(await timed.page.evaluate(() => window.scrollY), 0);
  assert.equal(timed.submissions, 0);
  await checkBounds(timed.page);
  await timed.page.screenshot({ path: '/private/tmp/subscription-invitation-desktop.png' });
  await timed.page.getByRole('button', { name: 'Not now', exact: true }).click();
  assert.equal(await timed.page.locator('[role="dialog"]').count(), 0);
  await timed.page.reload({ waitUntil: 'domcontentloaded' });
  await scrollToBackground(timed.page);
  await timed.page.waitForTimeout(17_000);
  assert.equal(await timed.page.locator('[role="dialog"]').count(), 0);
  // Cooldown never disables the visitor's explicit choice to subscribe.
  await timed.page.getByRole('button', { name: 'Subscribe to notifications' }).click();
  await timed.page.getByRole('dialog', { name: 'Subscribe to updates' }).waitFor();
  await timed.page.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('Desktop: time-only trigger, dismissal, reload cooldown and manual opening passed.');

  for (const [width, height, dark] of [[1440, 900, false], [390, 844, false], [320, 568, true]]) {
    const scrolled = await openPage({ width, height, dark });
    await scrolled.page.getByRole('button', { name: 'Subscribe to notifications' }).waitFor();
    const started = Date.now();
    await scrolled.page.evaluate(() => document.fonts.ready);
    await scrolled.page.locator('#tour-background').evaluate(heading => window.scrollTo({
      top: Math.max(0, Math.min(window.scrollY + heading.getBoundingClientRect().top - innerHeight * .75,
        (document.documentElement.scrollHeight - innerHeight) * .25) - 250), behavior: 'instant',
    }));
    await scrolled.page.waitForTimeout(2200);
    assert.equal(await scrolled.page.locator('[role="dialog"]').count(), 0);
    await scrolled.page.evaluate(() => window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * .251, behavior: 'instant' }));
    await scrolled.page.getByRole('dialog', { name: 'Stay in the loop?' }).waitFor({ timeout: 8000 });
    assert.ok(Date.now() - started < 15_000);
    assert.equal(scrolled.submissions, 0);
    const dialog = await checkBounds(scrolled.page);
    if (dark) assert.equal(await scrolled.page.locator('body').evaluate(el => el.classList.contains('dark-skin')), true);
    await scrolled.page.screenshot({ path: `/private/tmp/subscription-invitation-${width}-${dark ? 'dark' : 'light'}.png` });
    if (dark) {
      await scrolled.page.setViewportSize({ width, height: 350 });
      await scrolled.page.waitForTimeout(300);
      await checkBounds(scrolled.page);
      await scrolled.page.screenshot({ path: '/private/tmp/subscription-invitation-short-viewport.png' });
      await scrolled.page.keyboard.press('Escape');
      assert.equal(await scrolled.page.locator('[role="dialog"]').count(), 0);
    } else {
      await dialog.getByLabel('Email', { exact: true }).fill('reader@example.com');
      await dialog.getByRole('button', { name: 'Subscribe', exact: true }).click();
      await dialog.getByRole('button', { name: 'Done', exact: true }).waitFor();
      assert.equal(scrolled.submissions, 1);
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    }
    console.log(`Viewport ${width}: 25% trigger, fixed actions, ${dark ? 'short viewport, dark theme and Escape' : 'explicit mocked subscription'} passed.`);
  }

  const subscribed = await openPage({ subscriber: true });
  await scrollToBackground(subscribed.page);
  await subscribed.page.waitForTimeout(17_000);
  assert.equal(await subscribed.page.locator('[role="dialog"]').count(), 0);
  assert.equal(subscribed.submissions, 0);
  console.log('Existing subscriber: neither trigger shows an invitation. No real subscriptions or emails were sent.');

  if (!process.env.TEST_PRODUCTION) {
    const local = await openPage({ width: 390, preview: true });
    await scrollToBackground(local.page);
    await local.page.getByRole('dialog', { name: 'Stay in the loop?' }).waitFor();
    await local.page.getByRole('button', { name: 'Not now', exact: true }).click();
    await local.page.reload({ waitUntil: 'domcontentloaded' });
    await scrollToBackground(local.page);
    await local.page.getByRole('dialog', { name: 'Stay in the loop?' }).waitFor();
    assert.equal(local.submissions, 0);
    console.log('Default local homepage repeats after reload despite existing cooldown.');
  }
} catch (error) {
  for (const context of contexts) {
    for (const page of context.pages()) {
      console.error('Prompt diagnostics:', await page.evaluate(() => ({
        url: location.href, hidden: document.hidden, scrollY,
        active: document.activeElement?.tagName, bodyOverflow: document.body.style.overflow,
        cooldown: localStorage.getItem('portfolioSubscriptionPrompt:v1'),
        subscribed: Boolean(localStorage.getItem('portfolioSubscriber:v1')),
        blockers: [...document.querySelectorAll('[role="dialog"], .menu-full-overlay.is-open, .bot-container, .st-roaming-pet')].map(el => ({
          className: el.className, display: getComputedStyle(el).display, text: el.textContent.slice(0, 100),
        })),
      })).catch(() => 'Page unavailable'));
    }
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
