// Where referral requests live: public.referral_requests (supabase/migrations/20261116090000_referral_requests.sql),
// reached only with the service role. The table is also the work queue: a request is accepted with
// one insert, and the worker claims queued rows in batches with a lease (FOR UPDATE SKIP LOCKED), so
// any number of workers can run at once without screening a request twice.
import { randomUUID } from 'node:crypto';
import { CLOSED_STATUSES, IDLE_KEEP_DAYS, REQUEST_KEEP_DAYS, RESUME_KEEP_DAYS, STATUSES } from './config.mjs';
import { applicantKey } from './fields.mjs';

const missingTable = error => ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);
const fail = () => { throw new Error('Referral store unavailable'); };
const DAY = 86400000;
export const MAX_ATTEMPTS = 5;
export const validStatus = value => STATUSES.includes(value);

// The row written when a request is accepted. Its résumé is uploaded next, to `resume_path`.
export function referralRow({ key, reference, request, resume, path, company }) {
  return {
    idempotency_key: key, reference, state: 'awaiting_upload', status: 'new', company, applicant_key: applicantKey(request.email, company),
    name: request.name, email: request.email, profile_url: request.profileUrl || null,
    role_title: request.roleTitle, job_url: request.jobUrl, job_id: request.jobId || null, location: request.location || null,
    additional_roles: request.additionalRoles || [],
    requirements: request.requirements || null, relationship: request.relationship, relationship_note: request.relationshipNote || null,
    current_title: request.currentTitle || null, years_experience: request.years, intro: request.intro, why_role: request.whyRole || null,
    resume_path: path, resume_filename: resume.filename, resume_bytes: resume.size,
  };
}

// The form's shape again, for the screening model and the notification email.
export function requestFromRow(row) {
  return {
    name: row.name, email: row.email, profileUrl: row.profile_url || '', roleTitle: row.role_title, jobUrl: row.job_url,
    jobId: row.job_id || '', location: row.location || '', requirements: row.requirements || '', relationship: row.relationship,
    relationshipNote: row.relationship_note || '', currentTitle: row.current_title || '', years: row.years_experience ?? null,
    intro: row.intro, whyRole: row.why_role || '', company: row.company || '', additionalRoles: row.additional_roles || [],
  };
}

