// HTTP handlers for referral requests. Dependencies are injected so every path is testable
// without a network, a database or a mailbox (tests/referral-*.test.mjs).
//
// Accepting a request is deliberately small and fast so it holds up under load: validate, rate
// limit, verify, one insert, one signed upload URL. No model call and no email happen here; the
// browser uploads the résumé straight to storage, and screening and notification run in the worker
// (worker.mjs). Every step is idempotent on the key the form generates, so retries, double clicks
// and flaky connections never create a second request.
import { randomBytes, randomUUID } from 'node:crypto';
import { ContactError, contactIdentity, contactIp, verifyContactToken } from '../contactGuard.mjs';
import { CLOSED_STATUSES } from './config.mjs';
import { sameCompany } from '../currentRole.mjs';
import { ReferralError, idempotencyKey, referralFields } from './fields.mjs';
import { resumeMeta } from './resume.mjs';
import { resumePath } from './storage.mjs';
import { currentScreening, gradeEvidence, linkedInProfile } from './rubric.mjs';
import { referralRow, validStatus } from './store.mjs';

export const REFERRAL_ACTION = 'referral_submit';
// The shortest gap between two worker runs started by submissions.
export const KICK_GAP_MS = 10000;
const HOUR = 3600000;

const MESSAGES = {
  invalid_fields: 'Please check the form and try again.',
  missing_field: 'This field is required.',
  invalid_field: 'This field does not look right.',
  too_long: 'This is longer than the form allows.',
  intro_too_short: 'Add a little more to the introduction: at least a short paragraph.',
  intro_placeholder: 'Replace the parts in [brackets] with your own details.',
  intro_not_third_person: 'Write the introduction in third person, for example “Alex is a backend engineer…”.',
  consent_required: 'Please confirm how your details will be used.',
  resume_required: 'Attach your résumé as a PDF.',
  resume_too_large: 'The résumé is larger than 2 MB. Export a smaller PDF and try again.',
  resume_not_pdf: 'The résumé must be a PDF file.',
  upload_missing: 'The résumé has not arrived yet. Please send the request again to retry the upload.',
  not_found: 'This request could not be found. Please start again.',
  invalid_origin: 'Please send your request from the form on this site.',
  unsupported_content_type: 'Please send your request from the form on this site.',
  verification_required: 'Please complete the verification before sending.',
  verification_failed: 'Verification expired or failed. Please verify again.',
  verification_unavailable: 'Verification is temporarily unavailable. Your request has not been sent. Please try again.',
  rate_limited: 'Too many requests from this network. Please try again later.',
  busy: 'Referral requests are paused for now. Please try again later, or send a message instead.',
  referrals_paused: 'I am not taking referral requests right now. Nothing was sent; you can send me a message instead.',
  company_changed: 'This form was opened before my employer changed. Nothing was sent; reload the page to see where I can refer you now.',
  unavailable: 'Your request could not be saved. Nothing was sent; please try again in a few minutes.',
  method_not_allowed: 'Method not allowed.',
};

const header = (req, name) => (typeof req.headers?.[name] === 'string' ? req.headers[name] : '');
// 48 random bits: short enough to read out, and collisions stay negligible at millions of requests.
const reference = () => `R-${randomBytes(6).toString('hex').toUpperCase()}`;

function begin(req, res, env) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new ReferralError('method_not_allowed', 405); }
  // Browser form only: same allow-listed origins as the contact form, and no service-token path.
  if (req.headers?.['x-portfolio-contact-token'] !== undefined) throw new ReferralError('invalid_origin', 403);
  contactIdentity(req, env);
  if (!/^application\/json(?:\s*;|$)/i.test(header(req, 'content-type'))) throw new ReferralError('unsupported_content_type', 415);
}

function fail(res, error, requestId) {
  const known = error instanceof ReferralError || error instanceof ContactError;
  const code = known ? error.code : 'unavailable';
  const body = { error: MESSAGES[code] || MESSAGES.unavailable, code, requestId };
  if (error instanceof ReferralError && error.field) body.field = error.field;
  if (error instanceof ReferralError && error.company) body.company = error.company;
  return res.status(known ? error.status : 503).json(body);
}

