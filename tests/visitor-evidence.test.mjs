import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisitorPreviewApi } from '../src/lib/visitorPreview.mjs';
import { canonicalJson, sha256, verifyEvidencePackage } from '../src/lib/visitorEvidence.mjs';

test('sample archive, verify, export and holds work without external requests', async () => {
  const api = createVisitorPreviewApi().visitorGovernance;
  const initial = await api.overview();
  assert.equal(initial.preview, true);
  assert.equal(initial.counts.received, 18);
  assert.equal(initial.counts.archived, 8);
  assert.equal(initial.counts.pending, 10);
  assert.equal(initial.externalControls.independentTimestamp, 'not_configured');
  const batch = initial.latestBatches[0];
  const checked = await api.verify(batch.batchId);
  assert.equal(checked.status, 'verified');
  assert.equal(checked.sourceIntegrity, 'not_checked');
  await api.hold(batch.batchId, 'incident_review');
  assert.equal((await api.overview()).counts.held, 8);
  const file = await api.export(batch.batchId);
  const bytes = await file.blob.text();
  assert.doesNotMatch(bytes, /ipAddress|198\.51|203\.0|userAgent|anonymousId|sessionId|latitude|longitude|private=|linkedin\.com/);
  assert.equal((await verifyEvidencePackage(JSON.parse(bytes))).status, 'verified');
  await api.hold(batch.batchId, 'data_quality', true);
  assert.equal((await api.overview()).counts.held, 0);
  assert.equal((await api.archive()).archivedCount, 10);
  assert.equal((await api.archive()).status, 'empty');
  const final = await api.overview();
  assert.equal(final.counts.archived, 18);
  assert.ok(final.latestAudit.some(item => item.action === 'evidence_export'));
  assert.ok(final.latestAudit.some(item => item.action === 'hold_released'));
});

test('file verification detects modified bytes, inconsistent convenience JSON and changed receipt payloads', async () => {
  const api = createVisitorPreviewApi().visitorGovernance;
  const { latestBatches: [batch] } = await api.overview();
  const bundle = JSON.parse(await (await api.export(batch.batchId)).blob.text());
  assert.equal((await verifyEvidencePackage({ ...bundle, canonicalManifest: bundle.canonicalManifest + ' ' })).status, 'tampered');
  const changed = structuredClone(bundle); changed.manifest.createdAt = 'forged';
  assert.equal((await verifyEvidencePackage(changed)).status, 'tampered');
  const receiptChanged = structuredClone(bundle); receiptChanged.manifest.receipts[0].canonicalEvidence += ' ';
  receiptChanged.canonicalManifest = canonicalJson(receiptChanged.manifest);
  receiptChanged.manifestSha256 = await sha256(receiptChanged.canonicalManifest);
  assert.equal((await verifyEvidencePackage(receiptChanged)).receiptHashesValid, false);
  const duplicate = structuredClone(bundle); duplicate.manifest.receipts.push(duplicate.manifest.receipts[0]);
  duplicate.canonicalManifest = canonicalJson(duplicate.manifest); duplicate.manifestSha256 = await sha256(duplicate.canonicalManifest);
  assert.equal((await verifyEvidencePackage(duplicate)).status, 'tampered');
});

test('file parsing rejects oversized, invalid and unsupported data', async () => {
  await assert.rejects(verifyEvidencePackage(null), /Invalid/);
  await assert.rejects(verifyEvidencePackage({ canonicalManifest: 'x'.repeat(4_000_001), manifestSha256: 'a'.repeat(64) }), /Invalid/);
  await assert.rejects(verifyEvidencePackage({ canonicalManifest: '{}', manifestSha256: 'a'.repeat(64) }), /Unsupported/);
  await assert.rejects(verifyEvidencePackage({ canonicalManifest: 'not-json', manifestSha256: 'a'.repeat(64) }), /Invalid/);
});