export function supabaseReferralStore(client) {
  const table = () => client.from('referral_requests');
  const rows = ({ data, error }) => { if (error) fail(); return data || []; };
  return {
    // { row, created }. A repeated key returns the request it already made. null: the table is missing.
    async accept(row) {
      const inserted = await table().insert(row).select('*').single();
      if (!inserted.error) return { row: inserted.data, created: true };
      if (missingTable(inserted.error)) return null;
      if (inserted.error.code !== '23505') fail();
      const existing = await this.findByKey(row.idempotency_key);
      if (existing) return { row: existing, created: false };
      // Not this request again: the same person asking a second time (the unique index on applicant_key).
      const earlier = row.applicant_key ? await this.findByApplicant(row.applicant_key) : null;
      if (earlier) return { duplicate: earlier };
      return fail(); // the clash was on the reference
    },
    // The request this person already has for this company, if any.
    async findByApplicant(key) {
      const { data, error } = await table().select('*').eq('applicant_key', key).maybeSingle();
      if (missingTable(error)) return null;
      if (error) fail();
      return data;
    },
    // Another request that came with the very same résumé file: its reference, or null.
    async sameResume(sha256, exceptId) {
      const { data, error } = await table().select('reference').eq('resume_sha256', sha256).neq('id', exceptId).limit(1);
      if (error) fail();
      return data?.[0]?.reference || null;
    },
    // Requests with an outcome to tell someone about (a pass: two emails; an automatic decline: one)
    // that have not been mailed yet, each claimed by a conditional
    // update so overlapping workers never send a pair twice.
    async claimPassMails(limit = 10) {
      const due = rows(await table().select('id').in('outcome', ['passed', 'auto_declined']).is('outcome_mail_at', null).eq('state', 'ready')
        .gt('created_at', new Date(Date.now() - 7 * DAY).toISOString()).order('created_at').limit(limit));
      const claimed = [];
      for (const { id } of due) {
        const taken = rows(await table().update({ outcome_mail_at: new Date().toISOString() }).eq('id', id).is('outcome_mail_at', null).select('*'));
        if (taken.length) claimed.push(taken[0]);
      }
      return claimed;
    },
    // Bookkeeping that must not look like an edit: updated_at guards the owner's own changes.
    async mark(id, patch) { rows(await table().update(patch).eq('id', id).select('id')); },
    async findByKey(key) {
      const { data, error } = await table().select('*').eq('idempotency_key', key).maybeSingle();
      if (missingTable(error)) return null;
      if (error) fail();
      return data;
    },
    // awaiting_upload → queued, once: { row, changed }. Of any number of simultaneous calls exactly
    // one sees changed: true, because the update itself checks the state.
    async markUploaded(id, bytes) {
      const moved = rows(await table().update({ state: 'queued', resume_bytes: bytes, updated_at: new Date().toISOString() }).eq('id', id).eq('state', 'awaiting_upload').select('*'));
      if (moved.length) return { row: moved[0], changed: true };
      const { data, error } = await table().select('*').eq('id', id).maybeSingle();
      if (error) fail();
      return { row: data, changed: false };
    },
    async claimScreenings(batch, leaseSeconds) {
      return rows(await client.rpc('claim_referral_screenings', { batch_size: batch, lease_seconds: leaseSeconds }));
    },
    async finishScreening(id, patch) {
      rows(await table().update({ ...patch, lease_until: null, updated_at: new Date().toISOString() }).eq('id', id).eq('state', 'screening').select('id'));
    },
    // After a failure the claim is kept but shortened or lengthened to `retrySeconds`: the request is
    // claimed again only when that runs out, which is the back-off between attempts.
    async releaseScreening(id, retrySeconds) {
      rows(await table().update({ lease_until: new Date(Date.now() + retrySeconds * 1000).toISOString() }).eq('id', id).eq('state', 'screening').select('id'));
    },
    // Rows for one digest email, marked as notified. Empty when there is nothing new, or when this
    // hour's allowance of emails is used up (the rows then wait for the next digest).
    async claimDigest(maxPerHour, maxRows) {
      return rows(await client.rpc('claim_referral_digest', { max_per_hour: maxPerHour, max_rows: maxRows }));
    },
    async unmarkNotified(ids) {
      if (ids.length) rows(await table().update({ notified_at: null }).in('id', ids).select('id'));
    },
    async list(status) {
      let query = table().select('*').neq('state', 'awaiting_upload').order('created_at', { ascending: false }).limit(300);
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (missingTable(error)) return null;
      if (error) fail();
      return data || [];
    },
    async get(id) {
      const { data, error } = await table().select('*').eq('id', id).maybeSingle();
      if (error) fail();
      return data;
    },
    async update(id, patch, { expectedUpdatedAt, expectedState } = {}) {
      let query = table().update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
      if (expectedState) query = query.eq('state', expectedState);
      return rows(await query.select('*'))[0] || null;
    },
    async remove(id) {
      return rows(await table().delete().eq('id', id).select('id, resume_path'))[0] || null;
    },
    async queueDepth() {
      const { count, error } = await table().select('id', { count: 'exact', head: true }).in('state', ['queued', 'screening']);
      if (error) fail();
      return count || 0;
    },
    // The owner's switch: are new requests being accepted? A missing table or row counts as "yes".
    async accepting() {
      const { data, error } = await client.from('referral_notify_state').select('accepting').eq('singleton', true).maybeSingle();
      if (error && !missingTable(error)) fail();
      return data?.accepting !== false;
    },
    async setAccepting(value) {
      const { error } = await client.from('referral_notify_state').upsert({ singleton: true, accepting: Boolean(value) }, { onConflict: 'singleton' });
      if (error) fail();
      return Boolean(value);
    },
    // Housekeeping, in bounded batches. Each returns the storage paths whose files must now be deleted.
    async expireFiles(limit = 100) {
      const held = () => table().select('id, resume_path').not('resume_path', 'is', null).limit(limit);
      const due = [...rows(await held().lt('resume_expires_at', new Date().toISOString())), ...rows(await held().in('status', CLOSED_STATUSES))];
      if (due.length) rows(await table().update({ resume_path: null }).in('id', due.map(row => row.id)).select('id'));
      return [...new Set(due.map(row => row.resume_path))];
    },
    async purge() {
      const now = Date.now();
      const old = rows(await table().delete().lt('expires_at', new Date(now).toISOString()).select('id, resume_path'));
      // A request whose file never arrived is not a request; it is dropped after a day.
      const abandoned = rows(await table().delete().eq('state', 'awaiting_upload').lt('created_at', new Date(now - DAY).toISOString()).select('id, resume_path'));
      // Nothing has happened to it for a month (no screening, status change or note): it is not being
      // followed, so it goes. Anything the owner touches starts the month again.
      const idle = rows(await table().delete().lt('updated_at', new Date(now - IDLE_KEEP_DAYS * DAY).toISOString()).select('id, resume_path'));
      const gone = [...old, ...abandoned, ...idle];
      return { removed: gone.length, paths: gone.map(row => row.resume_path).filter(Boolean) };
    },
  };
}

