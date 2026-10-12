import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as helpers from '../src/lib/visitorWorkbench.mjs';
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'), { createRoot } = require('react-dom/client'), { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/admin/VisitorWorkbench.jsx', import.meta.url), 'utf8'), {
  filename: 'VisitorWorkbench.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name.endsWith('.css')) return { __esModule: true, default: {} };
  if (name.endsWith('visitorWorkbench.mjs')) return helpers;
  return require(name);
}, exports);
let root;
const item = { eventId: 'event-one', sessionId: 'session-one', eventTime: new Date().toISOString(), bot: false };
const render = props => act(async () => root.render(React.createElement(exports.VisitorInspector, { selection: { item, tab: 'timeline' }, hours: 24, zone: 'UTC', onClose: () => {}, ...props })));
const click = name => act(async () => Simulate.click([...document.querySelectorAll('button')].find(e => e.textContent === name)));
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')); localStorage.clear(); });
afterEach(() => act(() => root.unmount()));
after(() => dom.window.close());

test('read failure offers retry without reporting a successful empty session', async () => {
  let attempts = 0;
  const api = { visitors: { sessionEvidence: async () => { if (++attempts === 1) throw new Error('Read unavailable'); return { items: [], page: { totalElements: 0 } }; } } };
  await render({ api });
  assert.match(document.body.textContent, /Read unavailable/);
  assert.doesNotMatch(document.body.textContent, /No events in this time window/);
  await click('Retry');
  assert.equal(attempts, 2); assert.match(document.body.textContent, /No events in this time window/);
});

test('late response from a previous session is aborted and cannot replace the current session', async () => {
  const pending = [];
  const api = { visitors: { sessionEvidence: (args, options) => new Promise(resolve => pending.push({ args, ...options, resolve })) } };
  await render({ api });
  await render({ api, selection: { item: { ...item, eventId: 'event-two', sessionId: 'session-two' }, tab: 'timeline' } });
  assert.equal(pending[0].signal.aborted, true);
  await act(async () => pending[1].resolve({ items: [{ eventId: 'two', eventName: 'current', eventTime: item.eventTime }], page: {} }));
  await act(async () => pending[0].resolve({ items: [{ eventId: 'one', eventName: 'obsolete', eventTime: item.eventTime }], page: {} }));
  assert.match(document.body.textContent, /current/); assert.doesNotMatch(document.body.textContent, /obsolete/);
  assert.deepEqual(pending[0].args.window, pending[1].args.window);
});

test('classification evidence is immediate; session analysis is fetched only on demand and cancelled on close', async () => {
  let calls = 0, signal;
  const api = { visitors: { sessionEvidence: (_args, options) => { calls++; signal = options.signal; return new Promise(() => {}); } } };
  await render({ api, selection: { item, tab: 'evidence' } });
  assert.equal(calls, 0); assert.match(document.body.textContent, /Not classified as a bot/);
  await click('MCP analysis'); assert.equal(calls, 1);
  await act(() => root.render(null)); assert.equal(signal.aborted, true); assert.equal(document.body.style.overflow, '');
});

test('saved view storage failure is visible and cannot claim success', async () => {
  const original = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () => { throw new Error('Storage disabled'); };
  try {
    await act(() => root.render(React.createElement(exports.VisitorToolbar, { filters: {}, hours: 24, zone: 'UTC', onZone: () => {}, onRestore: () => {}, storageScope: 'test-admin' })));
    await act(() => Simulate.change(document.querySelector('input'), { target: { value: 'Mobile' } }));
    await act(() => Simulate.submit(document.querySelector('form')));
    assert.match(document.body.textContent, /Could not save/); assert.doesNotMatch(document.body.textContent, /Saved on this browser/);
  } finally { dom.window.Storage.prototype.setItem = original; }
});

test('scroll depth renders stored percentages without requests or inferring depth from duration', async () => {
  await act(() => root.render(React.createElement(exports.ScrollDepth, { event: { properties: { progressPercent: 75 } } })));
  assert.match(document.body.textContent, /Scroll depth\s*About 75%/);
  assert.match(document.querySelector('[title]').title, /not proof/);
  for (const value of [undefined, null, '', true, -1, 101, 'not-a-number']) {
    assert.equal(helpers.scrollDepthPercent({ properties: { progressPercent: value } }), null);
  }
  assert.equal(helpers.scrollDepthPercent({ progressPercent: '50' }), 50);
  assert.equal(helpers.scrollDepthPercent({ properties: { progressPercent: 0 } }), 0);
  await act(() => root.render(React.createElement(exports.ScrollDepth, { event: { eventName: 'engaged_time', properties: { engagedSeconds: 90 } } })));
  assert.match(document.body.textContent, /Scroll depth not recorded/);
  assert.doesNotMatch(document.body.textContent, /90|%/);
});

test('session timeline replaces duration display with approximate scroll checkpoints', async () => {
  const api = { visitors: { sessionEvidence: async () => ({ items: [
    { ...item, eventName: 'read_progress', properties: { progressPercent: 50 } },
    { ...item, eventId: 'old-duration', eventName: 'engaged_time', properties: { engagedSeconds: 120 } },
  ], page: { totalElements: 2 } }) } };
  await render({ api });
  assert.match(document.body.textContent, /About 50%/);
  assert.match(document.body.textContent, /Legacy duration event/);
  assert.match(document.body.textContent, /Scroll depth not recorded/);
  assert.doesNotMatch(document.body.textContent, /Reported engagement|120 seconds/);
});
