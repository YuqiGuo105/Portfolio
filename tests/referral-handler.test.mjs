import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { KICK_GAP_MS, REFERRAL_ACTION, createReferralAdminHandler, createReferralCompleteHandler, createReferralHandler, createReferralWorkerHandler, createWorkerKick } from '../src/lib/referral/handler.mjs';
import { memoryReferralStore } from '../src/lib/referral/store.mjs';
import { memoryResumeStorage } from '../src/lib/referral/storage.mjs';
import { ContactError, verifyContactToken } from '../src/lib/contactGuard.mjs';
import { form, openFor, pdf, request, response } from './referral-fixtures.mjs';

const env = { NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'test-server-secret', CRON_SECRET: 'cron-secret-for-tests' };

function fixture(options = {}) {
  const order = [], logs = [], limits = [], kicks = [];
  const store = options.store || memoryReferralStore();
  const storage = options.storage || memoryResumeStorage();
  const deps = { env, store, storage, availability: options.availability || openFor(),
    isRateLimited: async (...args) => { limits.push(args); order.push(`limit:${args[1]}`); return false; },
    audit: entry => logs.push(entry) };
  const submit = createReferralHandler({ ...deps,
    verifyToken: async (token, context) => { order.push('verify'); assert.equal(context.action, REFERRAL_ACTION); if (token !== 'valid-token') throw new ContactError('verification_failed'); },
    ...options });
  const complete = createReferralCompleteHandler({ ...deps, kick: async () => { kicks.push(1); }, ...options });
  // What the browser does between the two calls: PUT the file to the upload URL it was given.
  const upload = (res, bytes = pdf(), type = 'application/pdf') => storage.put(new URL(res.body.upload.url, 'http://x').searchParams.get('token'), bytes, type);
  return { submit, complete, upload, store, storage, order, logs, limits, kicks };
}
const send = async (handler, body) => { const res = response(); await handler(request(body), res); return res; };

test('a request is accepted with one insert and an upload link; no model call, no email', async () => {
  const f = fixture(); const body = form();
  const res = await send(f.submit, body);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(f.order, ['limit:referral', 'verify', 'limit:referral-global']);
  assert.match(res.body.reference, /^R-[0-9A-F]{12}$/); assert.equal(res.body.state, 'awaiting_upload');
  assert.match(res.body.upload.url, /token=[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(res.body).sort(), ['ok', 'reference', 'requestId', 'state', 'upload']);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  const row = await f.store.findByKey(body.idempotencyKey);
  assert.equal(row.state, 'awaiting_upload'); assert.equal(row.email, 'alex@example.com'); assert.equal(row.intro, body.intro);
  assert.equal(row.resume_filename, 'Alex Chen Resume.pdf'); assert.match(row.resume_path, new RegExp(`^${row.id}/[0-9a-f]{24}\\.pdf$`));
  // Until its file arrives it is not a request the owner sees.
  assert.deepEqual(await f.store.list(), []);
});

test('upload then confirm queues the request once and wakes the worker', async () => {
  const f = fixture(); const body = form();
  const accepted = await send(f.submit, body);
  let res = await send(f.complete, { idempotencyKey: body.idempotencyKey });
  assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'upload_missing'); assert.equal(f.kicks.length, 0);
  assert.equal(f.upload(accepted).status, 200);
  res = await send(f.complete, { idempotencyKey: body.idempotencyKey });
  assert.equal(res.statusCode, 200); assert.equal(res.body.reference, accepted.body.reference);
  // The applicant is told it arrived and nothing about screening.
  assert.deepEqual(Object.keys(res.body).sort(), ['message', 'ok', 'reference', 'requestId']);
  const [row] = await f.store.list();
  assert.equal(row.state, 'queued'); assert.equal(row.resume_bytes, pdf().length); assert.equal(f.kicks.length, 1);
  // Confirming again changes nothing and does not wake the worker again.
  res = await send(f.complete, { idempotencyKey: body.idempotencyKey });
  assert.equal(res.statusCode, 200); assert.equal(f.kicks.length, 1); assert.equal((await f.store.list()).length, 1);
  res = await send(f.complete, { idempotencyKey: randomUUID() });
  assert.equal(res.statusCode, 404);
});

