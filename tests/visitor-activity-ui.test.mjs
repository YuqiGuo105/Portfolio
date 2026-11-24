import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as activity from '../src/lib/visitorActivity.mjs';
import * as diagnostics from '../src/lib/visitorBotDiagnostics.mjs';
import * as workbench from '../src/lib/visitorWorkbench.mjs';
import { activityFixtures } from '../src/lib/visitorActivityPreview.mjs';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'), { createRoot } = require('react-dom/client');
const { act, Simulate } = require('react-dom/test-utils'), { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/admin/VisitorActivity.jsx', import.meta.url), 'utf8'), {
  filename: 'VisitorActivity.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => name.includes('visitorActivity.mjs') ? activity : name.includes('visitorBotDiagnostics.mjs') ? diagnostics
  : name.includes('visitorWorkbench.mjs') ? workbench
  : name.endsWith('.css') ? { __esModule: true, default: {} } : require(name), exports);
let root;
const render = props => act(async () => root.render(React.createElement(exports.default, props)));
const button = label => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent) === label);
const click = label => act(async () => Simulate.click(button(label)));
const metric = name => [...document.querySelectorAll('[aria-live="polite"] span')].find(e => e.textContent === name).parentNode.querySelector('strong').textContent;
const select = (label, value) => act(async () => Simulate.change(document.querySelector(`[aria-label="${label}"]`), { target: { value } }));
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')); });
afterEach(() => act(() => root.unmount()));
after(() => dom.window.close());

test('collapsed activity performs no request; grouping, threshold and tabs are local only', async () => {
  let calls = 0, args;
  const api = { visitors: { list: async query => { calls++; args = query; return { items: activityFixtures() }; } } };
  await render({ api }); assert.equal(calls, 0);
  await click('Expand activity'); assert.equal(calls, 1); assert.equal(args.size, 100); assert.equal(args.view, 'events');
  assert.equal(metric('Records shown'), '27 / 27'); assert.equal(metric('Candidate sessions'), '3');
  await select('Activity grouping', '5'); assert.equal(metric('Sessions / groups'), '7 / 4');
  await select('Activity review threshold', '70'); assert.equal(metric('Candidate sessions'), '0');
  await select('Activity traffic', 'review'); assert.equal(metric('Records shown'), '1 / 27');
  await select('Activity traffic', 'all');
  await click('Widget events'); assert.match(document.body.textContent, /chat/);
  assert.match(document.body.textContent, /link copied/);
  await click('Click destinations');
  assert.ok(document.querySelector('a[href="https://github.com/YuqiGuo105"]'));
  assert.match(document.body.textContent, /Content Intelligence Platform/);
  assert.match(document.body.textContent, /LinkedIn link/);
  await click('Video performance'); assert.match(document.body.textContent, /yuqi-intro/);
  assert.equal(calls, 1);
  await click('Refresh activity'); assert.equal(calls, 2);
});

test('request failure stays explicit and stale responses cannot replace new filters', async () => {
  const pending = [];
  const api = { visitors: { list: (args, options) => new Promise((resolve, reject) => pending.push({ args, ...options, resolve, reject })) } };
  await render({ api, initialExpanded: true });
  await render({ api, initialExpanded: true, filters: { bot: 'ONLY' } });
  assert.equal(pending[0].signal.aborted, true);
  await act(async () => pending[1].reject(new Error('Offline')));
  await act(async () => pending[0].resolve({ items: activityFixtures() }));
  assert.match(document.querySelector('[role="alert"]').textContent, /Offline/);
  assert.equal(document.querySelector('[aria-live="polite"]'), null);
  await click('Refresh activity');
  await act(async () => pending[2].resolve({ items: [] }));
  assert.equal(metric('Records shown'), '0 / 0');
});
