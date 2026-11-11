import assert from 'node:assert/strict';
import { test } from 'node:test';
import { governanceHealth, latestArchiveChecks } from '../src/lib/visitorGovernanceStatus.mjs';

const now = Date.parse('2026-11-10T12:00:00Z');
const healthy = { enabled: true, maintenance: { status: 'completed', lastSuccessAt: new Date(now - 1000).toISOString(), intervalSeconds: 60 }, latestAudit: [] };
const entry = (batchId, outcome, offset = 0) => ({ action: 'verify', batchId, outcome, occurredAt: new Date(now + offset).toISOString() });

test('only the newest explicit archive check counts; downloads and unknown outcomes are not verification', () => {
  const checks = latestArchiveChecks([
    entry('a', 'tampered', -2000), entry('a', 'verified'), entry('b', 'tampered', -1000),
    { ...entry('c', 'verified'), action: 'export' }, entry('d', 'success'),
  ]);
  assert.equal(checks.size, 2);
  assert.equal(checks.get('a').outcome, 'verified');
  assert.equal(checks.get('b').outcome, 'tampered');
});

test('maintenance success is not proof that every archive was checked', () => {
  const state = governanceHealth(healthy, now);
  assert.equal(state.tone, 'success');
  assert.equal(state.title, 'Latest maintenance completed');
  assert.match(state.description, /Unchecked archives are not verified/);
  assert.equal(governanceHealth({ ...healthy, counts: { pending: 100 } }, now).tone, 'success');
});

test('failed, overdue, paused and mismatched states are actionable', () => {
  assert.match(governanceHealth({ ...healthy, maintenance: { status: 'failed' } }, now).description, /maintenance failed/);
  assert.match(governanceHealth(healthy, now + 121000).description, /overdue/);
  assert.match(governanceHealth({ ...healthy, enabled: false }, now).description, /paused/);
  const failed = governanceHealth({ ...healthy, latestAudit: [entry('b', 'tampered'), entry('a', 'verified')] }, now);
  assert.equal(failed.tone, 'warning');
  assert.match(failed.description, /1 archive needs review/);
});

test('preview and unknown maintenance are explicit; expired records are not tampering', () => {
  assert.equal(governanceHealth({ preview: true }, now).title, 'Sample records only');
  assert.equal(governanceHealth({}, now).title, 'Maintenance not confirmed');
  assert.equal(governanceHealth({ ...healthy, latestAudit: [entry('a', 'expired')] }, now).tone, 'success');
  assert.equal(governanceHealth({ ...healthy, maintenance: { status: 'completed', lastSuccessAt: 'invalid' } }, now).tone, 'neutral');
});
