import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3105';
const key = createECDH('prime256v1'); key.generateKeys();
const publicKey = key.getPublicKey().toString('base64url');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.grantPermissions(['notifications'], { origin });
  await context.addInitScript(() => {
    localStorage.setItem('portfolioSubscriptionPrompt:v1', String(Date.now()));
    localStorage.setItem('ober-mood', 'day');
    // Emulate provider registration only; actual Service Worker and Notifications APIs stay real.
    let device = null;
    PushManager.prototype.getSubscription = async () => device;
    PushManager.prototype.subscribe = async () => {
      device = { endpoint: 'https://fcm.googleapis.com/test-browser-only', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/test-browser-only', keys: { p256dh: 'test-only', auth: 'test-only' } }), unsubscribe: async () => { device = null; return true; } };
      return device;
    };
  });
  let enabled = false, saves = 0, marked = false;
  await context.route('**/api/subscriptions', route => route.fulfill({ json: { subscriberId: 'browser-test', subscriberToken: 'test-only' } }));
  await context.route('**/api/push/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('config')) return route.fulfill({ json: { enabled: true, publicKey } });
    if (path.endsWith('status')) return route.fulfill({ json: { active: enabled } });
    if (path.endsWith('subscriptions')) { enabled = route.request().method() === 'POST'; saves++; return route.fulfill({ json: { status: enabled ? 'ACTIVE' : 'REMOVED' } }); }
    return route.abort();
  });
  await context.route('**/api/notifications?*', route => route.fulfill({ json: {
    unreadCount: marked ? 0 : 1, items: [{ recipientId: 'one', title: 'New article', body: 'A local test preview.', url: '/blogs', status: marked ? 'READ' : 'PENDING', createdAt: '2026-10-06T12:00:00Z', topic: 'ARTICLE_UPDATES' }],
  } }));
  await context.route('**/api/notifications/one/read', route => { marked = true; return route.fulfill({ json: { updated: true } }); });
  const controller = await context.newPage();
  const cdp = await context.newCDPSession(controller);
  let registrationId;
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    const record = registrations.find(r => r.scopeURL === `${origin}/notifications/`);
    if (record) registrationId = record.registrationId;
  });
  await cdp.send('ServiceWorker.enable');
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Subscribe to notifications' }).click();
  const dialog = page.getByRole('dialog', { name: 'Subscribe to updates' });
  await dialog.getByLabel('Email', { exact: true }).fill('browser@example.test');
  await dialog.getByLabel('Email notifications').uncheck();
  await dialog.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await dialog.getByRole('button', { name: 'Enable browser notifications' }).click();
  await dialog.getByText('Browser notifications are on for this device.').waitFor();
  assert.equal(saves, 1);
  await page.screenshot({ path: '/private/tmp/browser-push-enabled-mobile.png' });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications (1 unread)' }).click();
  const inbox = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await inbox.getByText('New article', { exact: true }).waitFor();
  const box = await inbox.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391);
  await inbox.getByRole('button', { name: 'Mark as read' }).click();
  await page.getByRole('button', { name: 'Notifications (0 unread)' }).waitFor();
  await inbox.getByRole('button', { name: 'Notification settings' }).click();
  await dialog.getByRole('button', { name: 'Turn off on this device' }).click();
  await dialog.getByRole('button', { name: 'Enable browser notifications' }).waitFor();
  assert.equal(enabled, false);
  await dialog.getByRole('button', { name: 'Enable browser notifications' }).click();
  await dialog.getByText('Browser notifications are on for this device.').waitFor();
  const worker = context.serviceWorkers().find(w => w.url().endsWith('/notifications/sw.js'));
  assert.ok(worker); assert.ok(registrationId);
  await page.close();
  assert.equal(context.pages().filter(p => p.url().startsWith(origin)).length, 0);
  // Inject only a local browser push event. No FCM/Apple/Mozilla traffic or production recipient.
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId,
    data: JSON.stringify({ title: 'Local push smoke test', body: 'Page is closed.', url: '/blogs', tag: 'local-smoke' }) });
  let notifications = [];
  for (let i = 0; i < 20 && notifications.length === 0; i++) {
    notifications = await worker.evaluate(async () => (await self.registration.getNotifications()).map(n => ({ title: n.title, body: n.body })));
    if (!notifications.length) await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(notifications[0]?.title, 'Local push smoke test');
  await worker.evaluate(async () => (await self.registration.getNotifications()).forEach(n => n.close()));
  console.log('PASS: opt-in, saved subscription, mobile inbox, mark-read, disable/re-enable and real Service Worker notification after closing the page. Provider registration/API replies were mocked; no production push sent.');
} finally { await browser.close(); }
