import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as diagnostics from '../src/lib/visitorBotDiagnostics.mjs';
import { diagnosticPreviewEvents } from '../src/lib/visitorBotDiagnosticsPreview.mjs';
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'), { createRoot } = require('react-dom/client'), { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/admin/VisitorBotDiagnostics.jsx', import.meta.url), 'utf8'), {
  filename: 'VisitorBotDiagnostics.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => name.endsWith('.css') ? { __esModule: true, default: {} } : name.includes('visitorBotDiagnostics') ? diagnostics : require(name), exports);
const now = Date.parse('2026-11-20T17:00:00Z'), events = diagnosticPreviewEvents(now);
const payload = { items: events, page: { totalElements: events.length } };
const filters = { bot: 'ALL', city: '', includeAdmin: false }, range = { from: new Date(now - 86400000).toISOString(), to: new Date(now).toISOString() };
let root;
const button = label => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label);
const click = label => act(async () => Simulate.click(button(label)));
const render = (api, props = {}) => act(async () => root.render(React.createElement(exports.default, { api, filters, range, synthetic: true, ...props })));
beforeEach(() => { window.location.hash = ''; document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')); });
afterEach(() => act(() => root.unmount()));
after(() => dom.window.close());

test('lazy bounded reads; thresholds recompute locally and reset without any write or request', async () => {
  const calls = [];
  const api = { visitors: { list: async (...args) => { calls.push(args); return payload; } } };
  await render(api); assert.equal(calls.length, 0);
  await click('Expand bot diagnostics');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].view, 'events'); assert.equal(calls[0][0].size, 100); assert.equal(calls[0][0].page, 0);
  assert.equal(calls[0][0].from, range.from); assert.equal(calls[0][0].bot, 'ALL');
  assert.match(document.querySelector('[aria-label="Diagnostic counts"]').textContent, /\+18/);
  const [suspected, high] = document.querySelectorAll('input[type="range"]');
  await act(async () => Simulate.change(suspected, { target: { value: '70' } }));
  assert.match(document.querySelector('[aria-label="Diagnostic counts"]').textContent, /\+12/);
  assert.match(document.querySelector('[aria-label="Diagnostic counts"]').textContent, /-6 vs default/);
  assert.equal(high.min, '71');
  await act(async () => Simulate.change(high, { target: { value: '95' } }));
  assert.match(document.querySelector('[aria-label="Session classification counts"]').textContent, /0 high-likelihood/);
  assert.equal(calls.length, 1);
  await click('Reset diagnostic thresholds'); assert.equal(suspected.value, '50'); assert.equal(high.value, '80');
  assert.equal(calls.length, 1);
  assert.match(document.body.textContent, /No access blocked, records deleted, classifications saved or public totals changed/);
});

test('all-session filter exposes single-signal non-candidates, reasons and original record flags', async () => {
  await render({ visitors: { list: async () => payload } }); await click('Expand bot diagnostics');
  await act(async () => Simulate.change(document.querySelector('select'), { target: { value: 'all' } }));
  assert.match(document.body.textContent, /sample-fast-only/);
  assert.match(document.body.textContent, /Only one behavior signal/);
  assert.match(document.body.textContent, /server receipts span 180ms/);
  assert.match(document.body.textContent, /Saved: not bot \| Preview: High likelihood/);
  for (const details of document.querySelectorAll('details')) assert.equal(details.open, false);
});

test('incomplete coverage and errors are explicit, not zero or site-wide results', async () => {
  let calls = 0;
  const api = { visitors: { list: async () => { if (++calls === 2) throw new Error('Sample read failed'); return { ...payload, page: { totalElements: 500 } }; } } };
  await render(api); await click('Expand bot diagnostics');
  assert.match(document.body.textContent, /Partial or unconfirmed coverage/);
  await click('Refresh diagnostic sample');
  assert.match(document.querySelector('[role="alert"]').textContent, /Sample read failed/);
  assert.equal(document.querySelector('[aria-label="Diagnostic counts"]'), null);
  await click('Refresh diagnostic sample');
  assert.ok(document.querySelector('[aria-label="Diagnostic counts"]'));
});

test('malformed query data cannot be presented as a clean empty sample', async () => {
  await render({ visitors: { list: async () => ({ page: { totalElements: 50 } }) } });
  await click('Expand bot diagnostics');
  assert.match(document.querySelector('[role="alert"]').textContent, /missing event records/);
  assert.equal(document.querySelector('[aria-label="Diagnostic counts"]'), null);
});

test('filter changes abort prior reads and late responses cannot overwrite a new sample', async () => {
  const calls = [];
  const api = { visitors: { list: (query, options) => new Promise(resolve => calls.push({ query, ...options, resolve })) } };
  await render(api); await click('Expand bot diagnostics');
  await render(api, { filters: { ...filters, city: 'Sample location' } });
  assert.equal(calls[0].signal.aborted, true); assert.equal(calls[1].query.city, 'Sample location');
  await act(async () => calls[1].resolve({ items: [], page: { totalElements: 0 } }));
  await act(async () => calls[0].resolve(payload));
  assert.match(document.body.textContent, /No event records in this sample/);
  assert.doesNotMatch(document.body.textContent, /sample-concurrent/);
  await click('Collapse bot diagnostics'); assert.equal(calls[1].signal.aborted, true);
});

test('direct diagnostic anchor opens the panel; remount returns thresholds to defaults', async () => {
  window.location.hash = '#visitor-bot-diagnostics';
  await render({ visitors: { list: async () => payload } });
  assert.equal(button('Collapse bot diagnostics').getAttribute('aria-expanded'), 'true');
  assert.match(document.body.textContent, /Synthetic sample/);
  assert.equal(document.querySelector('input[type="range"]').value, '50');
});
