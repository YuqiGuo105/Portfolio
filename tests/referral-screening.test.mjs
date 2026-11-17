import test from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_RATE, MAX_PDF_PROMPT_TOKENS, OUTPUT_RATE, createReferralAi, normalizeScreening, rulesScreening } from '../src/lib/referral/screening.mjs';
import { referralFields } from '../src/lib/referral/fields.mjs';
import { inspectResume } from '../src/lib/referral/resume.mjs';
import { quoteRequest } from '../services/voice/modelGateway.mjs';
import { TEXT_MODEL } from '../src/lib/discovery/provider.mjs';
import { SpendDenied } from '../src/lib/voice/spendGuard.mjs';
import { ADDITIONAL_ROLES, AI_NOTE, form, pdf } from './referral-fixtures.mjs';

// As the worker passes it: the form's fields plus the company stored with the request.
const request = { ...referralFields(form()), company: 'Goldman Sachs' };
const resume = inspectResume(pdf());
const env = { REFERRAL_AI_ENABLED: '1', GEMINI_API_KEY: 'test-key' };
const answer = (value, usage = { promptTokenCount: 1500, totalTokenCount: 1800 }) => Response.json({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: usage });

function fixture({ count = 1400, reply = () => answer(AI_NOTE), deny = null, enabled = env } = {}) {
  const calls = [], ledger = [];
  const spend = { async reserve(provider, operation, micros) {
    if (deny) throw new SpendDenied(deny);
    const entry = { provider, operation, micros, settled: undefined }; ledger.push(entry);
    return { settle: async actual => { entry.settled = actual; } };
  } };
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, key: options.headers['x-goog-api-key'], redirect: options.redirect });
    if (url.endsWith(':countTokens')) return count === 'fail' ? new Response('no', { status: 500 }) : Response.json({ totalTokens: count });
    return reply(body);
  };
  const logs = [];
  return { ai: createReferralAi({ env: enabled, fetchImpl, spend, log: message => logs.push(message) }), calls, ledger, logs };
}

test('the rates used for the résumé quote match the shared model gateway', () => {
  const quote = quoteRequest(TEXT_MODEL, 'generateContent', { contents: [{ role: 'user', parts: [{ text: 'x' }] }],
    generationConfig: { maxOutputTokens: 10, thinkingConfig: { thinkingBudget: 0 } } });
  assert.equal(quote.provider, 'google'); assert.equal(quote.inputRate, INPUT_RATE); assert.equal(quote.outputRate, OUTPUT_RATE);
});

test('screening is off unless it is switched on and has a key', async () => {
  for (const off of [{}, { REFERRAL_AI_ENABLED: '1' }, { GEMINI_API_KEY: 'k' }, { REFERRAL_AI_ENABLED: 'true', GEMINI_API_KEY: 'k' }]) {
    const f = fixture({ enabled: off });
    const note = await f.ai.screen(request, resume);
    assert.equal(note.source, 'rules'); assert.equal(note.fit, null); assert.equal(f.calls.length, 0); assert.equal(f.ledger.length, 0);
  }
});

test('three openings share one model call and one budget reservation', async () => {
  const f = fixture();
  const note = await f.ai.screen({ ...request, additionalRoles: ADDITIONAL_ROLES }, resume);
  const generated = f.calls.filter(call => call.url.endsWith(':generateContent'));
  assert.equal(generated.length, 1); assert.equal(f.ledger.length, 1); assert.equal(note.source, 'ai');
  const payload = JSON.parse(generated[0].body.contents[0].parts.find(part => part.text).text);
  assert.equal(payload.roles.length, 3);
  assert.equal(payload.roles[2].role, 'Data Engineer');
  assert.equal(payload.roles[1].pastedRequirements, ADDITIONAL_ROLES[0].requirements);
});

