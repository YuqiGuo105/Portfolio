import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as evidence from '../src/lib/visitorEvidence.mjs';
import * as governanceStatus from '../src/lib/visitorGovernanceStatus.mjs';
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
new Function('require', 'exports', code)(name => name.endsWith('.css') ? { __esModule: true, default: {} } : name.includes('visitorEvidence') ? evidence : name.includes('visitorGovernanceStatus') ? governanceStatus : require(name), exports);
let root;
const sample = { preview: true, counts: { received: 1, archived: 1 }, policy: { receiptRetentionDays: 30, archiveRetentionDays: 30, policyVersion: 'test', defaultBatchSize: 100 },
  externalControls: { independentTimestamp: 'not_configured' }, latestAudit: [], latestBatches: [{ batchId: 'sample-batch', receiptCount: 1, status: 'archived', manifestSha256: 'a'.repeat(64) }] };
const button = name => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === name);
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
  assert.doesNotMatch(document.body.textContent, /Saved archives/);
});

test('failure stays visible and refresh recovers; independent timestamp is not claimed', async () => {
  let calls = 0;
  await render({ visitorGovernance: { overview: async () => { if (++calls === 1) throw new Error('Not configured'); return sample; } } });
  await click('Expand visitor governance');
  assert.match(document.querySelector('[role="alert"]').textContent, /Not configured/);
  assert.doesNotMatch(document.body.textContent, /Saved archives/);
  await click('Refresh governance');
  assert.match(document.body.textContent, /not connected/);
  assert.match(document.body.textContent, /Sample data/);
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
  assert.match(document.body.textContent, /source comparison is incomplete/);
  const result = [...document.querySelectorAll('[role="status"]')].find(node => node.textContent.includes('Integrity checks passed'));
  assert.equal(result.closest('details'), null);
});

test('retention and maintenance are explicit; hold renewal needs confirmation', async () => {
  const calls = [];
  const current = { ...sample, policy: { ...sample.policy, auditRetentionDays: 180, tombstoneRetentionDays: 180, holdDays: 90 },
    maintenance: { lastSuccessAt: null, status: 'never_run' }, latestBatches: [{ ...sample.latestBatches[0], held: true, holdReason: 'data_quality', holdExpiresAt: '2027-02-09T12:00:00Z' }] };
  await render({ visitorGovernance: { overview: async () => current, hold: async (...args) => calls.push(args) } });
  await click('Expand visitor governance');
  assert.match(document.body.textContent, /Admin activity retained180 days/);
  assert.match(document.body.textContent, /Last maintenance: Not recorded/);
  assert.match(document.body.textContent, /Background maintenancenever runNot recorded/);
  assert.match(document.body.textContent, /Until Feb 9/);
  await click('Renew hold sample-batch');
  assert.equal(calls.length, 0);
  assert.match(document.querySelector('form').textContent, /not a court-ordered legal hold/);
  await act(async () => Simulate.submit(document.querySelector('form')));
  assert.deepEqual(calls[0], ['sample-batch', 'data_quality', false]);
});

test('technical details start collapsed; missing counts and unchecked archives are not healthy zeroes', async () => {
  await render({ visitorGovernance: { overview: async () => sample } });
  await click('Expand visitor governance');
  for (const details of document.querySelectorAll('details')) assert.equal(details.open, false);
  assert.match(document.body.textContent, /Waiting to archiveNot available/);
  assert.match(document.body.textContent, /Event records, not unique visitors/);
  assert.match(document.body.textContent, /Recent archive check: Not checked recently/);
  assert.match(document.body.textContent, /No recent integrity check/);
  assert.doesNotMatch(document.body.textContent, /Integrity check passed|All records verified/);
  const settings = [...document.querySelectorAll('details')].find(node => node.firstChild.textContent.includes('Retention & protection settings'));
  settings.open = true;
  assert.equal(settings.open, true);
});

test('maintenance failures and archive mismatches remain visible outside technical disclosures', async () => {
  const current = { ...sample, preview: false, maintenance: { status: 'failed' }, latestAudit: [{
    auditId: 'audit-1', action: 'verify', batchId: 'sample-batch', outcome: 'tampered', occurredAt: '2026-11-10T12:00:00Z',
  }] };
  await render({ visitorGovernance: { overview: async () => current } });
  await click('Expand visitor governance');
  const alert = document.querySelector('[role="alert"]');
  assert.match(alert.textContent, /Needs attention/);
  assert.match(alert.textContent, /maintenance failed/);
  assert.match(alert.textContent, /1 archive needs review/);
  assert.equal(alert.closest('details'), null);
  assert.match(document.body.textContent, /Check failed · Review needed/);
});

test('refresh failure retains the snapshot without claiming current health', async () => {
  let calls = 0;
  await render({ visitorGovernance: { overview: async () => {
    if (++calls > 1) throw new Error('Refresh failed');
    return { ...sample, preview: false, maintenance: { status: 'completed', lastSuccessAt: new Date().toISOString(), intervalSeconds: 60 } };
  } } });
  await click('Expand visitor governance');
  assert.match(document.body.textContent, /Latest maintenance completed/);
  await click('Refresh governance');
  assert.match(document.body.textContent, /Current status unavailable/);
  assert.doesNotMatch(document.body.textContent, /Latest maintenance completed/);
  assert.match(document.body.textContent, /Saved archives/);
});

test('archiving refreshes counts and does not add a polling loop', async () => {
  let reads = 0, writes = 0;
  await render({ visitorGovernance: {
    overview: async () => { reads++; return { ...sample, counts: { received: 3, archived: writes ? 3 : 1, pending: writes ? 0 : 2, held: 0, expired: 0 } }; },
    archive: async () => { writes++; return { status: 'archived', archivedCount: 2 }; },
  } });
  await click('Expand visitor governance');
  assert.equal(reads, 1);
  await click('Archive waiting records');
  assert.equal(writes, 1); assert.equal(reads, 2);
  assert.match(document.body.textContent, /2 event records saved in a new archive/);
  assert.match(document.body.textContent, /Waiting to archive0Nothing waiting/);
  assert.equal(button('Archive waiting records').disabled, true);
});

test('a mismatched downloaded file stays visibly failed and cannot replace an archive check', async () => {
  const manifest = { schemaVersion: 1, batchId: 'download-1', receipts: [] };
  const bundle = { batchId: manifest.batchId, canonicalManifest: JSON.stringify(manifest), manifest, manifestSha256: '0'.repeat(64) };
  await render({ visitorGovernance: { overview: async () => sample } });
  await click('Expand visitor governance');
  const input = document.querySelector('input[type="file"]');
  await act(async () => Simulate.change(input, { target: { files: [{ size: 400, text: async () => JSON.stringify(bundle) }], value: 'sample.json' } }));
  assert.match(document.querySelector('[role="alert"]').textContent, /Downloaded file: Integrity check failed/);
  assert.match(document.body.textContent, /not the live database/);
  assert.match(document.body.textContent, /Recent archive check: Not checked recently/);
});