// Step 1: accept the form and hand back a one-file upload URL.
export function createReferralHandler({ isRateLimited, store, storage, availability, verifyToken = verifyContactToken,
  env = process.env, fetchImpl = fetch, audit = entry => console.info(JSON.stringify(entry)) } = {}) {
  const record = entry => { try { audit(entry); } catch { /* Logging never changes the outcome. */ } };
  return async function referralHandler(req, res) {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    try {
      begin(req, res, env);
      if (req.body?.website) throw new ContactError('verification_failed');
      const key = idempotencyKey(req.body?.idempotencyKey);
      const request = referralFields(req.body);
      const resume = resumeMeta(req.body.resume);
      if (await isRateLimited(contactIp(req, env), 'referral', { limit: Number(env.REFERRAL_RATE_LIMIT || 6), windowMs: HOUR })) {
        res.setHeader('Retry-After', '3600'); throw new ReferralError('rate_limited', 429);
      }
      // A repeat of a request that was already accepted (a retry after a dropped connection, a
      // second click) gets the same answer and a fresh upload URL. Its one-time verification token
      // was spent the first time, so it is not asked for again: the key is an unguessable UUID.
      let row = await store.findByKey(key), created = false, company;
      if (!row) {
        // Which company this is for is decided here, from the work history, never by the browser.
        // The form says which company it showed: after a job change an old tab must not send a
        // request written for the previous employer.
        const open = await availability.get();
        if (!open.accepting) throw new ReferralError(open.reason === 'unknown' ? 'unavailable' : 'referrals_paused', open.reason === 'unknown' ? 503 : 409);
        if (!sameCompany(req.body.company, open.company)) throw Object.assign(new ReferralError('company_changed', 409), { company: open.company });
        company = open.company;
        await verifyToken(req.body.turnstileToken, { env, fetchImpl, action: REFERRAL_ACTION });
        // A safety valve against a flood, counted only after verification so unverified traffic
        // cannot use it up. It is far above normal volume; raise it with REFERRAL_DAILY_LIMIT.
        if (await isRateLimited('all', 'referral-global', { limit: Number(env.REFERRAL_DAILY_LIMIT || 5000), windowMs: 24 * HOUR })) {
          res.setHeader('Retry-After', '3600'); throw new ReferralError('busy', 429);
        }
        const id = randomUUID();
        const accepted = await store.accept({ id, ...referralRow({ key, reference: reference(), request, resume, path: resumePath(id), company }) });
        if (!accepted) throw new ReferralError('unavailable', 503);
        ({ row, created } = accepted);
      }
      const body = { ok: true, reference: row.reference, state: row.state, requestId };
      if (row.state === 'awaiting_upload') body.upload = await storage.createUpload(row.resume_path);
      record({ event: 'referral_request', requestId, outcome: created ? 'accepted' : 'repeated', state: row.state });
      return res.status(created ? 201 : 200).json(body);
    } catch (error) {
      record({ event: 'referral_request', requestId, outcome: 'not_accepted', reason: error instanceof ReferralError || error instanceof ContactError ? error.code : 'unavailable' });
      return fail(res, error, requestId);
    }
  };
}

