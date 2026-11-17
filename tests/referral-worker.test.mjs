import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReferralWorker } from '../src/lib/referral/worker.mjs';
import { referralDigestMail } from '../src/lib/referral/mail.mjs';
import { normalizeScreening, rulesScreening } from '../src/lib/referral/screening.mjs';
import { MAX_ATTEMPTS, memoryReferralStore, referralRow, requestFromRow } from '../src/lib/referral/store.mjs';
import { memoryResumeStorage, resumePath } from '../src/lib/referral/storage.mjs';
import { referralFields } from '../src/lib/referral/fields.mjs';
import { ADDITIONAL_ROLES, AI_NOTE, INTRO, form, pdf } from './referral-fixtures.mjs';

const aiNote = normalizeScreening(AI_NOTE, { resumeRead: true });

function fixture({ screen, enabled = true, limited = () => false, sendMail, env = {} } = {}) {
  let clock = Date.parse('2026-11-16T12:00:00Z');
  const store = memoryReferralStore([], () => clock);
  const storage = memoryResumeStorage();
  const mails = [], screened = [], logs = [];
  const screener = { enabled: () => enabled, screen: async (request, resume, options) => {
    screened.push({ name: request.name, email: request.email, bytes: resume.bytes.length, options });
    return screen ? screen(request, resume, options) : (options.skipAi ? rulesScreening(request, { reason: options.skipAi }) : aiNote);
  } };
  const hooks = { onSleep: null };
  const worker = createReferralWorker({ store, storage, screener, env, now: () => clock, log: entry => logs.push(entry),
    sleep: async ms => { clock += ms; await hooks.onSleep?.(); },
    sendMail: sendMail || (async mail => { mails.push(mail); }), isRateLimited: async (...args) => limited(...args) });
  // A request as the handlers leave it: accepted, uploaded, queued.
  async function add(overrides = {}, bytes = pdf()) {
    const body = form(overrides); const id = randomUUID(); const path = resumePath(id);
    await store.accept({ id, ...referralRow({ key: body.idempotencyKey, reference: `R-${id.slice(0, 12).toUpperCase()}`, request: referralFields(body),
      resume: { filename: 'resume.pdf', size: bytes?.length || 1 }, path }) });
    if (bytes) { const ticket = await storage.createUpload(path); storage.put(new URL(ticket.url, 'http://x').searchParams.get('token'), bytes, 'application/pdf'); }
    await store.markUploaded(id, bytes?.length || 1);
    return id;
  }
  return { store, storage, worker, mails, screened, logs, add, hooks, advance: ms => { clock += ms; }, now: () => clock };
}

test('a queued request is checked, screened, saved and announced in one digest', async () => {
  const f = fixture(); const id = await f.add();
  const summary = await f.worker.run();
  assert.deepEqual({ claimed: summary.claimed, screened: summary.screened, rejected: summary.rejected, failed: summary.failed, notified: summary.notified, waiting: summary.waiting },
    { claimed: 1, screened: 1, rejected: 0, failed: 0, notified: 1, waiting: 0 });
  const row = await f.store.get(id);
  assert.equal(row.state, 'ready'); assert.equal(row.recommendation, 'strong'); assert.equal(row.fit, 82); assert.equal(row.lease_until, null);
  assert.match(row.resume_sha256, /^[0-9a-f]{64}$/); assert.ok(row.notified_at); assert.ok(row.resume_path);
  assert.equal(f.screened[0].bytes, pdf().length); assert.equal(f.screened[0].options.skipAi, null);
  const [mail] = f.mails;
  assert.match(mail.subject, /^Referral request: Associate, Software Engineering · Alex Chen \(Pass · 82\/100\)$/);
  assert.equal(mail.replyTo, 'alex@example.com');
  assert.equal('attachments' in mail, false, 'the résumé is opened from the review page, never attached');
  // The introduction reaches the owner exactly as the applicant wrote it.
  assert.ok(mail.text.includes(`Their introduction, in their own words:\n${INTRO}`));
  assert.match(mail.text, /not a referral decision/);
  // Nothing left to do: a second run claims nothing and sends nothing.
  const again = await f.worker.run();
  assert.equal(again.claimed, 0); assert.equal(f.mails.length, 1);
  assert.equal(f.logs[0].event, 'referral_worker'); assert.equal(JSON.stringify(f.logs).includes('alex@example.com'), false);
});