test('sending the same request again returns the same reference without a second verification', async () => {
  const f = fixture(); const body = form();
  const first = await send(f.submit, body);
  // The one-time verification token is spent; a retry of an accepted request must not need another.
  const retry = await send(f.submit, { ...body, turnstileToken: '' });
  assert.equal(retry.statusCode, 200); assert.equal(retry.body.reference, first.body.reference);
  assert.notEqual(retry.body.upload.url, first.body.upload.url, 'a fresh upload link');
  assert.equal(f.order.filter(step => step === 'verify').length, 1);
  assert.deepEqual(f.logs.map(entry => entry.outcome), ['accepted', 'repeated']);
  f.upload(retry); await send(f.complete, { idempotencyKey: body.idempotencyKey });
  const done = await send(f.submit, body);
  assert.equal(done.body.state, 'queued'); assert.equal('upload' in done.body, false);
  assert.equal((await f.store.list()).length, 1);
});

test('two hundred simultaneous copies of one request create exactly one', async () => {
  const f = fixture(); const body = form();
  const results = await Promise.all(Array.from({ length: 200 }, () => send(f.submit, body)));
  assert.equal(new Set(results.map(res => res.body.reference)).size, 1);
  assert.equal(results.filter(res => res.statusCode === 201).length, 1);
  assert.equal(results.filter(res => res.statusCode === 200).length, 199);
  f.upload(results[0]);
  await Promise.all(Array.from({ length: 50 }, () => send(f.complete, { idempotencyKey: body.idempotencyKey })));
  assert.equal((await f.store.list()).length, 1); assert.equal(f.kicks.length, 1);
});

test('a thousand different requests arriving together are all accepted, each with its own reference', async () => {
  const f = fixture();
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: 1000 }, (_, index) => send(f.submit, form({ email: `applicant${index}@example.com` }))));
  assert.equal(results.every(res => res.statusCode === 201), true);
  assert.equal(new Set(results.map(res => res.body.reference)).size, 1000);
  assert.ok(Date.now() - started < 5000, 'accepting is cheap: no model call or email on the request path');
});

test('logs record the outcome without names, addresses, tokens or text', async () => {
  const f = fixture(); const body = form();
  f.upload(await send(f.submit, body)); await send(f.complete, { idempotencyKey: body.idempotencyKey });
  assert.deepEqual(f.logs.map(entry => entry.outcome), ['accepted', 'queued']);
  for (const secret of ['Alex', 'alex@example.com', '203.0.113.7', 'valid-token', 'Northwind', 'higher.gs.com', body.idempotencyKey]) {
    assert.equal(JSON.stringify(f.logs).includes(secret), false, secret);
  }
});

