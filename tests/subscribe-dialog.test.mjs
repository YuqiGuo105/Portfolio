import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import { SUBSCRIPTION_PROMPT_KEY, recordSubscriptionPrompt } from '../src/lib/subscriptionPrompt.mjs';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/SubscribeDialog.jsx', import.meta.url), 'utf8'), {
  filename: 'SubscribeDialog.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true },
    transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
let saved, existing;
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name.includes('BrowserPushSettings')) return { __esModule: true, default: () => React.createElement('div', { 'data-testid': 'push-settings' }) };
  if (name.endsWith('.css')) return { __esModule: true, default: { overlay: 'overlay', dialogOpen: 'dialogOpen' } };
  if (name.includes('notificationsClient')) return { loadSubscriber: () => existing, saveSubscriber: (...args) => { saved = args; } };
  if (name.includes('subscriptionPrompt.mjs')) return { recordSubscriptionPrompt };
  return require(name);
}, exports);
const SubscribeDialog = exports.default;
const nativeFetch = globalThis.fetch;
let root, opener, requests, invitation;
const render = open => act(() => root.render(React.createElement(SubscribeDialog, { open, invitation, onClose: () => render(false) })));
const button = name => [...document.querySelectorAll('button')].find(el => (el.getAttribute('aria-label') || el.textContent) === name);
beforeEach(() => {
  document.body.innerHTML = '<button id="opener">Open</button><div id="root"></div>';
  document.body.style.overflow = ''; window.localStorage.clear();
  opener = document.getElementById('opener'); opener.focus();
  root = createRoot(document.getElementById('root')); requests = []; saved = null; existing = null; invitation = true;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, json: async () => ({ subscriberId: 'test-id', subscriberToken: 'test-token' }) };
  };
});
afterEach(() => { act(() => root.unmount()); globalThis.fetch = nativeFetch; });
after(() => dom.window.close());

test('automatic invitation is dismissible, does not focus the keyboard or send a subscription', () => {
  render(true);
  assert.equal(document.activeElement, document.querySelector('[role="dialog"]'));
  assert.equal(requests.length, 0);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.body.classList.contains('dialogOpen'), true);
  assert.ok(window.localStorage.getItem(SUBSCRIPTION_PROMPT_KEY));
  assert.match(document.body.textContent, /Stay in the loop\?/);
  act(() => Simulate.click(button('Not now')));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.body.style.overflow, '');
  assert.equal(document.body.classList.contains('dialogOpen'), false);
  assert.equal(document.activeElement, opener);
});

test('keyboard focus is trapped and Escape closes the invitation', () => {
  render(true);
  act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })));
  assert.equal(document.activeElement, button('Subscribe'));
  act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', cancelable: true })));
  assert.equal(document.activeElement, button('Close'));
  act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })));
  assert.equal(document.activeElement, opener);
});

test('manual opening keeps the existing form and focuses email', () => {
  invitation = false; render(true);
  assert.equal(document.activeElement, document.getElementById('sub-email'));
  assert.match(document.body.textContent, /Subscribe to updates/);
  assert.ok(button('Cancel'));
  assert.equal(document.getElementById('sub-email').getAttribute('inputmode'), 'email');
  assert.equal(document.getElementById('sub-email').getAttribute('autocomplete'), 'email');
});

test('mobile visual viewport resize and keyboard panning keep the overlay in view', () => {
  const viewport = new window.EventTarget();
  viewport.height = 844; viewport.offsetTop = 0;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  try {
    render(true);
    const dialog = document.querySelector('[role="dialog"]');
    assert.equal(dialog.style.getPropertyValue('--visible-height'), '844px');
    viewport.height = 360; viewport.offsetTop = 48;
    viewport.dispatchEvent(new window.Event('resize'));
    viewport.dispatchEvent(new window.Event('scroll'));
    assert.equal(dialog.style.getPropertyValue('--visible-height'), '360px');
    assert.equal(dialog.style.getPropertyValue('--visible-top'), '48px');
    render(false);
    viewport.height = 844; viewport.dispatchEvent(new window.Event('resize'));
    assert.equal(dialog.style.getPropertyValue('--visible-height'), '360px');
  } finally { delete window.visualViewport; }
});

test('email-only subscribers retain their preferences without a misleading push toggle', () => {
  existing = { email: 'reader@example.test', subscriberId: 'id', subscriberToken: 'token', channels: ['EMAIL'], topics: ['JOB_UPDATES'] };
  invitation = false; render(true);
  assert.equal(document.querySelector('[data-testid="push-settings"]'), null);
  const selected = [...document.querySelectorAll('input[type="checkbox"]')].filter(input => input.checked).map(input => input.parentElement.textContent);
  assert.deepEqual(selected, ['Job updates', 'Email notifications']);
});

test('only explicit form submission invokes the unchanged subscription API', async () => {
  render(true);
  act(() => Simulate.change(document.getElementById('sub-email'), { target: { value: 'reader@example.com' } }));
  assert.equal(requests.length, 0);
  await act(async () => Simulate.submit(document.querySelector('form')));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/subscriptions');
  assert.deepEqual(JSON.parse(requests[0].body), { email: 'reader@example.com',
    topics: ['ARTICLE_UPDATES', 'FEATURE_UPDATES'], channels: ['WEB', 'EMAIL'] });
  assert.equal(saved[0], 'test-id');
  assert.match(document.body.textContent, /You.re subscribed/);
  assert.equal(document.activeElement, button('Done'));
});

test('pending email confirmation never saves credentials or claims an active subscription', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'CONFIRMATION_REQUIRED' }) });
  render(true);
  act(() => Simulate.change(document.getElementById('sub-email'), { target: { value: 'owner@example.test' } }));
  await act(async () => Simulate.submit(document.querySelector('form')));
  assert.equal(saved, null);
  assert.match(document.body.textContent, /Check your email/);
  assert.doesNotMatch(document.body.textContent, /You.re subscribed/);
  assert.equal(document.querySelector('[data-testid="push-settings"]'), null);
  render(false); render(true);
  assert.ok(document.querySelector('form'));
});