test('the résumé is sized for free, reserved in the ledger, then read once', async () => {
  const f = fixture();
  const note = await f.ai.screen(request, resume);
  assert.deepEqual(f.calls.map(call => call.url.split(':').pop()), ['countTokens', 'generateContent']);
  assert.ok(f.calls.every(call => call.key === 'test-key' && call.redirect === 'error' && call.url.includes(TEXT_MODEL)));
  const [pdfPart, textPart] = f.calls[1].body.contents[0].parts;
  assert.equal(pdfPart.inlineData.mimeType, 'application/pdf');
  assert.equal(Buffer.from(pdfPart.inlineData.data, 'base64').equals(resume.bytes), true);
  const sent = JSON.parse(textPart.text);
  assert.equal(sent.applicantName, 'Alex Chen'); assert.equal(sent.company, 'Goldman Sachs');
  // Contact details are not needed to judge fit and are not sent to the model.
  assert.equal(JSON.stringify(sent).includes('alex@example.com'), false); assert.equal(JSON.stringify(sent).includes('linkedin.com'), false);
  assert.equal(f.calls[1].body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.match(f.calls[1].body.systemInstruction.parts[0].text, /untrusted data/);
  assert.match(f.calls[1].body.systemInstruction.parts[0].text, /Never use or infer age, gender/);
  // Reserved before the paid call, from the counted tokens; settled with the provider's own usage.
  assert.equal(f.ledger.length, 1); assert.equal(f.ledger[0].provider, 'google'); assert.equal(f.ledger[0].operation, 'referral:screen');
  assert.ok(f.ledger[0].micros >= 1400 * INPUT_RATE && f.ledger[0].micros < 4000);
  assert.equal(f.ledger[0].settled, Math.ceil(1500 * INPUT_RATE + 300 * OUTPUT_RATE));
  assert.deepEqual({ source: note.source, model: note.model, resumeRead: note.resumeRead, recommendation: note.recommendation, fit: note.fit, consistency: note.consistency },
    { source: 'ai', model: TEXT_MODEL, resumeRead: true, recommendation: 'strong', fit: 82, consistency: 'consistent' });
});

test('a file too large in tokens, or one that cannot be sized, is never sent to the model', async () => {
  for (const count of [MAX_PDF_PROMPT_TOKENS + 1, 'fail']) {
    const f = fixture({ count });
    const note = await f.ai.screen(request, resume);
    const generate = f.calls.filter(call => call.url.endsWith(':generateContent'));
    assert.equal(generate.length, 1);
    assert.equal(generate[0].body.contents[0].parts.some(part => part.inlineData), false);
    assert.equal(note.resumeRead, false); assert.equal(note.consistency, 'not_checked');
    assert.match(note.concerns[0], /only the form answers were screened/);
  }
});

test('a refused reservation means no paid call and a plain completeness note', async () => {
  const f = fixture({ deny: 'monthly_limit' });
  const note = await f.ai.screen(request, resume);
  assert.equal(f.calls.filter(call => call.url.endsWith(':generateContent')).length, 0);
  assert.equal(note.source, 'rules'); assert.match(note.summary, /monthly AI budget is used up/); assert.match(f.logs[0], /spend monthly_limit/);
});

for (const [label, reply] of [
  ['an error status', () => new Response('unavailable', { status: 503 })],
  ['a truncated answer', () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] })],
  ['a missing evidence path', () => answer({ ...AI_NOTE, assessment: { employer: AI_NOTE.assessment.employer } })],
  ['an out-of-range score', () => answer({ ...AI_NOTE, assessment: { ...AI_NOTE.assessment, openSource: { ...AI_NOTE.assessment.openSource, score: 140 } } })],
  ['text that is not JSON', () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Sure! Here you go' }] } }] })],
]) test(`${label} falls back to the completeness note and still settles the reservation`, async () => {
  const f = fixture({ reply });
  const note = await f.ai.screen(request, resume);
  assert.equal(note.source, 'rules'); assert.equal(note.fit, null);
  assert.equal(f.ledger.length, 1); assert.notEqual(f.ledger[0].settled, undefined);
});

test('usage the provider does not report keeps the full reservation', async () => {
  const f = fixture({ reply: () => answer(AI_NOTE, null) });
  await f.ai.screen(request, resume);
  assert.equal(f.ledger[0].settled, null);
});

