import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as chatPagePolicy from '../src/lib/chatPagePolicy.mjs';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const handlers = new Map();
const router = {
  pathname: '/',
  events: {
    on(event, handler) { handlers.set(event, handler); },
    off(event, handler) { if (handlers.get(event) === handler) handlers.delete(event); },
  },
};
const { code } = await transform(readFileSync(new URL('../src/layout/Header.js', import.meta.url), 'utf8'), {
  filename: 'Header.jsx',
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' },
  module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name.endsWith('.css')) return { __esModule: true, default: {} };
  if (name === 'next/link') return { __esModule: true, default: ({ children, href }) => React.cloneElement(children, { href }) };
  if (name === 'next/router') return { useRouter: () => router };
  if (name === 'next/dynamic') return { __esModule: true, default: () => () => null };
  if (name.endsWith('SocialLinks')) return { __esModule: true, default: () => null };
  if (name.endsWith('chatPagePolicy.mjs')) return chatPagePolicy;
  return require(name);
}, exports);
const Header = exports.default;
const nativeTimeout = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
let root, pending, nextTimer;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  document.body.className = '';
  localStorage.clear();
  pending = new Map(); nextTimer = 0;
  globalThis.setTimeout = (callback, ms, ...args) => {
    if (ms !== 1000) return nativeTimeout(callback, ms, ...args);
    const id = ++nextTimer; pending.set(id, callback); return id;
  };
  globalThis.clearTimeout = id => {
    if (!pending.delete(id)) nativeClear(id);
  };
  root = createRoot(document.getElementById('root'));
  act(() => root.render(React.createElement(React.StrictMode, null, React.createElement(Header))));
});
afterEach(() => {
  act(() => root.unmount());
  assert.equal(pending.size, 0);
  assert.equal(handlers.size, 0);
  globalThis.setTimeout = nativeTimeout;
  globalThis.clearTimeout = nativeClear;
});
after(() => dom.window.close());
const button = () => document.querySelector('.menu-btn');
const overlay = () => document.querySelector('.menu-full-overlay');
const click = element => act(() => Simulate.click(element));
function finishAnimation() {
  act(() => {
    const callbacks = [...pending.values()]; pending.clear();
    for (const callback of callbacks) callback();
  });
}

test('menu keeps its open/close animation and releases the scroll lock', () => {
  assert.equal(overlay().classList.contains('visible'), false);
  click(button());
  assert.equal(button().getAttribute('aria-expanded'), 'true');
  assert.ok(document.body.classList.contains('no-scroll'));
  assert.ok(overlay().classList.contains('is-open'));
  finishAnimation();
  assert.ok(overlay().classList.contains('animate-active'));
  assert.equal(button().classList.contains('no-touch'), false);
  click(button());
  assert.equal(document.body.classList.contains('no-scroll'), false);
  assert.ok(overlay().classList.contains('visible'));
  finishAnimation();
  assert.equal(overlay().classList.contains('visible'), false);
});

test('Admin navigation unmounts before the close timeout without touching removed DOM', () => {
  click(button()); finishAnimation();
  click(document.querySelector('a[href="/admin"]'));
  assert.equal(button().getAttribute('aria-expanded'), 'false');
  assert.equal(pending.size, 1);
  act(() => root.render(null));
  assert.equal(pending.size, 0);
  assert.equal(overlay(), null);
  assert.equal(document.body.classList.contains('no-scroll'), false);
  assert.doesNotThrow(finishAnimation);
});

test('unmounting during the opening animation cancels the timer and scroll lock', () => {
  click(button());
  act(() => root.render(null));
  assert.equal(pending.size, 0);
  assert.equal(document.body.classList.contains('no-scroll'), false);
});

test('rapid close and reopen cannot apply a stale closing callback to the new menu', () => {
  click(button()); click(button()); click(button());
  assert.equal(pending.size, 1);
  finishAnimation();
  assert.equal(button().getAttribute('aria-expanded'), 'true');
  assert.ok(overlay().classList.contains('visible'));
  assert.ok(overlay().classList.contains('has-scroll'));
  assert.ok(document.body.classList.contains('no-scroll'));
});

for (const event of ['routeChangeStart', 'hashChangeStart']) {
  test(`${event} closes the menu even when navigation is triggered elsewhere`, () => {
    click(button()); finishAnimation();
    act(() => handlers.get(event)());
    assert.equal(button().getAttribute('aria-expanded'), 'false');
    assert.equal(document.body.classList.contains('no-scroll'), false);
    finishAnimation();
    assert.equal(overlay().classList.contains('visible'), false);
  });
}

test('repeated menu-link clicks close idempotently rather than reopening the overlay', () => {
  click(button()); finishAnimation();
  const contact = document.querySelector('a[href="/#contact-section"]');
  click(contact); click(contact); finishAnimation();
  assert.equal(button().getAttribute('aria-expanded'), 'false');
  assert.equal(overlay().classList.contains('visible'), false);
  assert.equal(document.body.classList.contains('no-scroll'), false);
});
