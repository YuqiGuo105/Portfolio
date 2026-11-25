// Public-data checks, the screening outcome (pass, automatic decline, review), one request per
// person, the applicant's status link, and the two emails a pass sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { classifyLink, createPublicEvidence, evidenceFacts, evidenceTargets, pathChecks, resumeLinks } from '../src/lib/referral/publicEvidence.mjs';
import { autoDeclineBelow, gradeEvidence, screeningOutcome, storedChecks } from '../src/lib/referral/rubric.mjs';
import { createReferralAi, normalizeScreening, rulesScreening } from '../src/lib/referral/screening.mjs';
import { applicantKey, referralFields } from '../src/lib/referral/fields.mjs';
import { applicantStage, publicStatus, readStatusToken, statusToken, statusUrl } from '../src/lib/referral/status.mjs';
import { createReferralAdminHandler, createReferralCompleteHandler, createReferralHandler, createReferralStatusHandler } from '../src/lib/referral/handler.mjs';
import { createReferralWorker } from '../src/lib/referral/worker.mjs';
import { noReplyMailbox, passMails } from '../src/lib/referral/mail.mjs';
import { memoryReferralStore, referralRow } from '../src/lib/referral/store.mjs';
import { memoryResumeStorage, resumePath } from '../src/lib/referral/storage.mjs';
import { inspectResume } from '../src/lib/referral/resume.mjs';
import { AI_NOTE, form, openFor, pdf, request, response } from './referral-fixtures.mjs';

const env = { NODE_ENV: 'production', CRON_SECRET: 'cron-secret-for-tests' };
const none = () => ({ score: 0, meetsBar: false, reason: 'No evidence.', evidence: [], links: [] });
const strong = (score, links = ['https://github.com/alex/ledger']) => ({ score, meetsBar: true, reason: 'Substantive evidence.', evidence: ['Resume p.1: specific work.'], links });
const weakNote = (extra = {}) => ({ ...AI_NOTE, assessment: { employer: none(), contests: none(), openSource: { ...strong(34), meetsBar: false } }, ...extra });

// GitHub and LeetCode as a table of answers; every call is recorded.
function services(table = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', auth: options.headers?.Authorization || '', body: options.body });
    const key = Object.keys(table).find(part => url.includes(part));
    if (!key) return new Response('{}', { status: 404 });
    const value = table[key];
    if (value === 'down') throw new TypeError('network');
    return typeof value === 'number' ? new Response('{}', { status: value }) : Response.json(value);
  };
  return { calls, fetchImpl };
}
const GITHUB = {
  '/repos/apache/kafka/pulls/123': { title: 'Fix idempotent producer retry', user: { login: 'alex' }, merged: true, state: 'closed', merged_at: '2026-03-04T10:00:00Z', additions: 210, deletions: 40, changed_files: 6, base: { repo: { stargazers_count: 28000 } } },
  '/repos/alex/ledger': { owner: { login: 'alex' }, fork: false, stargazers_count: 340, forks_count: 30, language: 'Java', created_at: '2024-01-01T00:00:00Z', pushed_at: '2026-10-30T00:00:00Z' },
  '/search/issues': { total_count: 9 },
  '/users/alex/repos': [{ name: 'ledger', fork: false, stargazers_count: 340, language: 'Java' }, { name: 'fork', fork: true, stargazers_count: 9000 }],
  '/users/alex': { login: 'alex', name: 'Alex Chen', created_at: '2019-05-01T00:00:00Z', public_repos: 14, followers: 80 },
};
const LEETCODE = { 'leetcode.com/graphql': { data: { matchedUser: { username: 'alexc' },
  userContestRanking: { attendedContestsCount: 41, rating: 2143.6, globalRanking: 9000, totalParticipants: 600000, topPercentage: 1.52, badge: { name: 'Knight' } },
  userContestRankingHistory: [{ attended: false }, { attended: true, rating: 2140, ranking: 310, contest: { title: 'Weekly Contest 470', startTime: 1790000000 } }] } } };
const links = 'Alex maintains https://github.com/alex/ledger, merged github.com/apache/kafka/pull/123 and competes as https://leetcode.com/u/alexc/.';