test('the worker and both email formats retain three roles without extra screenings or digests', async () => {
  let seen;
  const f = fixture({ screen: async request => { seen = request; return aiNote; } });
  const id = await f.add({ additionalRoles: ADDITIONAL_ROLES });
  const summary = await f.worker.run();
  assert.equal(summary.screened, 1); assert.equal(summary.notified, 1); assert.equal(f.mails.length, 1);
  assert.deepEqual(seen.additionalRoles, ADDITIONAL_ROLES);
  const row = await f.store.get(id);
  assert.deepEqual(requestFromRow(row).additionalRoles, ADDITIONAL_ROLES);
  const [mail] = f.mails;
  assert.match(mail.subject, /3 roles/);
  for (const role of ADDITIONAL_ROLES) for (const format of ['text', 'html']) {
    assert.ok(mail[format].includes(role.roleTitle)); assert.ok(mail[format].includes(role.jobUrl));
    assert.ok(mail[format].includes(role.requirements));
  }
  const { additional_roles: _extra, ...legacy } = row;
  assert.deepEqual(requestFromRow(legacy).additionalRoles, []);
});

test('overlapping workers never screen the same request twice', async () => {
  const f = fixture({ screen: async () => { await new Promise(resolve => setTimeout(resolve, 2)); return aiNote; } });
  const ids = []; for (let i = 0; i < 60; i += 1) ids.push(await f.add({ email: `a${i}@example.com` }));
  const summaries = await Promise.all(Array.from({ length: 6 }, () => f.worker.run({ batch: 4 })));
  assert.equal(summaries.reduce((sum, item) => sum + item.screened, 0), 60);
  const emails = f.screened.map(item => item.email);
  assert.equal(emails.length, 60); assert.equal(new Set(emails).size, 60);
  for (const id of ids) assert.equal((await f.store.get(id)).state, 'ready');
  assert.equal((await f.store.queueDepth()), 0);
});

test('an unsafe or unreadable file is deleted before anyone can open it, and the request still arrives', async () => {
  const f = fixture();
  const script = await f.add({ email: 'script@example.com' }, pdf('4 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj'));
  const fake = await f.add({ email: 'fake@example.com' }, Buffer.from('<html>'.repeat(100)));
  const summary = await f.worker.run();
  assert.equal(summary.rejected, 2); assert.equal(summary.screened, 0); assert.equal(f.screened.length, 0, 'the model never sees a refused file');
  assert.equal(f.storage.objects.size, 0);
  for (const [id, reason] of [[script, /contains scripts or embedded files/], [fake, /not a readable PDF/]]) {
    const row = await f.store.get(id);
    assert.equal(row.state, 'file_rejected'); assert.equal(row.resume_path, null); assert.equal(row.fit, null);
    assert.match(row.screening.concerns[0], reason); assert.match(row.screening.summary, /The résumé was refused/);
  }
  assert.match(f.mails[0].text, /résumé refused/);
});

test('a request whose file has vanished is delivered with that said', async () => {
  const f = fixture(); const id = await f.add({}, null);
  await f.worker.run();
  const row = await f.store.get(id);
  assert.equal(row.state, 'ready'); assert.equal(row.screening.source, 'rules'); assert.match(row.screening.concerns[0], /could not be found in storage/);
});

test('a run that dies keeps its claim only until the lease runs out', async () => {
  const f = fixture(); const id = await f.add();
  const [claimed] = await f.store.claimScreenings(4, 120);
  assert.equal(claimed.id, id); assert.equal(claimed.attempts, 1);
  // The worker that claimed it has crashed. Another run right now must leave it alone.
  assert.equal((await f.worker.run()).claimed, 0);
  f.advance(121000);
  const summary = await f.worker.run();
  assert.equal(summary.claimed, 1); assert.equal((await f.store.get(id)).state, 'ready'); assert.equal((await f.store.get(id)).attempts, 2);
});

