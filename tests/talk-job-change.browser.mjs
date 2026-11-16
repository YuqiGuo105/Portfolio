// Browser walk-through of a job change against a freshly started local preview (`npm run dev:talk`):
//   PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.js node tests/talk-job-change.browser.mjs
// It records a change of employer on the preview's in-memory work history and checks that the
// referral form, the home page, structured data and the review list follow it, then pauses and
// closes the form. Restart the preview afterwards: it leaves the made-up history changed.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const base = process.env.TALK_TEST_URL || 'http://127.0.0.1:3147';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local preview only');
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const { chromium } = playwright.default || playwright;
const shots = process.env.TALK_TEST_SHOTS || '';

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.route(/challenges\.cloudflare\.com|google\.com\/recaptcha|gstatic|googletagmanager|placeholder\.supabase\.co/, route => route.abort());
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const open = async path => { await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' }); };
const referralHeading = () => page.locator('#referral-step-title');
const worksFor = () => page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map(node => JSON.parse(node.textContent))
  .map(entry => entry.mainEntity?.worksFor?.name).find(Boolean) || null);

try {
  // Before: everything names the employer the preview started with.
  await open('/talk?intent=referral');
  await referralHeading().waitFor();
  const before = (await referralHeading().textContent()).replace('Which role at ', '').replace('?', '');
  assert.ok(before && before !== 'Northwind Labs', `the preview starts at another employer (${before})`);
  await open('/');
  assert.equal(await worksFor(), before);
  assert.match(await page.locator('.description p').first().textContent(), new RegExp(`at ${before}`));

  // Record the change in one place.
  await open('/admin/experience-preview');
  await page.getByText(`Current employer: `).waitFor();
  await page.getByLabel(`Last month at ${before}`).fill('march 2027');
  await page.getByLabel('New company').fill('Northwind Labs');
  await page.getByLabel('Title there').fill('Senior Software Engineer - Full-time');
  await page.getByLabel('First month there').fill('Mar 2027');
  await page.getByLabel(/Notes shown under the role/).fill('Payments platform');
  await page.getByText(`${before}: Dec 2024 - Mar 2027`).waitFor();
  await shot('job-1-plan');
  await page.getByRole('button', { name: 'Record the change' }).click();
  await page.getByText('Home page and referral page regenerated').waitFor();
  assert.equal(await page.locator('[data-ok="no"]').count(), 0, 'every step went through');
  await page.getByText('Northwind Labs, Senior Software Engineer, since Mar 2027.').waitFor();
  assert.match(await page.locator('main').textContent(), /Northwind Labs \(Mar 2027 - Current\): search index and assistant knowledge queued; subscribers not emailed/);
  await shot('job-2-recorded');

  // After: the form, the home page and structured data follow, with no code or setting changed.
  await open('/talk?intent=referral');
  await referralHeading().waitFor();
  assert.equal(await referralHeading().textContent(), 'Which role at Northwind Labs?');
  assert.equal(await page.locator('#talk-tab-referral').textContent().then(text => /At Northwind Labs/.test(text)), true);
  assert.ok(!(await page.locator('main, section').first().textContent()).includes(before));
  await shot('job-3-talk');
  await open('/');
  assert.equal(await worksFor(), 'Northwind Labs');
  const intro = await page.locator('.description p').first().textContent();
  assert.match(intro, /Senior Software Engineer at Northwind Labs/);
  const about = await page.locator('[data-role-intro="general"]').textContent();
  assert.match(about.replace(/\s+/g, ' '), /currently a Senior Software Engineer at Northwind Labs \(Payments platform\)/);
  assert.ok(!(await page.locator('.profile-box').textContent()).includes(before), 'the paragraph written for the old employer is gone');
  await page.locator('#contact-section').scrollIntoViewIfNeeded();
  assert.match(await page.locator('#contact-section #talk-tab-referral').textContent(), /At Northwind Labs/);

  // The review list: open for the new employer, older requests kept and marked.
  await open('/admin/referrals-preview');
  await page.getByText('The form on /talk is open for referrals at').waitFor();
  assert.match(await page.locator('[data-open="yes"]').textContent(), /Northwind Labs, your current employer in the work history \(since Mar 2027\)/);
  assert.ok(await page.getByText(`For ${before}, a previous employer`).count() >= 1);
  await shot('job-4-review');

  // Pausing closes the public form at once; reopening brings it back.
  await page.getByRole('button', { name: 'Pause requests' }).click();
  await page.getByText('The form on /talk is closed: you paused it').waitFor();
  await open('/talk?intent=referral');
  await page.getByText('Referral requests are closed right now').waitFor();
  assert.equal(await page.locator('[data-referral-form]').count(), 0);
  assert.match(await page.locator('#talk-tab-referral').textContent(), /Not open right now/);
  await shot('job-5-paused');
  await open('/admin/referrals-preview');
  await page.getByRole('button', { name: 'Open requests' }).click();
  await page.getByText('The form on /talk is open for referrals at').waitFor();

  // Leaving with no new role closes the form by itself and removes the employer everywhere.
  await open('/admin/experience-preview');
  await page.getByLabel('Last month at Northwind Labs').fill('Sep 2028');
  await page.getByRole('button', { name: 'Record the change' }).click();
  await page.getByText('No current employer').waitFor();
  await open('/talk?intent=referral');
  await page.getByText('I am between roles').waitFor();
  await open('/');
  assert.equal(await worksFor(), null, 'structured data names no employer between jobs');
  assert.doesNotMatch(await page.locator('.description p').first().textContent(), / at /);
  await shot('job-6-between');
  console.log('job change: form, home page, structured data and review list follow the work history; pause and between-jobs close the form');
} finally { await browser.close(); }