test('links are read from the form and from compressed PDF streams, and only real targets are kept', () => {
  const stream = deflateSync(Buffer.from('<< /Type /Annot /A << /S /URI /URI (https://github.com/alex/ledger/pull/7) >> >>'));
  const file = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length 1 >>\nstream\n', 'latin1'), stream, Buffer.from('\nendstream\nendobj\n(https://leetcode.cn/u/alexc)\n%%EOF', 'latin1')]);
  assert.deepEqual(resumeLinks(file).sort(), ['https://github.com/alex/ledger/pull/7', 'https://leetcode.cn/u/alexc']);
  // Chrome and Skia write link targets with octal escapes; other writers use hex strings or nested brackets.
  const skia = Buffer.from('%PDF-1.3\n<< /Type /Annot /A << /S /URI /URI (https\\072\\057\\057github\\056com\\057YuqiGuo105) >> >>\n'
    + '<< /A << /S /URI /URI (https\\072\\057\\057www\\056linkedin\\056com\\057in\\057yuqi\\055guo) >> >>\n'
    + `<< /A << /URI <${Buffer.from('https://leetcode.com/u/alexc/').toString('hex')}> >> >>\n<< /A << /URI (mailto\\072a\\100b\\056c) >> >>\n%%EOF`, 'latin1');
  assert.deepEqual(resumeLinks(skia).sort(), ['https://github.com/YuqiGuo105', 'https://leetcode.com/u/alexc/', 'https://www.linkedin.com/in/yuqi-guo']);
  const fromSkia = evidenceTargets({}, skia);
  assert.deepEqual({ logins: fromSkia.logins, leetcode: fromSkia.leetcode.username, linkedin: fromSkia.linkedin }, { logins: ['YuqiGuo105'], leetcode: 'alexc', linkedin: 'https://www.linkedin.com/in/yuqi-guo' });
  // A crafted stream cannot expand without limit.
  const bomb = Buffer.concat([Buffer.from('%PDF-1.4\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'), deflateSync(Buffer.alloc(8 * 1024 * 1024, 0x61)), Buffer.from('\nendstream', 'latin1')]);
  assert.deepEqual(resumeLinks(bomb), []);
  assert.deepEqual(classifyLink('https://github.com/apache/kafka/pull/123/files'), { kind: 'pull', owner: 'apache', repo: 'kafka', number: 123 });
  assert.deepEqual(classifyLink('https://github.com/alex/ledger.git'), { kind: 'repo', owner: 'alex', repo: 'ledger' });
  assert.deepEqual(classifyLink('https://leetcode.com/u/alexc/'), { kind: 'leetcode', site: 'com', username: 'alexc' });
  for (const link of ['https://github.com/features/copilot', 'https://github.com.evil.test/alex', 'http://github.com/alex', 'https://user:pw@github.com/alex',
    'https://github.com/alex/../..', 'https://leetcode.com/problems/two-sum', 'https://github.com/a%2Fb/c', 'https://gitlab.com/alex/ledger']) assert.equal(classifyLink(link), null, link);
  const targets = evidenceTargets({ intro: links, profileUrl: 'https://github.com/alex', whyRole: Array.from({ length: 9 }, (_, i) => `github.com/alex/r${i}`).join(' ') }, null);
  assert.equal(targets.pulls.length, 1); assert.equal(targets.repos.length, 3, 'a few repositories at most'); assert.deepEqual(targets.logins, ['alex']); assert.equal(targets.leetcode.username, 'alexc');
});

test('lookups go to three fixed hosts, never to a link the applicant wrote, and report what is there', async () => {
  const f = services({ ...GITHUB, ...LEETCODE });
  const evidence = await createPublicEvidence({ env: { REFERRAL_GITHUB_TOKEN: 'gh-token' }, fetchImpl: f.fetchImpl }).gather({ intro: `${links} See https://evil.test/collect?x=1` }, null);
  assert.ok(f.calls.length <= 9);
  assert.ok(f.calls.every(call => /^https:\/\/(api\.github\.com|leetcode\.com)\//.test(call.url)));
  assert.ok(f.calls.filter(call => call.url.includes('api.github.com')).every(call => call.auth === 'Bearer gh-token'));
  assert.equal(JSON.parse(f.calls.find(call => call.url.includes('leetcode')).body).variables.name, 'alexc');
  assert.deepEqual({ merged: evidence.github.pulls[0].merged, author: evidence.github.pulls[0].author, fork: evidence.github.repos[0].fork, elsewhere: evidence.github.account.mergedElsewhere },
    { merged: true, author: 'alex', fork: false, elsewhere: 9 });
  assert.deepEqual(evidence.github.account.topOwnRepos.map(item => item.name), ['ledger'], 'forks are not the account\'s own work');
  assert.deepEqual({ rating: evidence.leetcode.rating, attended: evidence.leetcode.attended, top: evidence.leetcode.topPercentage }, { rating: 2143, attended: 41, top: 1.52 });
  assert.deepEqual(pathChecks(evidence), { openSource: 'verified', contests: 'verified' });
  const facts = evidenceFacts(evidence);
  assert.match(facts.openSource[0], /apache\/kafka#123 by alex is merged \(2026-03-04\)/); assert.match(facts.contests[0], /contest rating 2143 over 41 contests, top 1\.52%/);
  assert.equal(await createPublicEvidence({ fetchImpl: f.fetchImpl }).gather({ intro: 'No links here.' }, null), null);
});

test('references that do not hold are contradicted; a service that cannot be asked never counts against anyone', async () => {
  const gather = (table, intro = links) => createPublicEvidence({ env: {}, fetchImpl: services(table).fetchImpl }).gather({ intro }, null);
  const unmerged = await gather({ '/repos/apache/kafka/pulls/123': { ...GITHUB['/repos/apache/kafka/pulls/123'], merged: false, state: 'open', merged_at: null },
    '/repos/alex/ledger': { ...GITHUB['/repos/alex/ledger'], fork: true }, '/search/issues': { total_count: 0 }, '/users/alex': GITHUB['/users/alex'],
    'leetcode.com/graphql': { data: { matchedUser: { username: 'alexc' }, userContestRanking: null, userContestRankingHistory: [] } } });
  assert.deepEqual(pathChecks(unmerged), { openSource: 'contradicted', contests: 'contradicted' });
  assert.match(evidenceFacts(unmerged).openSource.join(' '), /is not merged \(open\).*is a fork/);
  assert.deepEqual(pathChecks(await gather({})), { openSource: 'contradicted', contests: 'unavailable' }, 'not found on GitHub; LeetCode answered 404');
  assert.deepEqual(pathChecks(await gather({ 'api.github.com': 403, 'leetcode.com': 'down' })), { openSource: 'unavailable', contests: 'unavailable' });
  // Only a profile link: nothing specific was cited, so nothing is contradicted.
  assert.deepEqual(pathChecks(await gather({ '/search/issues': { total_count: 0 }, '/users/alex': GITHUB['/users/alex'] }, 'See github.com/alex')), {});
});

test('the rubric uses the checks: verified work needs no model link, contradicted work is capped at 39', () => {
  const assessment = { employer: none(), contests: none(), openSource: strong(90, []) };
  assert.equal(gradeEvidence(assessment).passed, false, 'no reference at all');
  const verified = gradeEvidence(assessment, { verification: { openSource: 'verified' } });
  assert.equal(verified.passed, true); assert.equal(verified.criteria.openSource.check, 'verified');
  const contradicted = gradeEvidence({ ...assessment, openSource: strong(95) }, { verification: { openSource: 'contradicted' } });
  assert.deepEqual({ passed: contradicted.passed, score: contradicted.score }, { passed: false, score: 39 });
  assert.equal(gradeEvidence({ ...assessment, openSource: strong(95) }, { verification: { openSource: 'unavailable' } }).passed, true);
  // The model cannot claim a check, and the employer path is never auto-verified.
  const sneaky = gradeEvidence({ ...assessment, openSource: { ...strong(95, []), check: 'verified', verification: 'verified' } }, { verification: { employer: 'verified' } });
  assert.equal(sneaky.passed, false); assert.equal(sneaky.criteria.employer.check, 'unchecked');
  assert.deepEqual(storedChecks(verified), { employer: 'unchecked', openSource: 'verified', contests: 'unchecked' });
});

test('the model is given the fetched facts and the note keeps them', async () => {
  const f = services({ ...GITHUB, ...LEETCODE });
  let sent;
  const fetchImpl = async (url, options) => {
    if (!url.includes('generativelanguage')) return f.fetchImpl(url, options);
    sent = JSON.parse(options.body);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ...AI_NOTE, assessment: { ...AI_NOTE.assessment, openSource: strong(88, []) } }) }] } }], usageMetadata: { promptTokenCount: 900, totalTokenCount: 1100 } });
  };
  const ai = createReferralAi({ env: { REFERRAL_AI_ENABLED: '1', GEMINI_API_KEY: 'k' }, fetchImpl, spend: { reserve: async () => ({ settle: async () => {} }) }, log: () => {} });
  const note = await ai.screen({ ...referralFields(form({ intro: `${form().intro} ${links}` })), company: 'Goldman Sachs' }, null);
  const payload = JSON.parse(sent.contents[0].parts[0].text);
  assert.equal(payload.publicChecks.github.pullRequests[0].merged, true); assert.equal(payload.publicChecks.leetcode.rating, 2143);
  assert.match(sent.systemInstruction.parts[0].text, /publicChecks.*in preference to self-reported numbers/);
  assert.equal(note.passed, true); assert.equal(note.criteria.openSource.check, 'verified'); assert.ok(note.checkFacts.openSource.length >= 2);
  assert.equal(note.rubric, 'evidence-v2');
});

