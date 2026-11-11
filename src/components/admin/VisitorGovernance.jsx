import { useEffect, useId, useRef, useState } from 'react';
import { Archive, Check, ChevronDown, Download, FileCheck2, LockKeyhole, RefreshCw, ShieldCheck, UnlockKeyhole, X } from 'lucide-react';
import { verifyEvidencePackage } from '../../lib/visitorEvidence.mjs';
import styles from './VisitorGovernance.module.css';

const time = value => value ? new Date(value).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Not recorded';
const short = value => String(value || '').slice(0, 12);
const human = value => String(value || '').replaceAll('_', ' ');
const REASONS = [['incident_review', 'Incident review'], ['legal_preservation', 'Legal preservation'], ['data_quality', 'Data quality review']];
function save({ blob, filename }) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function VisitorGovernance({ api }) {
  const [expanded, setExpanded] = useState(false), [data, setData] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(''), [notice, setNotice] = useState('');
  const [verification, setVerification] = useState(null), [hold, setHold] = useState(null), [reason, setReason] = useState('incident_review');
  const [holdAction, setHoldAction] = useState('hold');
  const [revision, setRevision] = useState(0), mounted = useRef(true), lock = useRef(false), file = useRef(null), id = useId();
  const governance = api.visitorGovernance;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!expanded || !governance) return;
    const controller = new AbortController(); let active = true;
    setLoading(true); setError('');
    governance.overview({ signal: controller.signal }).then(value => { if (active) setData(value); })
      .catch(cause => { if (active) setError(cause.message || 'Governance unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [expanded, revision, governance]);
  async function act(key, work) {
    if (lock.current) return;
    lock.current = true; setBusy(key); setError(''); setNotice('');
    try { await work(); if (mounted.current) setRevision(value => value + 1); }
    catch (cause) { if (mounted.current) setError(cause.message || 'Operation failed. Refresh before retrying.'); }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  async function inspectFile(event) {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    await act('file', async () => {
      if (selected.size > 4_000_000) throw new Error('Evidence package exceeds the 4 MB limit.');
      setVerification({ ...await verifyEvidencePackage(JSON.parse(await selected.text())), offline: true });
    });
  }
  const counts = data?.counts || {}, disabled = Boolean(busy || loading);
  return <section className={styles.section} aria-label="Visitor governance" id="visitor-governance">
    <div className={styles.heading}>
      <div><h2><ShieldCheck size={18} /> Governance &amp; evidence</h2><p>Retention, integrity and access accountability</p></div>
      <button type="button" className={styles.iconButton} aria-label={`${expanded ? 'Collapse' : 'Expand'} visitor governance`}
        aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)} title={`${expanded ? 'Collapse' : 'Expand'} visitor governance`}>
        <ChevronDown size={18} className={!expanded ? styles.closed : ''} />
      </button>
    </div>
    <div id={id} hidden={!expanded}>
      {!governance && <p className={styles.notice}>Visitor governance is not configured.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <div className={styles.toolbar}>
        {data?.preview && <span className={styles.badge}>Synthetic data / in memory</span>}
        <span className={styles.scope}>All retained receipts · UTC</span>
        <button type="button" className={styles.iconButton} disabled={disabled || !governance} onClick={() => setRevision(value => value + 1)} title="Refresh governance" aria-label="Refresh governance"><RefreshCw size={16} /></button>
      </div>
      {loading && !data && <p className={styles.notice} role="status">Loading governance...</p>}
      {data && <>
        <div className={styles.stats}>
          {[['received', 'Received'], ['pending', 'Pending archive'], ['archived', 'Archived'], ['held', 'On hold'], ['expired', 'Expired']].map(([key, label]) =>
            <div key={key}><span>{label}</span><strong>{Number(counts[key] || 0).toLocaleString('en-US')}</strong></div>)}
        </div>
        <dl className={styles.controls}>
          <div><dt>Evidence retention</dt><dd>{data.policy.receiptRetentionDays} days</dd></div>
          <div><dt>Archive retention</dt><dd>{data.policy.archiveRetentionDays} days</dd></div>
          <div><dt>Independent timestamp</dt><dd className={styles.pending}>{human(data.externalControls.independentTimestamp)}</dd></div>
          <div><dt>Storage protection</dt><dd>{data.preview ? 'In-memory preview' : human(data.externalControls.storageProtection)}</dd></div>
          <div><dt>Audit retention</dt><dd>{data.policy.auditRetentionDays ? `${data.policy.auditRetentionDays} days` : 'Not recorded'}</dd></div>
          <div><dt>Expired metadata retention</dt><dd>{data.policy.tombstoneRetentionDays ? `${data.policy.tombstoneRetentionDays} days` : 'Not recorded'}</dd></div>
          <div><dt>Preservation window</dt><dd>{data.policy.holdDays ? `${data.policy.holdDays} days per approval` : 'Not recorded'}</dd></div>
          <div><dt>Last maintenance</dt><dd>{time(data.maintenance?.lastSuccessAt)}{data.maintenance?.status && <small className={styles.maintenanceStatus}>{human(data.maintenance.status)}</small>}</dd></div>
        </dl>
        <div className={styles.subheading}><h3>Evidence batches</h3><div className={styles.actions}>
          <input type="file" ref={file} accept="application/json,.json" hidden onChange={inspectFile} aria-label="Evidence package file" />
          <button type="button" disabled={disabled} onClick={() => file.current?.click()}><FileCheck2 size={15} /> Check file</button>
          <button type="button" disabled={disabled || !counts.pending} onClick={() => act('archive', async () => {
            const result = await governance.archive(); setNotice(result.status === 'empty' ? 'No pending receipts.' : `${result.archivedCount} receipts archived.`);
          })}><Archive size={15} /> {busy === 'archive' ? 'Archiving...' : 'Archive pending'}</button>
        </div></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}><thead><tr><th>Batch / SHA-256</th><th>Receipts</th><th>Retention eligible</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{data.latestBatches.map(batch => <tr key={batch.batchId}>
              <td data-label="Batch / SHA-256"><strong title={batch.batchId}>{short(batch.batchId)}</strong><code title={batch.manifestSha256}>{short(batch.manifestSha256)}...</code><small>{time(batch.createdAt)}</small></td>
              <td data-label="Receipts">{batch.receiptCount}</td><td data-label="Retention eligible">{time(batch.expiresAt)}</td>
              <td data-label="Status"><span className={batch.held ? styles.held : styles.badge}>{batch.held ? 'On hold' : human(batch.status)}</span>{batch.held && <small>Until {time(batch.holdExpiresAt)}</small>}</td>
              <td data-label="Actions"><div className={styles.actions}>
                <IconButton icon={FileCheck2} name={`Verify batch ${short(batch.batchId)}`} disabled={disabled || batch.status === 'expired'} onClick={() => act('verify', async () => setVerification(await governance.verify(batch.batchId)))} />
                <IconButton icon={Download} name={`Export evidence ${short(batch.batchId)}`} disabled={disabled || batch.status === 'expired'} onClick={() => act('export', async () => { save(await governance.export(batch.batchId)); setNotice('Minimized evidence package exported.'); })} />
                <IconButton icon={batch.held ? UnlockKeyhole : LockKeyhole} name={`${batch.held ? 'Release' : 'Place'} hold ${short(batch.batchId)}`} disabled={disabled || batch.status === 'expired'} onClick={() => { setHold(batch); setHoldAction(batch.held ? 'release' : 'hold'); setReason('incident_review'); }} />
                {batch.held && <IconButton icon={RefreshCw} name={`Renew hold ${short(batch.batchId)}`} disabled={disabled || batch.status === 'expired'} onClick={() => { setHold(batch); setHoldAction('renew'); setReason(batch.holdReason || 'incident_review'); }} />}
              </div></td>
            </tr>)}</tbody></table>
          {!data.latestBatches.length && <p className={styles.notice}>No archives yet.</p>}
        </div>
        {hold && <form className={styles.review} onSubmit={event => { event.preventDefault(); act('hold', async () => {
          await governance.hold(hold.batchId, reason, holdAction === 'release'); setHold(null); setNotice(holdAction === 'release' ? 'Preservation hold released.' : holdAction === 'renew' ? 'Preservation hold renewed.' : 'Preservation hold recorded.');
        }); }} aria-label="Preservation review">
          <div><h3>{holdAction === 'release' ? 'Release preservation hold' : holdAction === 'renew' ? 'Renew preservation hold' : 'Preserve evidence batch'}</h3><p>{short(hold.batchId)} · {hold.receiptCount} receipts. Only this evidence batch; raw logs retain their existing policy.</p>{holdAction !== 'release' && <p>Preservation expires after {data.policy.holdDays || 90} days unless renewed. This is not a court-ordered legal hold.</p>}</div>
          <label>Reason<select value={reason} onChange={event => setReason(event.target.value)}>{REASONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <div className={styles.actions}><button type="submit" disabled={disabled}><Check size={15} /> Confirm {holdAction === 'renew' ? 'renewal' : holdAction}</button><button type="button" disabled={disabled} onClick={() => setHold(null)}><X size={15} /> Cancel</button></div>
        </form>}
        {verification && <div className={verification.status === 'verified' ? styles.result : styles.error} role="status">
          <strong>{verification.status === 'verified' ? 'Integrity checks passed' : verification.status === 'expired' ? 'Evidence expired' : 'Integrity check failed'}</strong>
          <span>{short(verification.batchId)} · Manifest: {verification.manifestValid == null ? 'unavailable' : verification.manifestValid ? 'match' : 'mismatch'} · Receipts: {verification.receiptHashesValid == null ? 'unavailable' : verification.receiptHashesValid ? 'match' : 'mismatch'}</span>
          <span>Source comparison: {human(verification.sourceIntegrity)}{verification.offline ? ' (local file)' : ''}. Integrity is not proof of visitor identity or an independent timestamp.</span>
        </div>}
        <div className={styles.subheading}><h3>Access &amp; change audit</h3><span className={styles.scope}>Latest 20 entries</span></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Time (UTC)</th><th>Action</th><th>Actor</th><th>Scope / outcome</th></tr></thead>
          <tbody>{data.latestAudit.map(item => <tr key={item.auditId}><td data-label="Time (UTC)">{time(item.occurredAt)}</td><td data-label="Action">{human(item.action)}{item.reason && <small>{human(item.reason)}</small>}</td>
            <td data-label="Actor"><code title={item.actor}>{short(item.actor)}</code></td><td data-label="Scope / outcome">{item.batchId ? short(item.batchId) : human(item.target)}<small>{human(item.outcome)}{item.affectedCount ? ` · ${item.affectedCount} records` : ''}</small></td></tr>)}</tbody></table>
          {!data.latestAudit.length && <p className={styles.notice}>No audit entries recorded.</p>}
        </div>
        <p className={styles.footnote}>{data.policy.policyVersion} · {data.policy.scheduledArchiveEnabled ? 'Scheduled archive enabled' : 'Manual archive'} · Batch limit {data.policy.defaultBatchSize}. Retention dates indicate eligibility, not confirmed deletion. These records do not prove identity or complete browsing history.</p>
      </>}
    </div>
  </section>;
}

function IconButton({ name, icon: Icon, ...props }) {
  return <button type="button" title={name} aria-label={name} className={styles.iconButton} {...props}><Icon size={16} /></button>;
}
