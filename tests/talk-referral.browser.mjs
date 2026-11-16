// Browser walk-through of the Talk page against a running local preview (`npm run dev:talk`):
//   PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.js node tests/talk-referral.browser.mjs
// It sends one message and one referral request (kept in the preview's memory, never emailed),
// and checks the review list, the stored résumé and the email the preview would have sent.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = process.env.TALK_TEST_URL || 'http://127.0.0.1:3147';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local preview only');
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const { chromium } = playwright.default || playwright;
const resume = path.join(mkdtempSync(path.join(tmpdir(), 'talk-')), 'Alex Chen Resume.pdf');
writeFileSync(resume, Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${'x'.repeat(40000)}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1'));
const INTRO = 'Alex Chen is a backend engineer with five years of experience building payment services in Java. At Northwind, Alex led the migration of the ledger service to Kafka, cutting settlement delay from hours to under two minutes.';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('portfolioSubscriptionPrompt:v1', String(Date.now())));
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const api = [];
    page.on('request', request => { const url = new URL(request.url()); if (url.origin === base && url.pathname.startsWith('/api/referral')) api.push(`${request.method()} ${url.pathname}`); });
    await context.route(/challenges\.cloudflare\.com|google\.com\/recaptcha|gstatic\.com|supabase\.co/, route => route.abort());

    await page.goto(`${base}/talk`, { waitUntil: 'domcontentloaded' });
    const tabs = page.getByRole('tab');
    await assert.doesNotReject(tabs.nth(2).waitFor());
    assert.deepEqual(await tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-selected'))), ['true', 'false', 'false']);
    assert.deepEqual(api, [], 'opening the page calls no referral API');

    await page.getByRole('tab', { name: /Ask for a referral/ }).click();
    await page.waitForURL(/intent=referral/);
    const form = page.locator('[data-referral-form]');
    await form.waitFor();
    await form.getByRole('button', { name: 'Continue' }).click();
    await form.getByText('Paste the link to the posting.').waitFor();
    await form.getByLabel('Role title').fill('Associate, Software Engineering');
    await form.getByLabel('Link to the posting').fill('https://higher.gs.com/roles/142201');
    await form.getByRole('button', { name: 'Continue' }).click();
    await form.getByLabel('Full name').fill('Alex Chen');
    await form.getByLabel('Email', { exact: true }).fill(`alex.${width}@example.com`);
    await form.locator('#referral-resume').setInputFiles(resume);
    await form.getByText("We haven't met yet").click();
    await form.getByRole('button', { name: 'Continue' }).click();

    // The introduction is the applicant's own writing: no drafting control, and first person is refused.
    assert.equal(await form.getByRole('button', { name: /draft|generate/i }).count(), 0);
    const intro = form.locator('#referral-intro');
    await intro.fill(`I am a backend engineer. ${'My team and I build payment services. '.repeat(6)}`);
    await form.getByRole('button', { name: 'Continue' }).click();
    await form.getByText('Rewrite this about yourself by name').waitFor();
    await intro.fill(INTRO);
    await form.getByText('Reads as third person.').waitFor();
    await form.getByRole('button', { name: 'Continue' }).click();

    await form.getByRole('heading', { name: 'Check it, then send' }).waitFor();
    assert.equal(await form.getByRole('alert').count(), 0, 'reaching the review sends nothing and shows no error');
    assert.deepEqual(api, []);
    const overflow = await form.evaluate(element => [...element.querySelectorAll('*')].some(node => node.getBoundingClientRect().right > innerWidth + 1));
    assert.equal(overflow, false, `nothing overflows at ${width}px`);
    await form.getByRole('button', { name: 'Send request' }).click();
    await form.getByText('Please confirm how your details will be used.').waitFor();
    await form.locator('#referral-consent').check();
    await form.getByRole('button', { name: 'Send request' }).click();
    await page.getByText('Request received').waitFor();
    // Three small steps: the answers, the file to storage, the confirmation.
    assert.deepEqual(api, ['POST /api/referral', 'PUT /api/referral/preview-upload', 'POST /api/referral/complete']);
    const reference = await page.locator('[class*="reference"]').innerText();
    assert.match(reference, /^R-[0-9A-F]{12}$/);

    // The worker screens it in the background; the review list then shows it with its file.
    let row;
    for (let attempt = 0; attempt < 40 && row?.state !== 'ready'; attempt += 1) {
      await page.waitForTimeout(250);
      row = (await (await fetch(`${base}/api/referral/preview`)).json()).requests.find(item => item.reference === reference);
    }
    assert.equal(row?.state, 'ready'); assert.equal(row.intro, INTRO, 'stored exactly as written'); assert.equal(row.resume_filename, 'Alex Chen Resume.pdf');
    assert.match(row.resume_sha256, /^[0-9a-f]{64}$/);
    const { outbox } = await (await fetch(`${base}/api/referral/preview?view=outbox`)).json();
    const mail = outbox.find(item => item.text.includes(reference));
    assert.ok(mail, 'a digest email was prepared'); assert.ok(mail.text.includes(INTRO)); assert.deepEqual(mail.attachments, []);

    await page.goto(`${base}/admin/referrals-preview`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: new RegExp(`^Alex Chen`) }).first().click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download résumé' }).first().click()]);
    assert.equal(download.suggestedFilename(), 'Alex Chen Resume.pdf');

    // The message form still works from the same page.
    await page.goto(`${base}/talk`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Name', { exact: true }).fill('Sam Rivera');
    await page.getByLabel('Email Address').fill('sam@example.com');
    await page.locator('textarea[name="message"]').fill('Hello Yuqi, could we talk about a platform role on my team?');
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByText('Thanks, your message has been sent successfully.').waitFor();

    // The home page shows the same three choices and sends referral seekers to /talk.
    await page.goto(`${base}/?subscriptionPreview=0`, { waitUntil: 'domcontentloaded' });
    const section = page.locator('#contact-section');
    await section.getByRole('tab', { name: /Ask for a referral/ }).click();
    assert.equal(await section.getByRole('link', { name: /Start a referral request/ }).getAttribute('href'), '/talk?intent=referral');
    await section.getByRole('tab', { name: /Chat or call live/ }).click();
    assert.match(await section.getByRole('link', { name: /Open TalkNest/ }).getAttribute('href'), /connect=Yuqi%20Guo/);
    assert.deepEqual(pageErrors, []);
    console.log(`${width}px: tabs, validation, third-person check, three-step send, background screening, résumé download, message form and home section passed`);
    await context.close();
  }
} finally { await browser.close(); }
