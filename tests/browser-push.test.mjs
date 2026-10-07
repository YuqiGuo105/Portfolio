import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { browserPushSupported, prepareBrowserPush, enableBrowserPush, disableBrowserPush } from '../src/lib/browserPush.mjs';

const original = { window: globalThis.window, Notification: globalThis.Notification, fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
let requests, permissionCalls, registered, saved, configuration, permission, removed, registration;
beforeEach(() => {
  requests = []; permissionCalls = 0; registered = false; saved = false; configuration = true; permission = 'granted'; removed = false;
  const subscription = { endpoint: 'https://fcm.googleapis.com/test-only', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/test-only', keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: async () => { removed = true; } };
  registration = { active: {}, pushManager: { getSubscription: async () => registered ? subscription : null,
    subscribe: async options => { assert.equal(options.userVisibleOnly, true); registered = true; return subscription; } } };
  globalThis.Notification = { permission: 'default', requestPermission: async () => { permissionCalls++; return permission; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { register: async path => { assert.equal(path, '/notifications/sw.js'); return registration; } } } });
  globalThis.window = { isSecureContext: true, Notification, PushManager: {}, navigator };
  globalThis.fetch = async (url, init) => {
    requests.push({ url, ...init });
    assert.equal(init.cache, 'no-store');
    let data = url.endsWith('config') ? { enabled: configuration, publicKey: 'AQID' } : url.endsWith('status') ? { active: saved } : { status: 'ACTIVE' };
    if (url.endsWith('subscriptions')) saved = init.method === 'POST';
    return { ok: true, json: async () => data };
  };
});
afterEach(() => {
  globalThis.window = original.window; globalThis.Notification = original.Notification; globalThis.fetch = original.fetch;
  if (original.navigator) Object.defineProperty(globalThis, 'navigator', original.navigator); else delete globalThis.navigator;
});
const subscriber = { subscriberId: 'test-id', subscriberToken: 'test-token', email: 'not-sent@example.test' };

test('preparing never asks permission; explicit enable stores nested subscription without email', async () => {
  const prepared = await prepareBrowserPush(subscriber);
  assert.equal(prepared.state, 'ready'); assert.equal(permissionCalls, 0);
  const enabled = await enableBrowserPush(prepared, subscriber);
  assert.equal(enabled.state, 'enabled'); assert.equal(permissionCalls, 1);
  const post = requests.find(r => r.method === 'POST' && r.url.endsWith('subscriptions'));
  assert.deepEqual(Object.keys(JSON.parse(post.body)).sort(), ['subscriberId', 'subscriberToken', 'subscription']);
  assert.equal((await prepareBrowserPush(subscriber)).state, 'enabled');
  assert.equal((await disableBrowserPush(enabled, subscriber)).state, 'ready');
  assert.equal(saved, false); assert.equal(removed, true);
});
test('denial or dismissed permission never registers a server subscription', async () => {
  const prepared = await prepareBrowserPush(subscriber);
  for (const choice of ['denied', 'default']) {
    permission = choice;
    assert.notEqual((await enableBrowserPush(prepared, subscriber)).state, 'enabled');
  }
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});
test('unsupported and unconfigured browsers are explicit, not false success', async () => {
  configuration = false; assert.equal((await prepareBrowserPush(subscriber)).state, 'unavailable');
  window.isSecureContext = false; assert.equal(browserPushSupported(), false);
  assert.equal((await prepareBrowserPush(subscriber)).state, 'unsupported');
  assert.equal(permissionCalls, 0);
});
test('failed save is not presented as enabled, and failed deletion keeps browser subscription', async () => {
  const prepared = await prepareBrowserPush(subscriber);
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(enableBrowserPush(prepared, subscriber));
  await assert.rejects(disableBrowserPush(prepared, subscriber));
  assert.equal(removed, false);
});
test('worker displays push without a page, and rejects external notification destinations', async () => {
  const handlers = {}, shown = [], opened = [];
  const self = { location: { origin: 'https://www.yuqi.site' }, addEventListener: (name, callback) => { handlers[name] = callback; },
    registration: { showNotification: async (title, options) => shown.push({ title, ...options }) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } };
  vm.runInNewContext(readFileSync(new URL('../public/notifications/sw.js', import.meta.url), 'utf8'), { self, URL });
  let promise;
  handlers.push({ data: { json: () => ({ title: 'New article', body: 'Preview', url: 'https://evil.example', tag: 'one' }) }, waitUntil: task => { promise = task; } });
  await promise;
  assert.equal(shown[0].title, 'New article'); assert.equal(shown[0].data.url, 'https://www.yuqi.site/');
  handlers.notificationclick({ notification: { close() {}, data: { url: '/blog-single/example' } }, waitUntil: task => { promise = task; } });
  await promise; assert.deepEqual(opened, ['https://www.yuqi.site/blog-single/example']);
  assert.equal(handlers.fetch, undefined);
});
