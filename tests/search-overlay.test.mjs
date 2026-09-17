import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/SearchOverlay.js', import.meta.url), 'utf8'), {
  filename: 'SearchOverlay.js', jsc: { parser: { syntax: 'ecmascript', jsx: true },
    transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  if (name.includes('behaviorAnalytics')) return { trackBehavior() {} };
  return require(name);
}, exports);
const SearchOverlay = exports.default;
const fixture = { id: 'BLOG:1', source: 'Blog', title: 'Kubernetes guide', url: 'https://www.yuqi.site/blog-single/1',
  description: 'Container orchestration', sourceRequiresLogin: false };
const nativeFetch = globalThis.fetch;
let root, requests, opener;
const input = () => document.querySelector('input');
const tab = name => [...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === name);
const button = name => [...document.querySelectorAll('button')].find(el => (el.getAttribute('aria-label') || el.textContent) === name);
const render = open => act(() => root.render(React.createElement(SearchOverlay, { isOpen: open, onClose: () => render(false) })));
const type = value => act(() => Simulate.change(input(), { target: { value } }));
const click = el => act(() => Simulate.click(el));
const advance = async (t, ms = 250) => act(async () => { t.mock.timers.tick(ms); });
const respond = async (index, results = [fixture], ok = true) => act(async () => {
  requests[index].resolve({ ok, json: async () => ({ results, total: results.length }) });
});

beforeEach(t => {
  document.body.innerHTML = '<button id="opener">Open</button><div id="root"></div>';
  opener = document.getElementById('opener'); opener.focus();
  root = createRoot(document.getElementById('root'));
  requests = [];
  globalThis.fetch = (url, options) => new Promise(resolve => requests.push({ url, ...options, resolve }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  render(true);
});
afterEach(t => {
  act(() => root.unmount());
  t.mock.timers.reset();
  globalThis.fetch = nativeFetch;
});
after(() => dom.window.close());

test('debounces, aborts obsolete requests and ignores late responses', async t => {
  type('old'); await advance(t);
  type('k8s'); assert.equal(requests[0].signal.aborted, true);
  await advance(t); await respond(1);
  await respond(0, [{ ...fixture, title: 'Obsolete result' }]);
  assert.match(document.body.textContent, /Kubernetes guide/);
  assert.doesNotMatch(document.body.textContent, /Obsolete result/);
});

test('IME composition sends only the completed query', async t => {
  act(() => Simulate.compositionStart(input())); type('盐'); await advance(t, 500);
  assert.equal(requests.length, 0);
  type('盐湖城'); act(() => Simulate.compositionEnd(input())); await advance(t);
  assert.equal(new URL(requests[0].url, 'http://localhost').searchParams.get('q'), '盐湖城');
});

test('failed requests offer retry and retain the original query', async t => {
  type('k8s'); await advance(t); await respond(0, [], false);
  assert.match(document.body.textContent, /Search temporarily unavailable/);
  click(button('Try again')); await advance(t); await respond(1);
  assert.equal(input().value, 'k8s');
  assert.match(document.body.textContent, /Kubernetes guide/);
});

test('deadline exits loading and aborts a stalled request', async t => {
  type('k8s'); await advance(t); await advance(t, 18000);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(document.querySelector('[role="tabpanel"]').getAttribute('aria-busy'), 'false');
  assert.ok(button('Try again'));
});

test('empty category can search all content and reopening resets the filter', async t => {
  type('k8s'); click(tab('Life')); await advance(t); await respond(0, []);
  assert.match(document.body.textContent, /No matches in Life/);
  click(button('Search all content')); await advance(t); await respond(1);
  assert.equal(new URL(requests[1].url, 'http://localhost').searchParams.has('source'), false);
  click(tab('Projects')); render(false); render(true);
  assert.equal(tab('All').getAttribute('aria-selected'), 'true');
  assert.equal(input().value, '');
});

test('focus is trapped and restored, scroll lock is released on close', () => {
  assert.equal(document.activeElement, input());
  assert.equal(document.body.style.overflow, 'hidden');
  act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })));
  assert.equal(document.activeElement.getAttribute('href'), '/cv');
  act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, opener);
  assert.equal(document.body.style.overflow, '');
});

test('restricted sources display a sign-in label without changing their canonical link', async t => {
  type('盐湖城'); await advance(t); await respond(0, [{ ...fixture, source: 'Life', sourceRequiresLogin: true,
    title: 'Travel journal', url: 'https://www.yuqi.site/life-blog/2' }]);
  const result = document.querySelector('[data-testid="search-result"]');
  assert.match(result.textContent, /Sign in to read/);
  assert.equal(result.href, 'https://www.yuqi.site/life-blog/2');
});