test('outcome: a pass, an automatic decline under the bar, and everything a person must look at', () => {
  const grade = (value, options) => normalizeScreening(value, { resumeRead: true, profileUrl: 'https://www.linkedin.com/in/alex-example', ...options });
  assert.equal(screeningOutcome(grade(AI_NOTE)), 'passed');
  assert.equal(screeningOutcome(grade(weakNote())), 'auto_declined');
  assert.equal(screeningOutcome(grade(weakNote({ flags: ['spam'] }))), 'auto_declined');
  // Major-company experience on the résumé with a LinkedIn profile goes straight to the owner, also when the profile is only on the résumé.
  const bigCo = { ...AI_NOTE, assessment: { employer: strong(88, []), openSource: none(), contests: none() } };
  assert.equal(screeningOutcome(grade(bigCo)), 'passed');
  assert.equal(screeningOutcome(grade(bigCo, { profileUrl: '' })), 'passed', 'the résumé is enough; a LinkedIn link is optional');
  // A path the model found strong but that has no link to check goes to the owner, never to an automatic decline.
  const noLink = grade({ ...AI_NOTE, assessment: { employer: none(), contests: none(), openSource: strong(85, []) } });
  assert.equal(noLink.passed, false); assert.equal(noLink.score, 59); assert.equal(screeningOutcome(noLink), 'review');
  const fromResume = grade(bigCo, { profileUrl: 'https://alex.example/portfolio', checks: { linkedin: 'https://www.linkedin.com/in/alex-chen' } });
  assert.equal(screeningOutcome(fromResume), 'passed'); assert.equal(fromResume.linkedinProfile, 'https://www.linkedin.com/in/alex-chen');
  // Waiting on the owner: a résumé that disagrees, a lookup that failed, no model at all.
  assert.equal(screeningOutcome(grade(weakNote({ consistency: 'conflicts' }))), 'review');
  assert.equal(screeningOutcome({ ...grade(weakNote()), criteria: { ...grade(weakNote()).criteria, contests: { score: 80, meetsBar: true, check: 'unavailable' } } }), 'review');
  assert.equal(screeningOutcome(rulesScreening({ relationship: 'not_yet' })), 'review');
  assert.equal(screeningOutcome({ source: 'ai', rubric: 'evidence-v1', score: 10, passed: false }), 'review', 'an old-policy note decides nothing');
  // The threshold is configurable, never above the pass mark, and 0 switches it off.
  assert.deepEqual([{}, { REFERRAL_AUTO_DECLINE_BELOW: '40' }, { REFERRAL_AUTO_DECLINE_BELOW: '0' }, { REFERRAL_AUTO_DECLINE_BELOW: '95' }, { REFERRAL_AUTO_DECLINE_BELOW: 'x' }].map(autoDeclineBelow), [60, 40, 0, 60, 60]);
  assert.equal(screeningOutcome(grade(weakNote()), { REFERRAL_AUTO_DECLINE_BELOW: '0' }), 'review');
  assert.equal(screeningOutcome(grade(weakNote()), { REFERRAL_AUTO_DECLINE_BELOW: '30' }), 'review', '34 is not under 30');
});

