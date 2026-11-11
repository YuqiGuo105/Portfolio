import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Archive, Check, CheckCircle2, ChevronDown, Clock3, Download, FileCheck2, Info, LockKeyhole, RefreshCw, ShieldCheck, UnlockKeyhole, X } from 'lucide-react';
import { verifyEvidencePackage } from '../../lib/visitorEvidence.mjs';
import { governanceHealth, latestArchiveChecks } from '../../lib/visitorGovernanceStatus.mjs';
import styles from './VisitorGovernance.module.css';

const time = value => value ? new Date(value).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Not recorded';
const short = value => String(value || '').slice(0, 12);
const human = value => String(value || '').replaceAll('_', ' ');
const amount = value => value == null ? 'Not available' : Number(value).toLocaleString('en-US');
const days = value => value == null ? 'Not recorded' : `${value} days`;
const REASONS = [['incident_review', 'Incident review'], ['legal_preservation', 'Legal preservation'], ['data_quality', 'Data quality review']];
const ACTIONS = { overview: 'Viewed protection status', governance_overview: 'Viewed protection status', archive: 'Archive operation', archive_created: 'Created archive', verify: 'Checked archive', export: 'Evidence download', evidence_export: 'Evidence download', visitor_read: 'Viewed visitor records', visitor_export: 'Visitor data export', hold_placed: 'Preserved archive', hold_renewed: 'Renewed preservation', hold_released: 'Released preservation' };
function save({ blob, filename }) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function VisitorGovernance({ api }) {
  const [expanded, setExpanded] = useState(false), [data, setData] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(''), [notice, setNotice] = useState('');
  const [verification, setVerification] = useState(null), [hold, setHold] = useState(null), [reason, setReason] = useState('incident_review');
  const [holdAction, setHoldAction] = useState('hold'), [loadedAt, setLoadedAt] = useState(0);
  const [revision, setRevision] = useState(0), mounted = useRef(true), lock = useRef(false), file = useRef(null), id = useId();
  const governance = api.visitorGovernance;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!expanded || !governance) return;
    const controller = new AbortController(); let active = true;
    setLoading(true); setError('');
    governance.overview({ signal: controller.signal }).then(value => { if (active) { setData(value); setLoadedAt(Date.now()); } })
      .catch(cause => { if (active) setError(cause.message || 'Record protection status unavailable.'); })
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
    setVerification(null);
    await act('file', async () => {
      if (selected.size > 4_000_000) throw new Error('Evidence package exceeds the 4 MB limit.');
      setVerification({ ...await verifyEvidencePackage(JSON.parse(await selected.text())), offline: true });
    });
  }
  const counts = data?.counts || {}, disabled = Boolean(busy || loading);
  const checks = latestArchiveChecks(data?.latestAudit);
  const health = data && (error ? { tone: 'neutral', title: 'Current status unavailable', description: 'The last loaded records are shown below. Refresh to confirm the current status.' } : governanceHealth(data, loadedAt));
  const HealthIcon = health?.tone === 'warning' ? AlertTriangle : health?.tone === 'success' ? CheckCircle2 : Info;
  const recentCheck = checks.values().next().value;
  return <section className={styles.section} aria-label="Visitor governance" id="visitor-governance">
    <div className={styles.heading}>
      <div><h2><ShieldCheck size={18} /> Visitor record protection</h2><p>Archive status &amp; recent checks</p></div>
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
        {data?.preview && <span className={styles.badge}>Local preview · Sample data</span>}
        <span className={styles.scope}>All retained event records · UTC</span>
        <button type="button" className={styles.iconButton} disabled={disabled || !governance} onClick={() => setRevision(value => value + 1)} title="Refresh governance" aria-label="Refresh governance"><RefreshCw size={16} /></button>
      </div>
      {loading && !data && <p className={styles.notice} role="status">Loading record protection...</p>}
      {data && <>
        <div className={styles.stats}>
          <Stat icon={Archive} label="Archived" value={counts.archived} tone="success" detail="Event records in saved archives" />
          <Stat icon={Clock3} label="Waiting to archive" value={counts.pending} tone="pending" detail={counts.pending === 0 ? 'Nothing waiting' : data.policy.scheduledArchiveEnabled ? 'Scheduled for background archiving' : 'Ready for manual archiving'} />
          <Stat icon={ShieldCheck} label="Total received" value={counts.received} detail="Event records, not unique visitors" />
        </div>
        <div className={styles.secondaryStats}><span><LockKeyhole size={13} /> Preserved <b>{amount(counts.held)}</b></span><span>Expired <b>{amount(counts.expired)}</b></span><small>Preserved records are included in Archived.</small></div>
        <div className={styles.health} data-tone={health.tone} role={health.tone === 'warning' ? 'alert' : 'status'}>
          <HealthIcon size={19} /><div><strong>{health.title}</strong><p>{health.description}</p>
            <div className={styles.healthMeta}><span>Last maintenance: <b>{time(data.maintenance?.lastSuccessAt)}</b></span><span>Recent archive check: <b>{recentCheck ? `${recentCheck.outcome === 'verified' ? 'Passed' : recentCheck.outcome === 'tampered' ? 'Mismatch found' : 'Expired'} · ${time(recentCheck.occurredAt)}` : 'Not checked recently'}</b></span></div>
          </div>
        </div>
        {verification && <VerificationResult value={verification} />}
        <div className={styles.subheading}><div><h3>Saved archives</h3><p className={styles.scope}>Latest {data.latestBatches.length} {data.latestBatches.length === 1 ? 'archive' : 'archives'} · Each archive groups multiple event records</p></div><div className={styles.actions}>
          <input type="file" ref={file} accept="application/json,.json" hidden onChange={inspectFile} aria-label="Evidence package file" />
          <button type="button" disabled={disabled} onClick={() => file.current?.click()}><FileCheck2 size={15} /> Check downloaded file</button>
          <button type="button" className={styles.primary} disabled={disabled || !counts.pending} onClick={() => act('archive', async () => {
            const result = await governance.archive(); setNotice(result.status === 'empty' ? 'No records waiting to archive.' : `${result.archivedCount} event records saved in a new archive.`);
          })}><Archive size={15} /> {busy === 'archive' ? 'Archiving...' : 'Archive waiting records'}</button>
        </div></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}><thead><tr><th>Archived on (UTC)</th><th>Event records</th><th>Status / latest check</th><th>Actions</th></tr></thead>
            <tbody>{data.latestBatches.map(batch => {
              const check = checks.get(batch.batchId);
              return <tr key={batch.batchId}>
                <td data-label="Archived on (UTC)"><strong>{time(batch.createdAt)}</strong><details className={styles.batchDetails}><summary>Archive details <ChevronDown size={12} /></summary><dl><dt>Archive ID</dt><dd><code>{batch.batchId}</code></dd><dt>SHA-256 fingerprint</dt><dd><code>{batch.manifestSha256}</code></dd><dt>Eligible for cleanup</dt><dd>{time(batch.expiresAt)}</dd></dl></details></td>
                <td data-label="Event records"><strong>{amount(batch.receiptCount)}</strong></td>
                <td data-label="Status / latest check"><span className={batch.held ? styles.held : styles.badge}>{batch.status === 'expired' ? 'Expired' : batch.held ? 'Preserved' : batch.status === 'archived' ? 'Archived' : human(batch.status)}</span>{batch.held && <small>Until {time(batch.holdExpiresAt)}</small>}<small className={check?.outcome === 'tampered' ? styles.failedCheck : ''}>{check ? check.outcome === 'verified' ? 'Integrity check passed' : check.outcome === 'tampered' ? 'Check failed · Review needed' : 'Contents expired' : 'No recent integrity check'}</small></td>
                <td data-label="Actions"><div className={styles.actions}>
                  <IconButton icon={FileCheck2} name={`Verify batch ${short(batch.batchId)}`} disabled={disabled || batch.status === 'expired'} onClick={() => { setVerification(null); act('verify', async () => setVerification(await governance.verify(batch.batchId))); }} />
                  <IconButton icon={Download} name={`Export evidence ${short(batch.batchId)}`} disabled={disabled || batch.status === 'expired'} onClick={() => act('export', async () => { save(await governance.export(batch.batchId)); setNotice('Minimized evidence package exported.'); })} />
                  <IconButton icon={batch.held ? UnlockKeyhole : LockKeyhole} name={`${batch.held ? 'Release' : 'Place'} hold ${short(batch.batchId)}`} disabled={disabled || batch.status === 'expired'} onClick={() => { setHold(batch); setHoldAction(batch.held ? 'release' : 'hold'); setReason('incident_review'); }} />
                  {batch.held && <IconButton icon={RefreshCw} name={`Renew hold ${short(batch.batchId)}`} disabled={disabled || batch.status === 'expired'} onClick={() => { setHold(batch); setHoldAction('renew'); setReason(batch.holdReason || 'incident_review'); }} />}
                </div></td>
              </tr>;
            })}</tbody></table>
          {!data.latestBatches.length && <p className={styles.notice}>No saved archives yet.</p>}
        </div>
        {hold && <form className={styles.review} onSubmit={event => { event.preventDefault(); act('hold', async () => {
          await governance.hold(hold.batchId, reason, holdAction === 'release'); setHold(null); setNotice(holdAction === 'release' ? 'Preservation hold released.' : holdAction === 'renew' ? 'Preservation hold renewed.' : 'Preservation hold recorded.');
        }); }} aria-label="Preservation review">
          <div><h3>{holdAction === 'release' ? 'Release preservation hold' : holdAction === 'renew' ? 'Renew preservation hold' : 'Preserve this archive'}</h3><p>{short(hold.batchId)} · {hold.receiptCount} event records. Only this archive; raw logs retain their existing policy.</p>{holdAction !== 'release' && <p>Preservation expires after {data.policy.holdDays || 90} days unless renewed. This is not a court-ordered legal hold.</p>}</div>
          <label>Reason<select value={reason} onChange={event => setReason(event.target.value)}>{REASONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <div className={styles.actions}><button type="submit" disabled={disabled}><Check size={15} /> Confirm {holdAction === 'renew' ? 'renewal' : holdAction}</button><button type="button" disabled={disabled} onClick={() => setHold(null)}><X size={15} /> Cancel</button></div>
        </form>}
        <details className={styles.disclosure}>
          <summary><ShieldCheck size={17} /><span><strong>Retention &amp; protection settings</strong><small>Evidence: {days(data.policy.receiptRetentionDays)} · Third-party timestamp: {data.externalControls.independentTimestamp === 'not_configured' ? 'not connected' : human(data.externalControls.independentTimestamp)}</small></span><ChevronDown size={17} /></summary>
          <dl className={styles.controls}>
            <div><dt>Event evidence retained</dt><dd>{days(data.policy.receiptRetentionDays)}</dd></div>
            <div><dt>Saved archives retained</dt><dd>{days(data.policy.archiveRetentionDays)}</dd></div>
            <div><dt>Admin activity retained</dt><dd>{days(data.policy.auditRetentionDays)}</dd></div>
            <div><dt>Expired-record metadata retained</dt><dd>{days(data.policy.tombstoneRetentionDays)}</dd></div>
            <div><dt>Extra preservation period</dt><dd>{data.policy.holdDays ? `${data.policy.holdDays} days per approval` : 'Not recorded'}</dd></div>
            <div><dt>Storage protection</dt><dd>{data.preview ? 'In-memory preview' : human(data.externalControls.storageProtection)}</dd></div>
            <div><dt>Third-party timestamp</dt><dd>{data.externalControls.independentTimestamp === 'not_configured' ? 'Not connected' : human(data.externalControls.independentTimestamp)}</dd></div>
            <div><dt>Background maintenance</dt><dd>{human(data.maintenance?.status) || 'Not recorded'}<small>{time(data.maintenance?.lastSuccessAt)}</small></dd></div>
          </dl>
          <p className={styles.footnote}>{data.policy.policyVersion} · {data.policy.scheduledArchiveEnabled ? 'Scheduled archive enabled' : 'Manual archive'} · Up to {data.policy.defaultBatchSize} records per archive operation. Cleanup eligibility is not confirmed deletion. Preservation applies only to the selected archive.</p>
          <p className={styles.footnote}>Integrity checks detect content mismatches; they are not proof of visitor identity, complete browsing history, or an independently certified time.</p>
        </details>
        <details className={styles.disclosure}>
          <summary><Clock3 size={17} /><span><strong>Admin activity log</strong><small>Latest {data.latestAudit.length} entries · Access, downloads and changes</small></span><ChevronDown size={17} /></summary>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Time (UTC)</th><th>Activity</th><th>Admin</th><th>Archive / result</th></tr></thead>
            <tbody>{data.latestAudit.map(item => <tr key={item.auditId}><td data-label="Time (UTC)">{time(item.occurredAt)}</td><td data-label="Activity">{ACTIONS[item.action] || human(item.action)}{item.reason && <small>{human(item.reason)}</small>}</td>
              <td data-label="Admin"><code title={item.actor}>{short(item.actor)}</code></td><td data-label="Archive / result">{item.batchId ? short(item.batchId) : human(item.target)}<small>{human(item.outcome)}{item.affectedCount ? ` · ${item.affectedCount} records` : ''}</small></td></tr>)}</tbody></table>
            {!data.latestAudit.length && <p className={styles.notice}>No admin activity recorded.</p>}
          </div>
        </details>
      </>}
    </div>
  </section>;
}