test('storage trouble is retried, and after five attempts the request is delivered without a note', async () => {
  const f = fixture(); const id = await f.add();
  f.storage.download = async () => { throw new Error('storage down'); };
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    const summary = await f.worker.run();
    assert.equal(summary.claimed, 1, 'a failed request is not retried within the same run'); assert.equal(summary.failed, 1);
    assert.equal((await f.store.get(id)).attempts, attempt);
    // It waits out a growing back-off before the next attempt.
    f.advance(60000 * attempt - 1000); assert.equal((await f.worker.run()).claimed, 0);
    f.advance(2000);
  }
  await f.worker.run();
  const row = await f.store.get(id);
  assert.equal(row.state, 'ready'); assert.equal(row.screening.source, 'rules'); assert.match(row.screening.summary, /the screening model did not answer/);
  assert.equal((await f.worker.run()).claimed, 0);
});

test('past the daily AI allowance requests still arrive, with a completeness note', async () => {
  const seen = [];
  const f = fixture({ limited: (key, scope, options) => { seen.push([key, scope, options.limit, options.windowMs]); return true; }, env: { REFERRAL_AI_DAILY_LIMIT: '25' } });
  const id = await f.add();
  await f.worker.run();
  assert.deepEqual(seen[0], ['all', 'referral-ai', 25, 86400000]);
  assert.equal(f.screened[0].options.skipAi, 'daily_cap');
  assert.equal((await f.store.get(id)).screening.source, 'rules');
  // With the model switched off the allowance is not even consulted.
  const off = fixture({ enabled: false, limited: () => { throw new Error('not consulted'); } });
  await off.add(); assert.equal((await off.worker.run()).screened, 1);
});

test('a busy hour sends a handful of digests, not an email per request', async () => {
  const f = fixture({ env: { REFERRAL_DIGESTS_PER_HOUR: '3' } });
  for (let round = 0; round < 5; round += 1) {
    for (let i = 0; i < 8; i += 1) await f.add({ email: `r${round}-${i}@example.com`, name: `Applicant ${round}-${i}` });
    await f.worker.run({ batch: 8 });
  }
  assert.equal(f.mails.length, 3);
  assert.match(f.mails[1].subject, /^8 new referral requests \(8 passed initial screening\)$/);
  assert.equal('replyTo' in f.mails[1], false);
  assert.equal(f.mails[1].text.includes('Their introduction, in their own words'), false, 'a long digest is a list');
  assert.match(f.mails[1].text, /- Applicant 1-0 — Associate, Software Engineering — Pass · 82\/100/);
  // The rest wait for the next hour's first digest rather than being dropped.
  f.advance(3600000);
  await f.worker.run();
  assert.equal(f.mails.length, 4); assert.match(f.mails[3].subject, /^16 new referral requests/);
  assert.equal((await f.store.list()).every(row => row.notified_at), true);
});

test('a digest that could not be sent is offered again', async () => {
  let fail = true; const sent = [];
  const f = fixture({ sendMail: async mail => { if (fail) throw new Error('smtp down'); sent.push(mail); } });
  const id = await f.add();
  assert.equal((await f.worker.run()).notified, 0); assert.equal((await f.store.get(id)).notified_at, null);
  fail = false;
  assert.equal((await f.worker.run()).notified, 1); assert.equal(sent.length, 1);
});

test('housekeeping deletes expired and closed files, old requests and uploads that never finished', async () => {
  const f = fixture();
  const kept = await f.add({ email: 'kept@example.com' });
  const closed = await f.add({ email: 'closed@example.com' });
  const old = await f.add({ email: 'old@example.com' });
  await f.worker.run({ batch: 8 });
  await f.store.update(closed, { status: 'archived' });
  await f.store.update(old, { resume_expires_at: new Date(f.now() - 1000).toISOString() });
  const body = form({ email: 'abandoned@example.com' }); const abandoned = randomUUID();
  await f.store.accept({ id: abandoned, ...referralRow({ key: body.idempotencyKey, reference: 'R-ABANDONED', request: referralFields(body), resume: { filename: 'r.pdf', size: 10 }, path: resumePath(abandoned) }) });
  assert.equal((await f.worker.run()).filesDeleted, 0, 'a kick does no housekeeping');
  let summary = await f.worker.run({ housekeeping: true });
  assert.equal(summary.filesDeleted, 2); assert.equal(summary.purged, 0);
  assert.ok((await f.store.get(kept)).resume_path); assert.equal((await f.store.get(closed)).resume_path, null); assert.equal((await f.store.get(old)).resume_path, null);
  assert.equal(f.storage.objects.size, 1);
  f.advance(25 * 3600000);
  summary = await f.worker.run({ housekeeping: true });
  assert.equal(summary.purged, 1); assert.equal(await f.store.get(abandoned), null);
  f.advance(181 * 86400000);
  summary = await f.worker.run({ housekeeping: true });
  assert.equal(summary.purged, 3); assert.equal(summary.filesDeleted, 1); assert.equal(f.storage.objects.size, 0); assert.deepEqual(await f.store.list(), []);
});