test('one mailbox is one applicant per company, however it is written', () => {
  const key = applicantKey('alex.chen+jobs@gmail.com', 'Goldman  Sachs');
  assert.equal(key, 'goldman sachs|alexchen@gmail.com');
  assert.equal(applicantKey('AlexChen@googlemail.com', 'goldman sachs'), key);
  assert.notEqual(applicantKey('alex.chen@example.com', 'Goldman Sachs'), applicantKey('alexchen@example.com', 'Goldman Sachs'), 'dots matter outside Gmail');
  assert.notEqual(applicantKey('alexchen@gmail.com', 'Northwind'), key, 'a new employer is a new chance');
  assert.equal(applicantKey('alex@example.com', ''), null);
});

function site(options = {}) {
  const store = memoryReferralStore(), storage = memoryResumeStorage();
  const deps = { env, store, storage, availability: openFor(), isRateLimited: async () => false, audit: () => {} };
  const submit = createReferralHandler({ ...deps, verifyToken: async () => {}, ...options });
  const complete = createReferralCompleteHandler({ ...deps, kick: async () => {} });
  const status = createReferralStatusHandler(deps);
  const send = async (handler, body) => { const res = response(); await handler(request(body), res); return res; };
  const apply = async (overrides = {}) => {
    const body = form(overrides); const accepted = await send(submit, body);
    if (accepted.statusCode === 201) { storage.put(new URL(accepted.body.upload.url, 'http://x').searchParams.get('token'), pdf(), 'application/pdf'); return { body, accepted, done: await send(complete, { idempotencyKey: body.idempotencyKey }) }; }
    return { body, accepted };
  };
  return { store, storage, submit, complete, status, send, apply };
}

