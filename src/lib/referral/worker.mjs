// Everything slow about a referral request happens here, off the request path: checking the
// stored résumé, AI screening, the digest email, and retention.
//
// One run claims a small batch of queued requests with a lease, so runs can overlap (a cron tick,
// a kick after a submission, the owner opening the review page) without two of them screening the
// same request. A run that dies leaves its claims to expire and be picked up again; after five
// attempts a request is delivered with a plain completeness note instead of being retried forever.
import { ReferralError } from './fields.mjs';
import { inspectResume } from './resume.mjs';
import { referralDigestMail } from './mail.mjs';
import { rulesScreening } from './screening.mjs';
import { MAX_ATTEMPTS, requestFromRow } from './store.mjs';

const REFUSED = {
  resume_not_pdf: 'The uploaded file is not a readable PDF, so it was deleted.',
  resume_too_large: 'The uploaded file was larger than 2 MB, so it was deleted.',
  resume_protected: 'The uploaded PDF is password-protected, so it was deleted.',
  resume_active_content: 'The uploaded PDF contains scripts or embedded files, so it was deleted.',
};

export function createReferralWorker({ store, storage, screener, sendMail, isRateLimited, env = process.env, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = entry => console.info(JSON.stringify(entry)) }) {
  const number = (name, fallback) => (Number.isFinite(Number(env[name])) && env[name] !== '' && env[name] !== undefined ? Number(env[name]) : fallback);

  async function screenOne(row) {
    const request = requestFromRow(row);
    const bytes = row.resume_path ? await storage.download(row.resume_path) : null;
    if (!bytes) {
      const note = rulesScreening(request, { reason: 'error' });
      note.concerns = ['The résumé file could not be found in storage.', ...note.concerns].slice(0, 4);
      await store.finishScreening(row.id, { state: 'ready', screening: note, recommendation: note.recommendation, fit: note.fit });
      return 'screened';
    }
    let resume;
    try { resume = inspectResume(bytes); } catch (error) {
      if (!(error instanceof ReferralError)) throw error;
      // An unsafe or unreadable file is removed before anyone can open it; the request itself stays.
      await storage.remove([row.resume_path]);
      const note = rulesScreening(request, { reason: 'off' });
      note.summary = 'The résumé was refused, so this request has no résumé. Ask the applicant to send a plain PDF if you want to consider it.';
      note.concerns = [REFUSED[error.code] || 'The uploaded file was refused and deleted.', ...note.concerns].slice(0, 4);
      await store.finishScreening(row.id, { state: 'file_rejected', resume_path: null, screening: note, recommendation: note.recommendation, fit: note.fit });
      return 'rejected';
    }
    // The model is only one of two ceilings on spend: the monthly ledger, and this daily allowance.
    const capped = screener.enabled() && await isRateLimited('all', 'referral-ai', { limit: number('REFERRAL_AI_DAILY_LIMIT', 40), windowMs: 86400000 });
    const note = await screener.screen(request, resume, { skipAi: capped ? 'daily_cap' : null });
    await store.finishScreening(row.id, { state: 'ready', screening: note, recommendation: note.recommendation, fit: note.fit, resume_sha256: resume.sha256 });
    return 'screened';
  }

  return {
    // { claimed, screened, rejected, failed, notified, filesDeleted, purged, waiting }
    //
    // `lingerMs`: after the queue empties, keep checking for this long before finishing. A run
    // started by a kick lingers longer than the gap between kicks, so a request that arrives while
    // kicks are being throttled is always picked up by a run that is still alive.
    async run({ budgetMs = 40000, batch = 4, housekeeping = false, lingerMs = 0, pollMs = 2000 } = {}) {
      const started = now();
      const summary = { claimed: 0, screened: 0, rejected: 0, failed: 0, notified: 0, filesDeleted: 0, purged: 0, waiting: 0 };
      // One digest for everything that became ready. A few an hour at most, however many requests arrive.
      const notify = async () => {
        const ready = await store.claimDigest(number('REFERRAL_DIGESTS_PER_HOUR', 6), 50).catch(() => []);
        if (!ready.length) return;
        const waiting = await store.queueDepth().catch(() => 0);
        try { await sendMail(referralDigestMail(ready, { waiting })); summary.notified += ready.length; }
        catch { await store.unmarkNotified(ready.map(row => row.id)).catch(() => {}); }
      };
      let idleSince = null;
      while (now() - started < budgetMs) {
        const rows = await store.claimScreenings(batch, number('REFERRAL_LEASE_SECONDS', 120));
        if (!rows.length) {
          // The queue has just emptied: tell the owner now rather than after lingering.
          if (idleSince === null) { idleSince = now(); await notify(); }
          if (now() - idleSince >= lingerMs) break;
          await sleep(pollMs);
          continue;
        }
        idleSince = null;
        summary.claimed += rows.length;
        // A batch is screened concurrently; the batch size is the concurrency limit.
        const results = await Promise.allSettled(rows.map(screenOne));
        for (const [index, result] of results.entries()) {
          if (result.status === 'fulfilled') { summary[result.value] += 1; continue; }
          summary.failed += 1;
          const row = rows[index];
          try {
            if (row.attempts >= MAX_ATTEMPTS) {
              const note = rulesScreening(requestFromRow(row), { reason: 'error' });
              await store.finishScreening(row.id, { state: 'ready', screening: note, recommendation: note.recommendation, fit: note.fit });
            } else await store.releaseScreening(row.id, 60 * row.attempts); // back off: 1, 2, 3, 4 minutes
          } catch { /* The lease expires and another run picks it up. */ }
        }
      }
      await notify();
      summary.waiting = await store.queueDepth().catch(() => 0);

      if (housekeeping) {
        try {
          const expired = await store.expireFiles();
          const purged = await store.purge();
          summary.filesDeleted = await storage.remove([...expired, ...purged.paths]);
          summary.purged = purged.removed;
        } catch { /* Retried on the next housekeeping run. */ }
      }
      log({ event: 'referral_worker', ...summary, ms: now() - started });
      return summary;
    },
  };
}