test('a note is cleaned before anyone sees it', () => {
  const note = normalizeScreening({ ...AI_NOTE, summary: `  spaced\n\nout  ${'x'.repeat(900)}`, strengths: ['a', '', 7, 'b', 'c', 'd', 'e'],
    flags: ['injection', 'made-up', 'injection'], consistency: 'conflicts', pasteReady: 'rewritten by the model' }, { resumeRead: true });
  assert.equal(note.summary.length, 600); assert.equal(note.summary.startsWith('spaced out'), true);
  assert.deepEqual(note.strengths, ['a', 'b', 'c', 'd']); assert.deepEqual(note.flags, ['injection']);
  // The model's note never carries a rewritten introduction, even if the model returns one.
  assert.equal('pasteReady' in note, false);
  // Text that tried to steer the model is never presented as a strong match.
  assert.equal(note.recommendation, 'unclear');
  assert.equal(normalizeScreening({ ...AI_NOTE, flags: ['incomplete'] }, { resumeRead: true }).recommendation, 'strong');
  assert.equal(normalizeScreening({ ...AI_NOTE, consistency: 'consistent' }, { resumeRead: false }).consistency, 'not_checked');
  for (const bad of [null, {}, { ...AI_NOTE, summary: '' }, { ...AI_NOTE, assessment: { ...AI_NOTE.assessment, openSource: { ...AI_NOTE.assessment.openSource, score: 71.5 } } }]) assert.throws(() => normalizeScreening(bad, { resumeRead: true }));
});

test('the completeness note names what was provided and never scores fit', () => {
  const thin = rulesScreening(referralFields(form({ requirements: '', jobId: '', profileUrl: '', whyRole: '', relationship: 'not_yet' })));
  assert.equal(thin.fit, null); assert.equal(thin.recommendation, 'unclear'); assert.deepEqual(thin.flags, ['incomplete']);
  assert.equal(thin.strengths.length, 0); assert.equal(thin.concerns.length, 4);
  const full = rulesScreening(request);
  assert.equal(full.concerns.length, 0); assert.deepEqual(full.flags, []); assert.match(full.summary, /No evidence score or pass decision/);
});

test('the model is asked to assess, never to write the introduction', async () => {
  const f = fixture();
  await f.ai.screen(request, resume);
  const sent = f.calls[1].body;
  assert.equal('pasteReady' in sent.generationConfig.responseSchema.properties, false);
  assert.equal(/rewrite|paste-ready|pasteReady|third-person prose/i.test(sent.systemInstruction.parts[0].text), false);
  assert.equal(typeof f.ai.assist, 'undefined');
});

test('a request over the daily allowance gets the completeness note without any call', async () => {
  const f = fixture();
  const note = await f.ai.screen(request, resume, { skipAi: 'daily_cap' });
  assert.equal(note.source, 'rules'); assert.match(note.summary, /today's AI screening allowance is used up/);
  assert.equal(f.calls.length, 0); assert.equal(f.ledger.length, 0);
});

test('the model cannot set the final score or confirm a LinkedIn badge', () => {
  const note = normalizeScreening({ ...AI_NOTE, fit: 100, score: 100, passed: true, recommendation: 'strong',
    linkedinBadge: { confirmed: true, checkedBy: 'model', checkedAt: new Date().toISOString() },
    assessment: { ...AI_NOTE.assessment, openSource: { ...AI_NOTE.assessment.openSource, score: 40, meetsBar: false } } }, { resumeRead: true });
  assert.equal(note.score, 40); assert.equal(note.passed, false); assert.equal(note.linkedinBadge, null);
});

test('the rubric rejects padding and asks for substantive evidence rather than job matching', async () => {
  const f = fixture(); await f.ai.screen(request, resume);
  const instruction = f.calls[1].body.systemInstruction.parts[0].text;
  for (const phrase of ['NOT job-description matching', 'official LinkedIn verification badge', 'typo-only', 'Stars and merged PRs are supporting evidence', 'Solved-problem counts', 'never add weak paths together']) assert.ok(instruction.includes(phrase));
  assert.equal(f.calls[1].body.generationConfig.maxOutputTokens, 1600);
  const blocked = normalizeScreening({ ...AI_NOTE, consistency: 'conflicts' }, { resumeRead: true });
  assert.equal(blocked.passed, false); assert.equal(blocked.score, 59);
});