test('a second request from the same person is refused, also when both arrive at once', async () => {
  const f = site();
  const first = await f.apply({ email: 'alex.chen@gmail.com' });
  assert.equal(first.done.statusCode, 200);
  const again = await f.apply({ email: 'AlexChen+2@gmail.com' });
  assert.deepEqual({ status: again.accepted.statusCode, code: again.accepted.body.code, field: again.accepted.body.field }, { status: 409, code: 'already_applied', field: 'email' });
  assert.equal((await f.apply({ email: 'someone.else@gmail.com' })).done.statusCode, 200);
  // The same click sent twice is still the same request, not a duplicate.
  assert.equal((await f.send(f.submit, { ...first.body, turnstileToken: '' })).statusCode, 200);
  const burst = await Promise.all(Array.from({ length: 50 }, () => f.send(f.submit, form({ email: 'alexchen@gmail.com' }))));
  assert.ok(burst.every(res => res.statusCode === 409 && res.body.code === 'already_applied'));
  // Fifty unfinished attempts at once (two tabs, an impatient hand) still leave exactly one request.
  const g = site();
  await Promise.all(Array.from({ length: 50 }, () => g.send(g.submit, form({ email: 'race@example.com' }))));
  assert.equal(g.store.size(), 1);
});

test('an attempt that never got its résumé in, or whose file was refused, can be sent again', async () => {
  const f = site();
  const abandoned = await f.send(f.submit, form({ email: 'retry@example.com' }));
  assert.equal(abandoned.statusCode, 201);
  const second = await f.apply({ email: 'retry@example.com' });
  assert.equal(second.done.statusCode, 200);
  assert.equal((await f.store.list()).length, 1);
  const [row] = await f.store.list();
  await f.store.update(row.id, { state: 'file_rejected' });
  assert.equal((await f.apply({ email: 'retry@example.com' })).done.statusCode, 200);
  assert.equal((await f.store.list()).length, 1);
});

