const timestamp = value => Date.parse(value || '') || 0;

// Audit history is bounded. A missing check is unknown, not a passing check.
export function latestArchiveChecks(audit = []) {
  const checks = new Map();
  for (const entry of [...audit].sort((a, b) => timestamp(b.occurredAt) - timestamp(a.occurredAt))) {
    if (entry.action !== 'verify' || !entry.batchId || !['verified', 'tampered', 'expired'].includes(entry.outcome)) continue;
    if (!checks.has(entry.batchId)) checks.set(entry.batchId, entry);
  }
  return checks;
}

export function governanceHealth(data, now = Date.now()) {
  const maintenance = data.maintenance || {};
  const failed = [...latestArchiveChecks(data.latestAudit).values()].filter(entry => entry.outcome === 'tampered').length;
  const lastSuccess = timestamp(maintenance.lastSuccessAt), interval = Number(maintenance.intervalSeconds);
  const overdue = lastSuccess > 0 && interval > 0 && now - lastSuccess > interval * 2000;
  const issues = [];
  if (data.enabled === false) issues.push('Record protection is paused.');
  if (maintenance.status === 'failed') issues.push('The latest background maintenance failed.');
  else if (!data.preview && overdue) issues.push('Background maintenance is overdue.');
  if (failed) issues.push(`${failed} ${failed === 1 ? 'archive needs' : 'archives need'} review after a failed integrity check.`);
  if (issues.length) return { tone: 'warning', title: 'Needs attention', description: issues.join(' ') };
  if (data.preview) return { tone: 'neutral', title: 'Sample records only', description: 'No live visitor data. Background maintenance does not run in this preview.' };
  if (!lastSuccess || maintenance.status !== 'completed') return { tone: 'neutral', title: 'Maintenance not confirmed', description: 'No recent successful maintenance result is available.' };
  return { tone: 'success', title: 'Latest maintenance completed', description: 'No unresolved failed checks in the recent activity shown below. Unchecked archives are not verified.' };
}
