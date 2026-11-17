// Local preview only; badge checks below are fictional and stored in memory, never in production.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const base = process.env.TALK_TEST_URL || 'http://127.0.0.1:3148';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/admin/referrals-preview`, { waitUntil: 'domcontentloaded' });
    const row = name => page.getByRole('button', { name: new RegExp(`^${name}`) });
    await row('Daniel Okafor').waitFor();
    assert.match(await row('Maya Lin').innerText(), /Pass · 86\/100/);
    assert.match(await row('Alex Park').innerText(), /Pass · 88\/100/);
    assert.match(await row('Project Collector').innerText(), /Below threshold · 32\/100/);
    assert.match(await row('Daniel Okafor').innerText(), /Pending badge check · 59\/100/);
    await row('Daniel Okafor').click();
    await page.locator('summary').filter({ hasText: 'Official LinkedIn badge' }).click();
    const note = page.getByLabel('Badge type and what you checked');
    assert.equal(await page.getByRole('button', { name: 'Confirm official badge' }).isDisabled(), true);
    await note.fill('Fictional local test: checked the official identity badge on this sample profile.');
    const result = page.waitForResponse(response => response.url() === `${base}/api/referral/preview` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirm official badge' }).click();
    const saved = await (await result).json();
    assert.equal(saved.screening.score, 84); assert.equal(saved.screening.passed, true);
    assert.equal(saved.screening.linkedinBadge.checkedBy, 'local-preview'); assert.equal(saved.status, 'new');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent.startsWith('Daniel Okafor') && node.textContent.includes('Pass · 84/100')));
    await note.fill('Fictional local test: resetting the sample badge to unconfirmed.');
    await page.getByRole('button', { name: 'Badge not verified' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent.startsWith('Daniel Okafor') && node.textContent.includes('Pending badge check · 59/100')));
    await page.getByLabel('Sort by').selectOption('score');
    const first = page.locator('button[aria-expanded]').first();
    assert.match(await first.innerText(), /Alex Park/);
    await first.click();
    await page.locator('summary').filter({ hasText: 'Strong LeetCode contest performance' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `no overflow at ${width}px`);
    await page.screenshot({ path: `/tmp/referral-evidence-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`${width}px: three paths, badge gate, owner confirmation/reset, score sorting and layout passed`);
    await context.close();
  }
} finally { await browser.close(); }