for (const [label, change, status, code] of [
  ['GET', req => { req.method = 'GET'; }, 405, 'method_not_allowed'],
  ['another origin', req => { req.headers.origin = 'https://www.yuqi.site.evil.example'; }, 403, 'invalid_origin'],
  ['no origin', req => { delete req.headers.origin; }, 403, 'invalid_origin'],
  ['a cross-site request', req => { req.headers['sec-fetch-site'] = 'cross-site'; }, 403, 'invalid_origin'],
  ['the service-token path of the contact form', req => { req.headers['x-portfolio-contact-token'] = 'x'.repeat(40); }, 403, 'invalid_origin'],
  ['a form post', req => { req.headers['content-type'] = 'application/x-www-form-urlencoded'; }, 415, 'unsupported_content_type'],
  ['a filled honeypot', req => { req.body.website = 'https://spam.example'; }, 403, 'verification_failed'],
  ['no idempotency key', req => { delete req.body.idempotencyKey; }, 400, 'invalid_fields'],
  ['a missing name', req => { req.body.name = ''; }, 400, 'missing_field'],
  ['a first-person introduction', req => { req.body.intro = `I am a backend engineer. ${'I build services. '.repeat(15)}`; }, 400, 'intro_not_third_person'],
  ['an unfilled template', req => { req.body.intro = `Alex Chen is a [current title]. ${'Alex builds reliable services. '.repeat(8)}`; }, 400, 'intro_placeholder'],
  ['no résumé', req => { delete req.body.resume; }, 400, 'resume_required'],
  ['a résumé that is not a PDF', req => { req.body.resume = { name: 'cv.docx', size: 5000, type: 'application/msword' }; }, 400, 'resume_not_pdf'],
  ['a résumé over 2 MB', req => { req.body.resume.size = 3 * 1024 * 1024; }, 413, 'resume_too_large'],
  ['no consent', req => { req.body.consent = false; }, 400, 'consent_required'],
  ['a bad verification token', req => { req.body.turnstileToken = 'forged'; }, 403, 'verification_failed'],
]) test(`rejects ${label} before anything is stored`, async () => {
  const f = fixture(); const req = request(); change(req); const res = response();
  await f.submit(req, res);
  assert.equal(res.statusCode, status); assert.equal(res.body.code, code); assert.ok(res.body.error);
  assert.equal(res.body.upload, undefined);
  assert.equal(req.body.idempotencyKey ? await f.store.findByKey(req.body.idempotencyKey) : null, null);
  assert.equal(f.logs[0].outcome, 'not_accepted');
});

test('field errors name the field so the form can point at it', async () => {
  const f = fixture(); const res = await send(f.submit, form({ jobUrl: 'http://insecure.example/job' }));
  assert.equal(res.body.field, 'jobUrl'); assert.equal(res.body.code, 'invalid_field');
});

test('the per-network limit applies before verification, the flood valve only after it', async () => {
  const perIp = fixture({ isRateLimited: async (key, scope) => scope === 'referral' });
  let res = await send(perIp.submit, form());
  assert.equal(res.statusCode, 429); assert.equal(res.body.code, 'rate_limited'); assert.equal(perIp.order.includes('verify'), false);
  const flood = fixture({ isRateLimited: async (key, scope) => scope === 'referral-global' });
  res = await send(flood.submit, form());
  assert.equal(res.statusCode, 429); assert.equal(res.body.code, 'busy'); assert.deepEqual(flood.order, ['verify']);
  // An unverified request never reaches, and so never consumes, the shared valve.
  const unverified = fixture();
  await send(unverified.submit, form({ turnstileToken: 'forged' }));
  assert.deepEqual(unverified.limits.map(args => args[1]), ['referral']);
  assert.equal(unverified.limits[0][0], '203.0.113.7');
  // The valve is a flood guard, not a daily quota: its default is far above normal volume.
  const defaults = fixture(); await send(defaults.submit, form());
  assert.equal(defaults.limits.find(args => args[1] === 'referral-global')[2].limit, 5000);
});

test('the real verifier is asked for the referral action, so a contact-form token cannot be replayed', async () => {
  const result = action => ({ success: true, hostname: 'www.yuqi.site', action, challenge_ts: new Date().toISOString() });
  await verifyContactToken('t', { env, action: REFERRAL_ACTION, fetchImpl: async () => Response.json(result(REFERRAL_ACTION)) });
  await assert.rejects(verifyContactToken('t', { env, action: REFERRAL_ACTION, fetchImpl: async () => Response.json(result('contact_submit')) }), { code: 'verification_failed' });
  await assert.rejects(verifyContactToken('t', { env, fetchImpl: async () => Response.json(result(REFERRAL_ACTION)) }), { code: 'verification_failed' });
});