function Stat({ icon: Icon, label, value, detail, tone }) {
  return <div data-tone={tone}><span><Icon size={15} />{label}</span><strong data-missing={value == null}>{amount(value)}</strong><small>{detail}</small></div>;
}

function VerificationResult({ value }) {
  const passed = value.status === 'verified', expired = value.status === 'expired';
  const source = value.offline ? 'This checks the downloaded file only, not the live database.' : value.sourceIntegrity === 'partial' ? 'Some original records are unavailable; the source comparison is incomplete.' : value.sourceIntegrity === 'unavailable' ? 'Original records are unavailable for comparison.' : value.sourceIntegrity === 'matched' ? 'The available original records also match.' : value.sourceIntegrity === 'mismatch' ? 'The archive differs from the current source records.' : 'Original source records were not compared.';
  return <div className={styles.verification} data-tone={passed ? 'success' : expired ? 'neutral' : 'warning'} role={passed || expired ? 'status' : 'alert'}>
    {passed ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
    <div><strong>{value.offline ? 'Downloaded file' : 'Selected archive'}: {passed ? 'Integrity checks passed' : expired ? 'Contents expired' : 'Integrity check failed'}</strong><p>{source}</p>
      <details className={styles.batchDetails}><summary>Check details <ChevronDown size={12} /></summary><p>{short(value.batchId)} · Manifest: {value.manifestValid == null ? 'unavailable' : value.manifestValid ? 'match' : 'mismatch'} · Records: {value.receiptHashesValid == null ? 'unavailable' : value.receiptHashesValid ? 'match' : 'mismatch'}</p><p>Source comparison: {human(value.sourceIntegrity)}. Integrity is not proof of visitor identity or an independent timestamp.</p></details>
    </div>
  </div>;
}

function IconButton({ name, icon: Icon, ...props }) {
  return <button type="button" title={name} aria-label={name} className={styles.iconButton} {...props}><Icon size={16} /></button>;
}