test('the status link opens one request and shows its stage, never the score or the note', async () => {
  const f = site();
  const { done } = await f.apply();
  const token = done.body.statusToken;
  assert.match(token, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
  const [row] = await f.store.list();
  assert.equal(readStatusToken(token, env), row.id);
  assert.equal(statusUrl(row.id, env), `https://www.yuqi.site/talk/status#${token}`);
  await f.store.update(row.id, { state: 'ready', screening: normalizeScreening(AI_NOTE, { resumeRead: true }), fit: 82, recommendation: 'strong', outcome: 'passed', owner_note: 'private' });
  const res = await f.send(f.status, { token });
  assert.equal(res.statusCode, 200); assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(Object.keys(res.body.status).sort(), ['company', 'receivedAt', 'reference', 'roles', 'stage', 'updatedAt']);
  assert.equal(res.body.status.stage, 'qualified');
  assert.equal(/score|strong|private|Northwind|alex@example|screening"/i.test(JSON.stringify(res.body)), false);
  // A changed token, another secret, another request's id, or no secret at all: the same 404.
  const flipped = token.replace(/\.(.)/, (_, first) => `.${first === 'A' ? 'B' : 'A'}`);
  for (const bad of [flipped, statusToken(row.id, { CRON_SECRET: 'other' }), statusToken(randomUUID(), env), '', 'x.y', null]) {
    assert.equal((await f.send(f.status, { token: bad })).statusCode, 404);
  }
  assert.equal(statusToken(row.id, {}), ''); assert.equal(readStatusToken(token, {}), null);
  assert.equal((await f.send(f.status, { token, ...{ } })).body.status.reference, row.reference);
  const stages = [[{ state: 'queued', status: 'new' }, 'screening'], [{ state: 'ready', status: 'new', outcome: 'review' }, 'review'], [{ state: 'ready', status: 'reviewing', outcome: 'passed' }, 'review'],
    [{ state: 'ready', status: 'referred' }, 'referred'], [{ state: 'ready', status: 'declined' }, 'not_selected'], [{ state: 'ready', status: 'archived' }, 'closed'], [{ state: 'file_rejected', status: 'new' }, 'file_problem']];
  for (const [state, stage] of stages) assert.equal(applicantStage(state), stage);
  assert.equal(publicStatus({ ...row, state: 'queued' }).stage, 'screening');
});

function workerFixture({ note, mailbox = true, limited = () => false, failOn = null, workerEnv = env } = {}) {
  const store = memoryReferralStore(), storage = memoryResumeStorage();
  const digests = [], sent = [];
  const screener = { enabled: () => true, screen: async () => structuredClone(typeof note === 'function' ? note() : note) };
  const passMailer = mailbox ? { enabled: () => true, send: async mail => { if (failOn?.(mail)) throw new Error('smtp'); sent.push(mail); } } : null;
  const worker = createReferralWorker({ store, storage, screener, passMailer, env: workerEnv, log: () => {}, sleep: async () => {},
    sendMail: async mail => { digests.push(mail); }, isRateLimited: async (...args) => limited(...args) });
  async function add(overrides = {}, bytes = pdf()) {
    const body = form(overrides); const id = randomUUID(); const path = resumePath(id);
    await store.accept({ id, ...referralRow({ key: body.idempotencyKey, reference: `R-${id.slice(0, 12).toUpperCase()}`, request: referralFields(body), resume: { filename: 'resume.pdf', size: bytes.length }, path, company: 'Goldman Sachs' }) });
    const ticket = await storage.createUpload(path); storage.put(new URL(ticket.url, 'http://x').searchParams.get('token'), bytes, 'application/pdf');
    await store.markUploaded(id, bytes.length);
    return id;
  }
  return { store, storage, worker, digests, sent, add };
}
const passing = () => normalizeScreening(AI_NOTE, { resumeRead: true });
const failing = () => normalizeScreening(weakNote(), { resumeRead: true });

test('a pass sends two emails at once from the no-reply mailbox: the owner is asked to refer, the applicant is told', async () => {
  const f = workerFixture({ note: passing });
  const id = await f.add();
  const summary = await f.worker.run();
  assert.deepEqual({ screened: summary.screened, announced: summary.announced, notified: summary.notified }, { screened: 1, announced: 1, notified: 0 });
  assert.equal(f.digests.length, 0, 'a pass has its own emails and is not repeated in the digest');
  const [owner, applicant] = f.sent;
  assert.match(owner.subject, /^Please refer: Alex Chen · Associate, Software Engineering \(Pass · 82\/100\)$/);
  assert.equal(owner.to, undefined, 'the owner copy goes to the configured inbox'); assert.equal(owner.replyTo, 'alex@example.com');
  assert.match(owner.text, /Their introduction, in their own words/);
  assert.equal(applicant.to, 'alex@example.com'); assert.match(applicant.subject, /passed screening/);
  assert.match(applicant.text, new RegExp(`https://www\\.yuqi\\.site/talk/status#${statusToken(id, env).replace('.', '\\.')}`));
  // The status link is random text, so it is left out of the check.
  const said = (applicant.text + applicant.html).replace(/talk\/status#\S+/g, '').replace(/R-[0-9A-F-]{12}/g, '');
  assert.equal(/82|score|\/100|open-source|Strengths/i.test(said), false, 'the applicant never sees the score or the note');
  const row = await f.store.get(id);
  assert.equal(row.outcome, 'passed'); assert.equal(row.status, 'new'); assert.ok(row.outcome_mail_at);
  await f.worker.run();
  assert.equal(f.sent.length, 2, 'the pair is sent once');
});

test('under the bar is declined automatically and the applicant gets one email from the no-reply mailbox', async () => {
  const f = workerFixture({ note: failing });
  const id = await f.add();
  const summary = await f.worker.run();
  assert.deepEqual({ declined: summary.declined, announced: summary.announced, notified: summary.notified }, { declined: 1, announced: 0, notified: 0 });
  const row = await f.store.get(id);
  assert.deepEqual({ status: row.status, outcome: row.outcome, auto: row.screening.auto.declined, below: row.screening.auto.below }, { status: 'declined', outcome: 'auto_declined', auto: true, below: 60 });
  assert.equal(f.digests.length, 0); assert.equal(f.sent.length, 1); assert.equal(summary.turnedDown, 1);
  const [mail] = f.sent;
  assert.equal(mail.to, 'alex@example.com'); assert.match(mail.text, /was not selected/); assert.match(mail.text, /talk\/status#/);
  assert.equal(/34|score|\/100|open-source|under the bar/i.test((mail.text + mail.html).replace(/talk\/status#\S+/g, '').replace(/R-[0-9A-F-]{12}/g, '')), false, 'no score and no reason');
  await f.worker.run();
  assert.equal(f.sent.length, 1, 'sent once');
  assert.equal(applicantStage(row), 'not_selected');
  // A request flagged as spam is declined without mail: its address may be someone else's.
  const spam = workerFixture({ note: () => normalizeScreening(weakNote({ flags: ['spam'] }), { resumeRead: true }) });
  const junk = await spam.add(); await spam.worker.run();
  assert.equal((await spam.store.get(junk)).status, 'declined'); assert.equal(spam.sent.length, 0);
  // Without the no-reply mailbox nobody is written to.
  const plain = workerFixture({ note: failing, mailbox: false });
  await plain.add(); await plain.worker.run();
  assert.equal(plain.sent.length + plain.digests.length, 0);
  // The file follows the usual rule for a closed request.
  await f.worker.run({ housekeeping: true });
  assert.equal((await f.store.get(id)).resume_path, null);
});

test('automatic decline can be switched off, never overrules the owner, and is undone when a re-screen passes', async () => {
  const off = workerFixture({ note: failing, workerEnv: { ...env, REFERRAL_AUTO_DECLINE_BELOW: '0' } });
  const kept = await off.add(); await off.worker.run();
  assert.equal((await off.store.get(kept)).status, 'new'); assert.equal(off.digests.length, 1, 'it reaches the owner in the digest instead');

  let current = failing;
  const f = workerFixture({ note: () => current() });
  const id = await f.add(); await f.worker.run();
  assert.equal((await f.store.get(id)).status, 'declined');
  current = passing;
  await f.store.update(id, { state: 'queued', attempts: 0 }); await f.worker.run();
  const row = await f.store.get(id);
  assert.deepEqual({ status: row.status, outcome: row.outcome, auto: row.screening.auto }, { status: 'new', outcome: 'passed', auto: undefined });
  assert.equal(f.sent.length, 3, 'the earlier decline, then the pair for the pass');
  await f.store.update(id, { state: 'queued', attempts: 0 }); await f.worker.run();
  assert.equal(f.sent.length, 3, 'the same outcome again is not mailed again');

  // The owner already moved it to "reviewing": a low score changes nothing.
  const g = workerFixture({ note: failing });
  const mine = await g.add(); await g.store.update(mine, { status: 'reviewing' }); await g.worker.run();
  assert.equal((await g.store.get(mine)).status, 'reviewing');
});

test('pass emails: nothing half-sent is repeated, a daily cap holds them back, and without a mailbox the digest carries the pass', async () => {
  let down = true;
  const f = workerFixture({ note: passing, failOn: () => down });
  const id = await f.add(); await f.worker.run();
  assert.equal(f.sent.length, 0); assert.equal((await f.store.get(id)).outcome_mail_at, null, 'nothing went out, so it is tried again');
  down = false; await f.worker.run();
  assert.equal(f.sent.length, 2);

  // The owner was asked but the applicant's copy failed: the owner is not asked a second time.
  const g = workerFixture({ note: passing, failOn: mail => Boolean(mail.to) });
  await g.add(); await g.worker.run(); await g.worker.run();
  assert.equal(g.sent.length, 1); assert.match(g.sent[0].subject, /^Please refer/);

  const capped = workerFixture({ note: passing, limited: (key, scope) => scope === 'referral-pass-mail' });
  await capped.add(); await capped.worker.run();
  assert.equal(capped.sent.length, 0);

  const plain = workerFixture({ note: passing, mailbox: false });
  await plain.add(); const summary = await plain.worker.run();
  assert.equal(summary.notified, 1); assert.equal(plain.digests.length, 1); assert.equal(plain.sent.length, 0);
});

test('the same résumé under another address is pointed out to the owner', async () => {
  const f = workerFixture({ note: passing });
  const first = await f.add({ email: 'one@example.com' }); await f.worker.run();
  const second = await f.add({ email: 'two@example.com' }); await f.worker.run();
  const reference = (await f.store.get(first)).reference;
  assert.equal((await f.store.get(second)).screening.concerns[0], `The same résumé file came with request ${reference}.`);
  assert.equal(inspectResume(pdf()).sha256, (await f.store.get(second)).resume_sha256);
});

test('the no-reply mailbox is never the owner\'s own address', () => {
  const base = { EMAIL_USER: 'yuqi@example.com', EMAIL_TO: 'inbox@example.com' };
  const box = noReplyMailbox({ ...base, REFERRAL_NOREPLY_SMTP_URL: 'smtps://no-reply%40mail.example:pw@smtp.mail.example:465', REFERRAL_NOREPLY_FROM: 'Referral desk <no-reply@mail.example>' });
  assert.equal(box.from, 'Referral desk <no-reply@mail.example>');
  for (const bad of [{}, { REFERRAL_NOREPLY_SMTP_URL: 'smtps://a:b@smtp.example' }, { REFERRAL_NOREPLY_FROM: 'no-reply@mail.example' },
    { REFERRAL_NOREPLY_SMTP_URL: 'https://smtp.example', REFERRAL_NOREPLY_FROM: 'no-reply@mail.example' },
    { REFERRAL_NOREPLY_SMTP_URL: 'smtps://x:pw@smtp.example', REFERRAL_NOREPLY_FROM: 'Yuqi <YUQI@example.com>' },
    { REFERRAL_NOREPLY_SMTP_URL: 'smtps://inbox%40example.com:pw@smtp.example', REFERRAL_NOREPLY_FROM: 'no-reply@mail.example' },
    { REFERRAL_NOREPLY_SMTP_URL: 'smtps://x:pw@smtp.example', REFERRAL_NOREPLY_FROM: 'not an address' }]) assert.equal(noReplyMailbox({ ...base, ...bad }), null);
  const mails = passMails({ id: randomUUID(), reference: 'R-TEST', name: 'Alex\r\nBcc: x@evil.test', email: 'alex@example.com', role_title: 'Engineer', company: 'Goldman Sachs', intro: 'Intro.', relationship: 'school',
    screening: passing() });
  assert.equal(/[\r\n]/.test(mails.applicant.subject + mails.owner.subject), false);
});

test('the owner can take a major-company pass away after opening the profile; the review list carries the applicant link', async () => {
  const store = memoryReferralStore(), kicks = [];
  const admin = createReferralAdminHandler({ authorize: async () => ({ userId: 'owner' }), store, storage: memoryResumeStorage(), availability: openFor(), kick: async () => { kicks.push(1); }, env });
  const id = randomUUID(); const body = form();
  await store.accept({ id, ...referralRow({ key: body.idempotencyKey, reference: 'R-BADGE', request: referralFields(body), resume: { filename: 'r.pdf', size: 10 }, path: resumePath(id), company: 'Goldman Sachs' }) });
  await store.markUploaded(id, 10);
  const screening = normalizeScreening({ ...AI_NOTE, assessment: { employer: strong(86, []), openSource: none(), contests: none() } }, { resumeRead: true, profileUrl: body.profileUrl });
  const [claimed] = await store.claimScreenings(1, 60);
  await store.finishScreening(claimed.id, { state: 'ready', screening, fit: screening.score, outcome: screeningOutcome(screening) });
  const list = response(); await admin({ method: 'GET', headers: {}, query: {} }, list);
  const row = list.body.requests[0];
  assert.equal(row.outcome, 'passed'); assert.equal(readStatusToken(row.status_token, env), id);
  const res = response();
  await admin({ method: 'POST', headers: {}, body: { id, action: 'linkedin_badge', confirmed: false, reviewNote: 'The profile shows a different employer.', expectedUpdatedAt: row.updated_at } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.outcome, 'review'); assert.equal(res.body.screening.passed, false); assert.equal(res.body.status, 'new');
});