test('when nothing can be saved the applicant is told so, and nothing is half-done', async () => {
  const down = { findByKey: async () => null, accept: async () => { throw new Error('db down'); } };
  let res = await send(fixture({ store: down }).submit, form());
  assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'unavailable'); assert.match(res.body.error, /Nothing was sent/);
  // A missing table is reported the same way instead of pretending the request arrived.
  res = await send(fixture({ store: { findByKey: async () => null, accept: async () => null } }).submit, form());
  assert.equal(res.statusCode, 503);
});

test('the upload link only takes one PDF of the allowed size', async () => {
  const f = fixture(); const res = await send(f.submit, form());
  assert.equal(f.upload(res, pdf(), 'text/html').status, 415);
  assert.equal(f.upload(res, pdf('', { pad: 2 * 1024 * 1024 })).status, 413);
  assert.equal(f.upload(res).status, 200);
  assert.equal(f.upload(res).status, 409, 'it cannot be overwritten');
  assert.equal(f.storage.put('not-a-token', pdf(), 'application/pdf').status, 403);
});

async function queued(f, overrides) { const body = form(overrides); f.upload(await send(f.submit, body)); await send(f.complete, { idempotencyKey: body.idempotencyKey }); return (await f.store.findByKey(body.idempotencyKey)); }

test('the review list needs an authorised owner and supports status, note, résumé, rescreen and delete', async () => {
  const f = fixture(); const kicks = [];
  const row = await queued(f);
  let user = null;
  const admin = createReferralAdminHandler({ store: f.store, storage: f.storage, availability: openFor(), kick: async () => { kicks.push(1); },
    authorize: async (req, res) => { if (!user) res.status(401).json({ error: 'unauthorized' }); return user; } });
  const call = async (method, payload) => { const res = response(); await admin({ method, ...(method === 'GET' ? { query: payload || {} } : { body: payload }), headers: { host: 'www.yuqi.site' } }, res); return res; };
  assert.equal((await call('GET')).statusCode, 401);
  user = { userId: 'owner' };
  let res = await call('GET');
  assert.equal(res.body.enabled, true); assert.equal(res.body.requests.length, 1); assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(kicks.length, 1, 'opening the list wakes the worker for anything still queued');
  const { id } = row;
  // A file the worker has not checked yet cannot be opened.
  assert.equal((await call('POST', { id, action: 'resume' })).statusCode, 409);
  await f.store.update(id, { state: 'ready' });
  res = await call('POST', { id, action: 'resume' });
  assert.match(res.body.url, /Alex%20Chen%20Resume\.pdf/);
  res = await call('POST', { id, action: 'note', note: '  Referred on Monday. ' });
  assert.equal(res.body.owner_note, 'Referred on Monday.');
  res = await call('POST', { id, action: 'rescreen' });
  assert.equal(res.body.state, 'queued'); assert.equal(res.body.attempts, 0); assert.equal(kicks.length, 2);
  res = await call('POST', { id, action: 'status', status: 'referred' });
  assert.equal(res.body.status, 'referred'); assert.equal(f.storage.objects.size, 1, 'a referred request keeps its file until it expires');
  assert.equal((await call('GET', { status: 'new' })).body.requests.length, 0);
  for (const bad of [{ id, action: 'status', status: 'hired' }, { id: 'nope', action: 'delete' }, { id, action: 'note', note: 'x'.repeat(2001) }, { id }]) {
    assert.equal((await call('POST', bad)).statusCode, 400);
  }
  assert.equal((await call('POST', { id: randomUUID(), action: 'status', status: 'declined' })).statusCode, 404);
  // Declining deletes the résumé file straight away; the request itself stays.
  res = await call('POST', { id, action: 'status', status: 'declined' });
  assert.equal(res.body.status, 'declined'); assert.equal(res.body.resume_path, null); assert.equal(f.storage.objects.size, 0);
  assert.equal((await call('POST', { id, action: 'resume' })).statusCode, 409);
  assert.equal((await call('POST', { id, action: 'rescreen' })).statusCode, 409);
  const second = await queued(f, { email: 'second@example.com' });
  assert.equal(f.storage.objects.size, 1);
  res = await call('POST', { id: second.id, action: 'delete' });
  assert.equal(res.body.deleted, true); assert.equal(f.storage.objects.size, 0, 'deleting a request deletes its file');
  const missing = createReferralAdminHandler({ store: { list: async () => null }, storage: f.storage, availability: openFor(), authorize: async () => user });
  res = response(); await missing({ method: 'GET', query: {} }, res); { const { offer, ...rest } = res.body; assert.deepEqual(rest, { enabled: false, requests: [] }); assert.equal(offer.company, 'Goldman Sachs'); }
});