test('a run stops claiming when its time budget is spent and reports what is still waiting', async () => {
  const f = fixture({ screen: async () => { f.advance(30000); return aiNote; } });
  for (let i = 0; i < 6; i += 1) await f.add({ email: `b${i}@example.com` });
  const summary = await f.worker.run({ batch: 1, budgetMs: 40000 });
  assert.equal(summary.screened, 2); assert.equal(summary.waiting, 4);
  assert.match(f.mails[0].text, /4 more are still being screened\./);
});

test('a run started by a kick lingers, so a request that arrives just after the queue empties is not left behind', async () => {
  const f = fixture(); await f.add({ email: 'first@example.com' });
  let late = null, polls = 0;
  // The second request arrives while the run is idle, after its queue was already empty.
  f.hooks.onSleep = async () => { polls += 1; if (polls === 2) late = await f.add({ email: 'late@example.com' }); };
  const summary = await f.worker.run({ lingerMs: 12000, pollMs: 2000 });
  assert.equal(summary.screened, 2); assert.equal((await f.store.get(late)).state, 'ready');
  // It stops once nothing has arrived for the linger time, not at the time budget.
  assert.ok(polls >= 7 && polls <= 9, `polls: ${polls}`); assert.ok(f.logs[0].ms < 30000);
  // Without lingering (the scheduled run) it returns as soon as the queue is empty.
  polls = 0; await f.worker.run(); assert.equal(polls, 0);
});

test('the digest escapes everything and shows up to three requests in full', () => {
  const row = (overrides = {}) => ({ state: 'ready', name: 'Alex <b>Chen</b>', email: 'alex@example.com', role_title: 'Engineer "Platform" & Data', job_url: 'https://higher.gs.com/roles/1',
    relationship: 'school', intro: INTRO, why_role: '<script>alert(1)</script>', reference: 'R-TEST', recommendation: 'promising', fit: 61, years_experience: 1,
    screening: { source: 'ai', recommendation: 'promising', fit: 61, summary: 'Thin but relevant.', strengths: ['One <i>good</i> project.'], concerns: [], followUps: [], flags: ['injection'] }, ...overrides });
  const mail = referralDigestMail([row(), row({ name: 'Sam', recommendation: 'strong', fit: 82, screening: aiNote }),
    row({ name: 'Rules Only', recommendation: 'unclear', fit: null, screening: { source: 'rules', summary: 'Completeness check only.' } })]);
  assert.equal(/[\r\n]/.test(mail.subject), false); assert.equal(mail.subject, '3 new referral requests (1 passed initial screening)');
  assert.equal(mail.html.includes('<script>'), false); assert.equal(mail.html.includes('<b>Chen</b>'), false); assert.match(mail.html, /Alex &lt;b&gt;Chen&lt;\/b&gt;/);
  // Strongest first; a request no model judged is labelled as such.
  assert.ok(mail.text.indexOf('Sam — ') < mail.text.indexOf('Alex <b>Chen</b> — ')); assert.match(mail.text, /Signal: Not AI-screened/);
  assert.match(mail.text, /Previous scoring policy - screen again/);
  assert.match(mail.text, /The text tried to instruct the screening model/); assert.match(mail.text, /Experience: 1 year\n/);
  assert.deepEqual(requestFromRow({ ...row(), years_experience: 3 }).years, 3);
});
