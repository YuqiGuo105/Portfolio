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
const React = require('react'), { createRoot } = require('react-dom/client'), { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/admin/VisitorOverview.jsx', import.meta.url), 'utf8'), {
  filename: 'VisitorOverview.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => name.endsWith('.css') ? { __esModule: true, default: {} } : require(name), exports);
let root;
const filters = { bot: 'ALL' };
const range = { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z', hours: 168 };
const sample = { ...range, summary: { events: 12, pageViews: 4, sessions: 2, countries: 1, likelyPeople: 8, bots: 3, unknown: 1 }, timeline: [], rankings: {} };
const render = props => act(async () => root.render(React.createElement(exports.default, { filters, range, onWindow() {}, onFilter() {}, onReset() {}, ...props })));
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')); });
afterEach(() => act(() => root.unmount()));
after(() => dom.window.close());

test('overview failure is not reported as zero traffic and retry recovers', async () => {
  let calls = 0;
  const api = { visitors: { overview: async () => { if (++calls === 1) throw new Error('Offline'); return sample; } } };
  await render({ api });
  assert.match(document.body.textContent, /Overview unavailable/);
  assert.doesNotMatch(document.body.textContent, /No traffic in this view/);
  await act(async () => Simulate.click([...document.querySelectorAll('button')].find(b => b.textContent.includes('Retry overview'))));
  assert.match(document.body.textContent, /Traffic composition/);
  assert.equal(calls, 2);
});

test('obsolete overview requests are aborted and cannot overwrite a new filter', async () => {
  const pending = [];
  const api = { visitors: { overview: (args, options) => new Promise(resolve => pending.push({ args, ...options, resolve })) } };
  await render({ api });
  await render({ api, filters: { bot: 'ONLY' } });
  assert.equal(pending[0].signal.aborted, true);
  await act(async () => pending[1].resolve({ ...sample, summary: { ...sample.summary, events: 0 } }));
  await act(async () => pending[0].resolve(sample));
  assert.match(document.body.textContent, /No traffic in this view/);
  assert.doesNotMatch(document.body.textContent, /Traffic composition/);
});

test('switching range hides the previous totals until the new query completes', async () => {
  const api = { visitors: { overview: ({ hours }) => hours === 168 ? Promise.resolve(sample) : new Promise(() => {}) } };
  await render({ api });
  assert.match(document.body.textContent, /Traffic composition/);
  await render({ api, range: { ...range, hours: 720 } });
  assert.match(document.body.textContent, /Loading traffic overview/);
  assert.doesNotMatch(document.body.textContent, /Traffic composition/);
});

test('overview and individual sections collapse independently without refetching or losing metric selection', async () => {
  let calls = 0;
  const api = { visitors: { overview: async () => { calls++; return sample; } } };
  await render({ api });
  const button = name => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent) === name);
  const click = name => act(async () => Simulate.click(button(name)));
  const content = name => document.getElementById(button(name).getAttribute('aria-controls'));
  await click('Page views');
  for (const name of ['Key metrics', 'Activity over time', 'Traffic composition', 'Top pages', 'Top sources', 'Top countries', 'Devices']) {
    await click(name);
    assert.equal(button(name).getAttribute('aria-expanded'), 'false');
    assert.equal(content(name).hidden, true);
  }
  await click('Collapse traffic overview');
  assert.equal(content('Expand traffic overview').hidden, true);
  await click('Expand traffic overview');
  assert.equal(content('Collapse traffic overview').hidden, false);
  for (const name of ['Key metrics', 'Activity over time', 'Traffic composition', 'Top pages', 'Top sources', 'Top countries', 'Devices']) {
    assert.equal(button(name).getAttribute('aria-expanded'), 'false');
    await click(name);
    assert.equal(content(name).hidden, false);
  }
  assert.equal(button('Page views').getAttribute('aria-pressed'), 'true');
  assert.equal(calls, 1);
});

test('collapsed sections stay closed when the time window and filters change', async () => {
  let calls = 0;
  const api = { visitors: { overview: async () => { calls++; return sample; } } };
  await render({ api });
  await act(async () => Simulate.click([...document.querySelectorAll('button')].find(b => b.textContent === 'Top sources')));
  await render({ api, range: { ...range, hours: 720 }, filters: { bot: 'ONLY' } });
  const toggle = [...document.querySelectorAll('button')].find(b => b.textContent === 'Top sources');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.getElementById(toggle.getAttribute('aria-controls')).hidden, true);
  assert.equal(calls, 2);
});