// Step 2: the browser reports that the upload finished; the request joins the screening queue.
export function createReferralCompleteHandler({ isRateLimited, store, storage, kick = async () => {},
  env = process.env, audit = entry => console.info(JSON.stringify(entry)) } = {}) {
  return async function referralCompleteHandler(req, res) {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    try {
      begin(req, res, env);
      const key = idempotencyKey(req.body?.idempotencyKey);
      if (await isRateLimited(contactIp(req, env), 'referral-complete', { limit: Number(env.REFERRAL_COMPLETE_RATE_LIMIT || 30), windowMs: HOUR })) {
        res.setHeader('Retry-After', '3600'); throw new ReferralError('rate_limited', 429);
      }
      let row = await store.findByKey(key);
      if (!row) throw new ReferralError('not_found', 404);
      if (row.state === 'awaiting_upload') {
        const file = await storage.stat(row.resume_path);
        if (!file || file.size < 1) throw new ReferralError('upload_missing', 409);
        const moved = await store.markUploaded(row.id, file.size);
        if (!moved.row) throw new ReferralError('not_found', 404);
        row = moved.row;
        // Wake the worker without waiting for it, once per request however many confirmations race.
        // If the kick is missed, the next one or the scheduler picks the request up.
        if (moved.changed) await kick(req).catch(() => {});
      }
      try { audit({ event: 'referral_complete', requestId, outcome: 'queued', state: row.state }); } catch { /* optional */ }
      // The applicant learns that it arrived, never what the screening said.
      return res.status(200).json({ ok: true, reference: row.reference, message: 'Your request was received.', requestId });
    } catch (error) { return fail(res, error, requestId); }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The owner's review list. `authorize` resolves to a user, or answers the request itself and resolves to null.
export function createReferralAdminHandler({ authorize, store, storage, availability, refresh = async () => {}, kick = async () => {} }) {
  const offer = async () => {
    const now = await availability.get();
    return { company: now.company, accepting: now.accepting, reason: now.reason, switchedOn: now.switchedOn, since: now.role?.since || '', title: now.role?.title || '' };
  };
  return async function referralAdminHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    const user = await authorize(req, res);
    if (!user) return undefined;
    try {
      if (req.method === 'GET') {
        const status = validStatus(req.query?.status) ? req.query.status : undefined;
        const requests = await store.list(status);
        if (requests === null) return res.status(200).json({ enabled: false, requests: [], offer: await offer() });
        // Opening the list is a good moment to finish anything still waiting to be screened.
        if (requests.some(row => row.state === 'queued')) await kick(req).catch(() => {});
        return res.status(200).json({ enabled: true, requests, offer: await offer() });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
      const { id, action, status, note } = req.body || {};
      // The switch for new requests, and "read the work history again now" after a job change.
      if (action === 'accepting' || action === 'refresh') {
        if (action === 'accepting') await store.setAccepting(req.body.accepting === true);
        availability.clear();
        await refresh(res).catch(error => console.warn('[referrals] page refresh failed', error?.message || error));
        return res.status(200).json({ offer: await offer() });
      }
      if (!UUID.test(String(id || ''))) return res.status(400).json({ error: 'invalid_request', message: 'A request id is required.' });
      if (action === 'linkedin_badge') {
        const { confirmed, reviewNote, expectedUpdatedAt } = req.body;
        if (typeof confirmed !== 'boolean' || typeof reviewNote !== 'string' || reviewNote.trim().length < 10 || reviewNote.length > 600
          || typeof expectedUpdatedAt !== 'string') return res.status(400).json({ error: 'invalid_request', message: 'Record whether the official badge was visible and what you checked.' });
        const row = await store.get(id);
        if (!row) return res.status(404).json({ error: 'not_found', message: 'That request no longer exists.' });
        if (row.state !== 'ready' || !currentScreening(row.screening) || row.screening.source !== 'ai' || row.updated_at !== expectedUpdatedAt) {
          return res.status(409).json({ error: 'stale_screening', message: 'Refresh the request or screen it under the current policy first.' });
        }
        const profileUrl = linkedInProfile(row.profile_url);
        if (!profileUrl) return res.status(400).json({ error: 'invalid_profile', message: 'A LinkedIn member profile is required for badge verification.' });
        const badge = { confirmed, profileUrl, note: reviewNote.trim(), checkedAt: new Date().toISOString(), checkedBy: String(user.userId || user.id || '') };
        if (!badge.checkedBy) return res.status(403).json({ error: 'unauthorized', message: 'An identified administrator is required.' });
        const screening = { ...row.screening, ...gradeEvidence(row.screening.criteria, { profileUrl, badge,
          blocked: row.screening.flags?.some(flag => flag !== 'incomplete') || row.screening.consistency === 'conflicts' }) };
        const updated = await store.update(id, { screening, fit: screening.score, recommendation: screening.recommendation }, { expectedUpdatedAt, expectedState: 'ready' });
        if (!updated) return res.status(409).json({ error: 'stale_screening', message: 'The request changed. Refresh before recording the badge check.' });
        return res.status(200).json(updated);
      }
      if (action === 'delete') {
        const removed = await store.remove(id);
        if (removed?.resume_path) await storage.remove([removed.resume_path]);
        return res.status(200).json({ id, deleted: true });
      }
      if (action === 'resume') {
        const row = await store.get(id);
        if (!row) return res.status(404).json({ error: 'not_found', message: 'That request no longer exists.' });
        // Only a file the worker has checked can be opened.
        if (!row.resume_path || row.state !== 'ready') return res.status(409).json({ error: 'no_file', message: 'There is no résumé file for this request.' });
        return res.status(200).json({ url: await storage.downloadUrl(row.resume_path, row.resume_filename || 'resume.pdf', 60) });
      }
      let patch;
      if (action === 'status' && validStatus(status)) patch = { status };
      else if (action === 'note' && typeof note === 'string' && note.length <= 2000) patch = { owner_note: note.trim() || null };
      else if (action === 'rescreen') patch = { state: 'queued', attempts: 0, lease_until: null };
      else return res.status(400).json({ error: 'invalid_request', message: 'Use status, note, resume, rescreen, linkedin_badge or delete.' });
      if (action === 'rescreen') {
        const row = await store.get(id);
        if (!row) return res.status(404).json({ error: 'not_found', message: 'That request no longer exists.' });
        if (!row.resume_path || !['ready', 'queued'].includes(row.state)) return res.status(409).json({ error: 'no_file', message: 'There is no résumé file to screen.' });
      }
      let updated = await store.update(id, patch);
      if (!updated) return res.status(404).json({ error: 'not_found', message: 'That request no longer exists.' });
      // Closing a request deletes its résumé file straight away.
      if (action === 'status' && CLOSED_STATUSES.includes(status) && updated.resume_path) {
        await storage.remove([updated.resume_path]);
        updated = await store.update(id, { resume_path: null });
      }
      if (action === 'rescreen') await kick(req).catch(() => {});
      return res.status(200).json(updated);
    } catch (error) {
      console.error('[referrals] admin operation failed', error?.message || error);
      return res.status(503).json({ error: 'referrals_unavailable', message: 'Referral requests could not be loaded or updated.' });
    }
  };
}

// The worker endpoint: called by the scheduler, and by kicks from this application.
export function createReferralWorkerHandler({ worker, env = process.env }) {
  return async function referralWorkerHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const secret = env.CRON_SECRET;
    if (!secret || req.headers?.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
    try {
      // The scheduler's GET also does the housekeeping. A kick (POST) drains the queue and then lingers
      // for longer than the gap between kicks, so nothing that arrives in that gap is left behind.
      const scheduled = req.method === 'GET';
      return res.status(200).json({ ok: true, ...(await worker.run({ housekeeping: scheduled, lingerMs: scheduled ? 0 : KICK_GAP_MS + 2000 })) });
    } catch (error) {
      console.error('[referrals] worker failed', error?.message || error);
      return res.status(500).json({ error: 'worker_failed' });
    }
  };
}

// Starts a worker run as its own invocation and returns without waiting for it to finish.
// At most one starts per KICK_GAP_MS, so a burst of submissions starts a few runs rather than one each.
export function createWorkerKick({ isRateLimited, env = process.env, fetchImpl = fetch, waitMs = 150 }) {
  return async function kick(req) {
    const secret = env.CRON_SECRET;
    const host = header(req, 'host');
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const allowed = (env.CONTACT_ALLOWED_ORIGINS || 'https://yuqi.site,https://www.yuqi.site').split(',').map(value => value.trim());
    if (!secret || !host || !(allowed.includes(`https://${host}`) || (local && env.NODE_ENV === 'development'))) return false;
    if (await isRateLimited('all', 'referral-kick', { limit: 1, windowMs: KICK_GAP_MS })) return false;
    const started = fetchImpl(`${local ? 'http' : 'https'}://${host}/api/cron/referral-worker`, {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(60000),
    }).catch(() => {});
    // Long enough for the request to leave; the run continues on its own after that.
    await Promise.race([started, new Promise(resolve => setTimeout(resolve, waitMs))]);
    return true;
  };
}