test('the worker endpoint runs only with the scheduler secret; the daily GET also does the housekeeping', async () => {
  const runs = [];
  const handler = createReferralWorkerHandler({ env, worker: { run: async options => { runs.push(options); return { claimed: 2 }; } } });
  const call = async (method, authorization) => { const res = response(); await handler({ method, headers: authorization ? { authorization } : {} }, res); return res; };
  assert.equal((await call('GET')).statusCode, 401); assert.equal((await call('POST', 'Bearer wrong')).statusCode, 401); assert.equal(runs.length, 0);
  let res = await call('POST', `Bearer ${env.CRON_SECRET}`);
  // A kick lingers for longer than the gap between kicks; the scheduled run does the housekeeping.
  assert.deepEqual(res.body, { ok: true, claimed: 2 }); assert.deepEqual(runs.at(-1), { housekeeping: false, lingerMs: KICK_GAP_MS + 2000 });
  await call('GET', `Bearer ${env.CRON_SECRET}`); assert.deepEqual(runs.at(-1), { housekeeping: true, lingerMs: 0 });
  const unset = createReferralWorkerHandler({ env: {}, worker: { run: async () => ({}) } });
  res = response(); await unset({ method: 'GET', headers: { authorization: 'Bearer undefined' } }, res); assert.equal(res.statusCode, 401);
});

