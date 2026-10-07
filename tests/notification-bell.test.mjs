import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
async function load(path, resolve = require) {
  const { code } = await transform(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    filename: path, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
  });
  const exports = {}; new Function('require', 'exports', code)(resolve, exports); return exports;
}
const client = await load('../src/lib/notificationsClient.js');
let dropdown;
const { default: Bell } = await load('../src/components/NotificationBell.jsx', name => {
  if (name.endsWith('.css')) return { __esModule: true, default: { bell: 'bell' } };
  if (name.includes('notificationsClient')) return client;
  if (name.includes('NotificationDropdown')) return { __esModule: true, default: props => { dropdown = props; return React.createElement('div', { id: 'dropdown' }, props.error || props.items.map(i => i.title).join(',')); } };
  return require(name);
});
const nativeFetch = globalThis.fetch, nativeInterval = globalThis.setInterval, nativeClear = globalThis.clearInterval;
let root, calls, items, poll, fail, hidden;
beforeEach(() => {
  window.localStorage.clear(); document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')); calls = []; items = []; fail = false; hidden = false;
  Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
  globalThis.setInterval = callback => { poll = callback; return 1; };
  globalThis.clearInterval = () => { poll = null; };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: !fail, status: fail ? 502 : 200, json: async () => init.method === 'PATCH' ? { updated: false } : { items, unreadCount: items.filter(i => i.status !== 'READ').length } };
  };
});
afterEach(() => { act(() => root.unmount()); globalThis.fetch = nativeFetch; globalThis.setInterval = nativeInterval; globalThis.clearInterval = nativeClear; });
after(() => dom.window.close());
async function mount() { await act(async () => root.render(React.createElement(Bell, { onOpenSubscribe() {} }))); }
async function subscribe() { await act(async () => client.saveSubscriber('test-id', 'test-token')); }
test('subscription enables the mounted bell immediately and later polling finds new updates', async () => {
  await mount(); assert.match(document.querySelector('button').getAttribute('aria-label'), /Subscribe/);
  await subscribe(); assert.match(document.querySelector('button').getAttribute('aria-label'), /0 unread/);
  items = [{ recipientId: 'one', title: 'New article', status: 'PENDING' }];
  await act(async () => poll()); assert.match(document.querySelector('button').getAttribute('aria-label'), /1 unread/);
  hidden = true; const before = calls.length;
  await act(async () => poll()); assert.equal(calls.length, before);
  hidden = false; await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
  assert.ok(calls.length > before);
});
test('failed refresh shows an error; already-read responses do not blindly decrement the count', async () => {
  await mount(); await subscribe(); items = [{ recipientId: 'one', title: 'Article', status: 'PENDING' }];
  await act(async () => Simulate.click(document.querySelector('button')));
  await act(async () => dropdown.onMarkRead('one'));
  assert.match(document.querySelector('button').getAttribute('aria-label'), /1 unread/);
  fail = true; await act(async () => dropdown.onRefresh());
  assert.match(document.getElementById('dropdown').textContent, /Couldn't load/);
});
test('cross-tab removal disables the bell and cancels polling', async () => {
  await mount(); await subscribe();
  await act(async () => { window.localStorage.removeItem('portfolioSubscriber:v1'); window.dispatchEvent(new window.StorageEvent('storage', { key: 'portfolioSubscriber:v1' })); });
  assert.match(document.querySelector('button').getAttribute('aria-label'), /Subscribe/);
  assert.equal(poll, null);
});
