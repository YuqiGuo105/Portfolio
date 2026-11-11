import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as evidence from '../src/lib/visitorEvidence.mjs';
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'), { createRoot } = require('react-dom/client'), { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/admin/VisitorGovernance.jsx', import.meta.url), 'utf8'), {
  filename: 'VisitorGovernance.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => name.endsWith('.css') ? { __esModule: true, default: {} } : name.includes('visitorEvidence') ? evidence : require(name), exports);
let root;
const sample = { preview: true, counts: { received: 1, archived: 1 }, policy: { receiptRetentionDays: 30, archiveRetentionDays: 30, policyVersion: 'test', defaultBatchSize: 100 },
  externalControls: { independentTimestamp: 'not_configured' }, latestAudit: [], latestBatches: [{ batchId: 'sample-batch', receiptCount: 1, status: 'archived', manifestSha256: 'a'.repeat(64) }] };
const button = name => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent) === name);
const click = name => act(async () => Simulate.click(button(name)));
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')); });
afterEach(() => act(() => root.unmount()));
after(() => dom.window.close());
const render = api => act(async () => root.render(React.createElement(exports.default, { api })));

test('governance is lazy, cancels hidden reads and cannot claim missing data is zero', async () => {
  const calls = [];
  await render({ visitorGovernance: { overview: options => new Promise(resolve => calls.push({ ...options, resolve })) } });
  assert.equal(calls.length, 0);
  await click('Expand visitor governance'); assert.equal(calls.length, 1);
  await click('Collapse visitor governance'); assert.equal(calls[0].signal.aborted, true);
  await act(async () => calls[0].resolve(sample));
  assert.doesNotMatch(document.body.textContent, /Evidence batches/);
});

test('failure stays visible and refresh recovers; independent timestamp is not claimed', async () => {
  let calls = 0;
  await render({ visitorGovernance: { overview: async () => { if (++calls === 1) throw new Error('Not configured'); return sample; } } });
  await click('Expand visitor governance');
  assert.match(document.querySelector('[role="alert"]').textContent, /Not configured/);
  assert.doesNotMatch(document.body.textContent, /Evidence batches/);
  await click('Refresh governance');
  assert.match(document.body.textContent, /not configured/);
  assert.match(document.body.textContent, /Synthetic data/);
});

test('hold requires review and confirmation; verify reports exact integrity scope', async () => {
  const held = [];
  await render({ visitorGovernance: { overview: async () => sample, hold: async (...args) => held.push(args),
    verify: async () => ({ batchId: 'sample-batch', status: 'verified', manifestValid: true, receiptHashesValid: true, sourceIntegrity: 'partial' }) } });
  await click('Expand visitor governance');
  await click('Place hold sample-batch'); assert.equal(held.length, 0);
  await act(async () => Simulate.submit(document.querySelector('form')));
  assert.deepEqual(held[0], ['sample-batch', 'incident_review', false]);
  await click('Verify batch sample-batch');
  assert.match(document.body.textContent, /Integrity checks passed/);
  assert.match(document.body.textContent, /Source comparison: partial/);
  assert.match(document.body.textContent, /not proof of visitor identity/);
});

test('retention and maintenance are explicit; hold renewal needs confirmation', async () => {
  const calls = [];
  const current = { ...sample, policy: { ...sample.policy, auditRetentionDays: 180, tombstoneRetentionDays: 180, holdDays: 90 },
    maintenance: { lastSuccessAt: null, status: 'never_run' }, latestBatches: [{ ...sample.latestBatches[0], held: true, holdReason: 'data_quality', holdExpiresAt: '2027-02-09T12:00:00Z' }] };
  await render({ visitorGovernance: { overview: async () => current, hold: async (...args) => calls.push(args) } });
  await click('Expand visitor governance');
  assert.match(document.body.textContent, /Audit retention180 days/);
  assert.match(document.body.textContent, /Last maintenanceNot recordednever run/);
  assert.match(document.body.textContent, /Until Feb 9/);
  await click('Renew hold sample-batch');
  assert.equal(calls.length, 0);
  assert.match(document.querySelector('form').textContent, /not a court-ordered legal hold/);
  await act(async () => Simulate.submit(document.querySelector('form')));
  assert.deepEqual(calls[0], ['sample-batch', 'data_quality', false]);
});