test('a kick starts one separate worker run, is throttled, and never leaves the site', async () => {
  const calls = []; let limited = false;
  const kick = createWorkerKick({ env, waitMs: 5, isRateLimited: async (key, scope, options) => { assert.equal(scope, 'referral-kick'); assert.deepEqual(options, { limit: 1, windowMs: KICK_GAP_MS }); return limited; },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Promise(() => {}); } });
  assert.equal(await kick({ headers: { host: 'www.yuqi.site' } }), true);
  assert.equal(calls[0].url, 'https://www.yuqi.site/api/cron/referral-worker'); assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${env.CRON_SECRET}`); assert.equal(calls[0].options.redirect, 'error');
  // The secret is never sent to a host that is not this site, whatever the Host header says.
  for (const host of ['evil.example', 'www.yuqi.site.evil.example', 'localhost:3000', '']) assert.equal(await kick({ headers: { host } }), false);
  limited = true; assert.equal(await kick({ headers: { host: 'www.yuqi.site' } }), false);
  assert.equal(calls.length, 1);
  const local = createWorkerKick({ env: { ...env, NODE_ENV: 'development' }, waitMs: 5, isRateLimited: async () => false, fetchImpl: async url => { calls.push({ url }); } });
  assert.equal(await local({ headers: { host: '127.0.0.1:3147' } }), true); assert.equal(calls.at(-1).url, 'http://127.0.0.1:3147/api/cron/referral-worker');
  const noSecret = createWorkerKick({ env: {}, isRateLimited: async () => false, fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.equal(await noSecret({ headers: { host: 'www.yuqi.site' } }), false);
});

// ── Following the current employer ──────────────────────────────────────────

test('the company is decided by the work history and stored with the request', async () => {
  const f = fixture({ availability: openFor('Northwind Labs') });
  const body = form({ company: ' northwind  LABS ' });    // the same company, however the page spelled it
  const accepted = await send(f.submit, body);
  assert.equal(accepted.statusCode, 201);
  assert.equal((await f.store.findByKey(body.idempotencyKey)).company, 'Northwind Labs', 'the stored name is the server\'s, not the browser\'s');
});

test('a form opened before a job change is refused with the new company, before verification is spent', async () => {
  const f = fixture({ availability: openFor('Northwind Labs') });
  const body = form();                                   // still says Goldman Sachs
  const refused = await send(f.submit, body);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'company_changed'); assert.equal(refused.body.company, 'Northwind Labs');
  assert.match(refused.body.error, /reload the page/);
  assert.ok(!f.order.includes('verify'), 'the one-time token is not used up');
  assert.equal(await f.store.findByKey(body.idempotencyKey), null);
  // The same person, after reloading, is accepted for the new company, which is what gets stored.
  const again = await send(f.submit, { ...body, company: 'Northwind Labs' });
  assert.equal(again.statusCode, 201);
  assert.equal((await f.store.findByKey(body.idempotencyKey)).company, 'Northwind Labs');
});

test('between jobs or when paused nothing is accepted; an outage says try again instead', async () => {
  for (const [availability, status, code] of [
    [openFor(null), 409, 'referrals_paused'],
    [openFor('Goldman Sachs', { accepting: false, reason: 'paused' }), 409, 'referrals_paused'],
    [openFor(null, { reason: 'unknown', known: false }), 503, 'unavailable'],
  ]) {
    const f = fixture({ availability });
    const body = form();
    const res = await send(f.submit, body);
    assert.equal(res.statusCode, status); assert.equal(res.body.code, code);
    assert.ok(!f.order.includes('verify'));
    assert.equal(await f.store.findByKey(body.idempotencyKey), null);
  }
});

test('a request accepted before a job change can still finish its upload afterwards', async () => {
  const availability = openFor('Goldman Sachs');
  const f = fixture({ availability });
  const body = form();
  const first = await send(f.submit, body);
  availability.state.company = 'Northwind Labs';         // the work history changed in between
  const retry = await send(f.submit, body);              // same key: the request already exists
  assert.equal(retry.statusCode, 200); assert.equal(retry.body.reference, first.body.reference);
  assert.equal((await f.store.findByKey(body.idempotencyKey)).company, 'Goldman Sachs', 'it stays a request for the employer it was written for');
});

test('the owner can pause and reopen the form, and re-read the work history, from the review page', async () => {
  const f = fixture(); const availability = openFor(); const refreshed = [];
  const admin = createReferralAdminHandler({ store: f.store, storage: f.storage, availability, refresh: async () => { refreshed.push(1); }, authorize: async () => ({ userId: 'owner' }) });
  const post = async body => { const res = response(); await admin({ method: 'POST', body, query: {}, headers: {} }, res); return res; };
  assert.equal(await f.store.accepting(), true);
  let res = await post({ action: 'accepting', accepting: false });
  assert.equal(res.statusCode, 200); assert.equal(await f.store.accepting(), false);
  res = await post({ action: 'accepting', accepting: 'yes' });
  assert.equal(await f.store.accepting(), false, 'only a real true reopens it');
  res = await post({ action: 'accepting', accepting: true });
  assert.equal(await f.store.accepting(), true);
  res = await post({ action: 'refresh' });
  assert.equal(res.body.offer.company, 'Goldman Sachs');
  assert.equal(availability.state.cleared, 4, 'each change drops the cached answer');
  assert.equal(refreshed.length, 4, 'and regenerates the public pages');
  // A page refresh that fails does not undo or hide the change.
  const flaky = createReferralAdminHandler({ store: f.store, storage: f.storage, availability, refresh: async () => { throw new Error('revalidate failed'); }, authorize: async () => ({ userId: 'owner' }) });
  const out = response(); await flaky({ method: 'POST', body: { action: 'accepting', accepting: false }, query: {}, headers: {} }, out);
  assert.equal(out.statusCode, 200); assert.equal(await f.store.accepting(), false);
});
