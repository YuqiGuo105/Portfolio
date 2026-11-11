import { canonicalJson, sha256, verifyEvidencePackage } from './visitorEvidence.mjs';

const CONTROLS = { independentTimestamp: 'not_configured', storageProtection: 'local_database', authenticity: 'local_integrity_only' };
const REASONS = ['incident_review', 'legal_preservation', 'data_quality'];

// Interactive synthetic fixture. Nothing is persisted or sent to an API.
export function createVisitorGovernancePreview(events, now = Date.now()) {
  const batches = [], packages = new Map(), audit = [];
  let pending = [], received = 0, serial = 0;
  const stamp = () => new Date().toISOString();
  const expires = new Date(now + 90 * 86400000).toISOString();
  const record = (action, batchId = null, count = 0, reason = null) => {
    audit.unshift({ auditId: String(++serial), occurredAt: stamp(), actor: 'sample-admin', action, target: 'visitor_governance',
      batchId, reason, affectedCount: count, outcome: 'success' });
    audit.splice(20);
  };
  async function archive(limit = 100) {
    if (!pending.length) return { status: 'empty', batch: null, archivedCount: 0 };
    const receipts = pending.splice(0, limit), batchId = globalThis.crypto.randomUUID();
    const manifest = { schemaVersion: 1, policyVersion: 'visitor-evidence-v1', batchId, createdAt: stamp(), expiresAt: expires,
      externalControls: CONTROLS, receipts };
    const canonicalManifest = canonicalJson(manifest), manifestSha256 = await sha256(canonicalManifest);
    const batch = { batchId, createdAt: manifest.createdAt, expiresAt: expires, receiptCount: receipts.length,
      manifestSha256, status: 'archived', held: false, holdReason: null };
    packages.set(batchId, { batchId, manifestSha256, canonicalManifest, manifest });
    batches.unshift(batch); record('archive_created', batchId, receipts.length);
    return { status: 'archived', batch: { ...batch }, archivedCount: receipts.length };
  }
  let initialization;
  async function ready() {
    if (!initialization) initialization = (async () => {
      for (const [index, event] of events.slice(-18).entries()) {
        const evidence = { schemaVersion: 1, policyVersion: 'visitor-evidence-v1', siteId: 'preview.local', eventName: event.eventName,
          eventTime: event.eventTime, pagePath: ['/', '/mcp-guide'].includes(event.pageUrl) ? event.pageUrl : '[other]',
          progressPercent: [25, 50, 75, 100].includes(event.properties?.progressPercent) ? event.properties.progressPercent : null,
          provenance: { eventTime: 'browser_asserted', pagePath: 'browser_asserted', progressPercent: 'browser_asserted', receivedAt: 'synthetic_fixture' } };
        const canonicalEvidence = canonicalJson(evidence);
        pending.push({ receiptId: String(index + 1), eventRef: await sha256(event.eventId), receivedAt: event.serverTime,
          expiresAt: expires, canonicalEvidence, evidenceSha256: await sha256(canonicalEvidence) });
      }
      received = pending.length;
      await archive(8);
    })();
    await initialization;
  }
  return {
    record,
    async overview() {
      await ready(); record('governance_overview');
      return { enabled: true, preview: true, policy: { policyVersion: 'visitor-evidence-v1', schemaVersion: 1,
        receiptRetentionDays: 90, archiveRetentionDays: 90, auditRetentionDays: 180, tombstoneRetentionDays: 180, holdDays: 90, maxBatchSize: 500, defaultBatchSize: 100,
        scheduledArchiveEnabled: false, holdScope: 'governance_batch_only' },
        counts: { received, pending: pending.length, archived: received - pending.length, expired: 0,
          held: batches.filter(batch => batch.held).reduce((sum, batch) => sum + batch.receiptCount, 0) },
        latestBatches: batches.map(batch => ({ ...batch })), latestAudit: [...audit], externalControls: CONTROLS,
        maintenance: { lastSuccessAt: null, status: 'not_run_in_preview' } };
    },
    async archive() { await ready(); return archive(); },
    async verify(batchId) {
      await ready(); const bundle = packages.get(batchId); if (!bundle) throw new Error('Sample batch not found.');
      const result = await verifyEvidencePackage(bundle); record('batch_verified', batchId, bundle.manifest.receipts.length);
      return { ...result, verifiedAt: stamp(), sourceIntegrity: 'not_checked', sourceCheckedCount: 0, sourceMissingCount: 0, sourceMismatchCount: 0 };
    },
    async export(batchId) {
      await ready(); const bundle = packages.get(batchId); if (!bundle) throw new Error('Sample batch not found.');
      record('evidence_export', batchId, bundle.manifest.receipts.length);
      return { blob: new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), filename: `sample-evidence-${batchId}.json` };
    },
    async hold(batchId, reason, release = false) {
      await ready(); if (!REASONS.includes(reason)) throw new Error('Select a preservation reason.');
      const batch = batches.find(item => item.batchId === batchId); if (!batch) throw new Error('Sample batch not found.');
      const renewed = batch.held && !release;
      const changed = batch.held !== !release || renewed;
      batch.held = !release; batch.holdReason = release ? null : reason;
      batch.holdExpiresAt = release ? null : new Date(Date.now() + 90 * 86400000).toISOString();
      record(release ? 'hold_released' : renewed ? 'hold_renewed' : 'hold_placed', batchId, batch.receiptCount, reason);
      return { batch: { ...batch }, changed };
    },
  };
}