// The same interface over a Map, for the local preview and tests. JavaScript runs one callback at
// a time, so each method here is atomic in the way the SQL functions are in production.
export function memoryReferralStore(seed = [], now = Date.now) {
  const rows = new Map();
  const digests = { windowStart: 0, sent: 0 };
  const iso = at => new Date(at).toISOString();
  const add = row => {
    const at = now();
    const saved = { id: randomUUID(), created_at: iso(at), updated_at: iso(at), expires_at: iso(at + REQUEST_KEEP_DAYS * DAY),
      resume_expires_at: iso(at + RESUME_KEEP_DAYS * DAY), state: 'awaiting_upload', status: 'new', screening: {}, recommendation: null, fit: null,
      resume_sha256: null, lease_until: null, attempts: 0, notified_at: null, owner_note: null, applicant_key: null, outcome: null, outcome_mail_at: null, ...row };
    rows.set(saved.id, saved); return saved;
  };
  seed.forEach(add);
  const copy = row => (row ? { ...row } : null);
  return {
    async accept(row) {
      const existing = [...rows.values()].find(item => item.idempotency_key === row.idempotency_key);
      if (existing) return { row: copy(existing), created: false };
      const earlier = row.applicant_key && [...rows.values()].find(item => item.applicant_key === row.applicant_key);
      if (earlier) return { duplicate: copy(earlier) };
      return { row: copy(add(row)), created: true };
    },
    size() { return rows.size; },
    async findByApplicant(key) { return copy([...rows.values()].find(item => item.applicant_key === key)); },
    async sameResume(sha256, exceptId) { return [...rows.values()].find(item => item.resume_sha256 === sha256 && item.id !== exceptId)?.reference || null; },
    async claimPassMails(limit = 10) {
      const due = [...rows.values()].filter(row => ['passed', 'auto_declined'].includes(row.outcome) && !row.outcome_mail_at && row.state === 'ready').slice(0, limit);
      for (const row of due) row.outcome_mail_at = iso(now());
      return due.map(copy);
    },
    async mark(id, patch) { const row = rows.get(id); if (row) Object.assign(row, patch); },
    async findByKey(key) { return copy([...rows.values()].find(item => item.idempotency_key === key)); },
    async markUploaded(id, bytes) {
      const row = rows.get(id); if (!row) return { row: null, changed: false };
      const changed = row.state === 'awaiting_upload';
      if (changed) Object.assign(row, { state: 'queued', resume_bytes: bytes, updated_at: iso(now()) });
      return { row: copy(row), changed };
    },
    async claimScreenings(batch, leaseSeconds) {
      const at = now();
      const due = [...rows.values()].filter(row => row.attempts < MAX_ATTEMPTS && (row.state === 'queued' || (row.state === 'screening' && Date.parse(row.lease_until) < at)))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, batch);
      for (const row of due) Object.assign(row, { state: 'screening', lease_until: iso(at + leaseSeconds * 1000), attempts: row.attempts + 1 });
      return due.map(copy);
    },
    async finishScreening(id, patch) { const row = rows.get(id); if (row?.state === 'screening') Object.assign(row, patch, { lease_until: null, updated_at: iso(now()) }); },
    async releaseScreening(id, retrySeconds) { const row = rows.get(id); if (row?.state === 'screening') row.lease_until = iso(now() + retrySeconds * 1000); },
    async claimDigest(maxPerHour, maxRows) {
      const at = now();
      const due = [...rows.values()].filter(row => ['ready', 'file_rejected'].includes(row.state) && !row.notified_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, maxRows);
      if (!due.length) return [];
      if (at - digests.windowStart >= 3600000) Object.assign(digests, { windowStart: at, sent: 0 });
      if (digests.sent >= maxPerHour) return [];
      digests.sent += 1;
      for (const row of due) row.notified_at = iso(at);
      return due.map(copy);
    },
    async unmarkNotified(ids) { for (const id of ids) { const row = rows.get(id); if (row) row.notified_at = null; } },
    async list(status) {
      return [...rows.values()].filter(row => row.state !== 'awaiting_upload' && (!status || row.status === status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(copy);
    },
    async get(id) { return copy(rows.get(id)); },
    async update(id, patch, { expectedUpdatedAt, expectedState } = {}) {
      const row = rows.get(id);
      if (!row || (expectedUpdatedAt && row.updated_at !== expectedUpdatedAt) || (expectedState && row.state !== expectedState)) return null;
      Object.assign(row, patch, { updated_at: iso(now()) }); return copy(row);
    },
    async remove(id) { const row = rows.get(id); if (!row) return null; rows.delete(id); return { id, resume_path: row.resume_path }; },
    async queueDepth() { return [...rows.values()].filter(row => ['queued', 'screening'].includes(row.state)).length; },
    async accepting() { return digests.accepting !== false; },
    async setAccepting(value) { digests.accepting = Boolean(value); return digests.accepting; },
    async expireFiles(limit = 100) {
      const at = now();
      const due = [...rows.values()].filter(row => row.resume_path && (Date.parse(row.resume_expires_at) < at || CLOSED_STATUSES.includes(row.status))).slice(0, limit);
      const paths = due.map(row => row.resume_path);
      for (const row of due) row.resume_path = null;
      return paths;
    },
    async purge() {
      const at = now(), paths = []; let removed = 0;
      for (const row of [...rows.values()]) {
        if (Date.parse(row.expires_at) < at || (row.state === 'awaiting_upload' && Date.parse(row.created_at) < at - DAY) || Date.parse(row.updated_at) < at - IDLE_KEEP_DAYS * DAY) {
          rows.delete(row.id); removed += 1; if (row.resume_path) paths.push(row.resume_path);
        }
      }
      return { removed, paths };
    },
  };
}
