import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyVisitorSample, diagnosticThresholds, scoreVisitorSample } from '../src/lib/visitorBotDiagnostics.mjs';
import { diagnosticPreviewEvents } from '../src/lib/visitorBotDiagnosticsPreview.mjs';

const now = Date.parse('2026-11-20T17:00:00Z');
const fixtures = () => diagnosticPreviewEvents(now);
const verdicts = (events, thresholds) => classifyVisitorSample(scoreVisitorSample(events), thresholds);
const find = (result, name) => result.sessions.find(session => session.sessionId === name);

test('independent behavior signals score sampled sessions and thresholds only change the preview', () => {
  const events = fixtures(), original = JSON.stringify(events);
  for (const event of events) { Object.freeze(event.properties); Object.freeze(event); }
  Object.freeze(events);
  const result = verdicts(events);
  assert.equal(find(result, 'sample-concurrent-1').score, 90);
  assert.equal(find(result, 'sample-concurrent-1').verdict, 'high');
  assert.equal(find(result, 'sample-repeated-1').score, 60);
  assert.equal(find(result, 'sample-repeated-1').verdict, 'suspected');
  assert.equal(result.counts.candidates, 18);
  assert.equal(result.counts.additional, 18);
  assert.equal(result.counts.stored, 0);
  const strict = verdicts(events, { suspected: 70, high: 95 });
  assert.equal(strict.counts.high, 0);
  assert.equal(strict.counts.suspected, 3);
  assert.equal(strict.counts.candidates, 12);
  assert.equal(JSON.stringify(events), original);
});

test('a lone fast-reading signal stays undetermined even at the lowest threshold', () => {
  const result = verdicts(fixtures(), { suspected: 1, high: 2 });
  const fast = find(result, 'sample-fast-only');
  assert.equal(fast.score, 30);
  assert.equal(fast.eligible, false);
  assert.equal(fast.verdict, 'undetermined');
  assert.equal(find(result, 'sample-ordinary').score, 0);
});

test('saved bot flags are preserved in the union and are not evidence by themselves', () => {
  const events = fixtures();
  events[0].bot = true;
  events.at(-1).bot = true;
  const result = verdicts(events);
  assert.equal(result.counts.stored, 2);
  assert.equal(result.counts.additional, 17);
  assert.equal(result.counts.combined, 19);
  assert.equal(find(result, 'sample-ordinary').verdict, 'undetermined');
});

test('delivery retries cannot create behavior evidence; event ID is namespaced by site', () => {
  const one = fixtures()[0];
  const sample = scoreVisitorSample([one, { ...one }, { ...one }, { ...one, siteId: 'other' }]);
  assert.equal(sample.eventCount, 2);
  assert.equal(sample.duplicates, 2);
  assert.equal(sample.sessions.length, 2);
  assert.ok(sample.sessions.every(session => session.score === 0));
});

test('same-session repeated page views are not multiple concurrent sessions', () => {
  const events = fixtures().filter(event => event.sessionId.startsWith('sample-repeated')).map(event => ({ ...event, sessionId: 'one-session' }));
  assert.equal(verdicts(events).counts.candidates, 0);
});

test('concurrency requires server receipt times, actual session IDs, IP and matching site/path', () => {
  const events = fixtures().filter(event => event.sessionId.startsWith('sample-repeated'));
  for (const field of ['serverTime', 'sessionId', 'ipAddress', 'pageUrl']) {
    const result = verdicts(events.map(event => ({ ...event, [field]: '' })));
    assert.equal(result.counts.candidates, 0, field);
    assert.ok(result.sessions.every(session => !session.reasons.some(reason => reason.id === 'burst')));
  }
  const separateSites = events.map(event => ({ ...event, siteId: event.sessionId }));
  assert.equal(verdicts(separateSites).counts.candidates, 0);
  const separatePaths = events.map(event => ({ ...event, pageUrl: `/${event.sessionId}${event.pageUrl}` }));
  assert.equal(verdicts(separatePaths).counts.candidates, 0);
});

test('subsecond server bursts alone are insufficient; no signal from delayed bursts', () => {
  const views = fixtures().filter(event => event.sessionId.startsWith('sample-concurrent') && event.pageUrl === '/mcp-guide' && event.eventName === 'page_view');
  assert.ok(verdicts(views, { suspected: 1, high: 2 }).sessions.every(session => session.score === 35 && session.verdict === 'undetermined'));
  const delayed = views.map((event, index) => ({ ...event, serverTime: new Date(now + index * 10000).toISOString() }));
  assert.ok(verdicts(delayed).sessions.every(session => session.score === 0));
});

test('short pages, missing first views, negative or contradictory timing do not create fast-reading evidence', () => {
  const fast = fixtures().filter(event => event.sessionId === 'sample-fast-only');
  const cases = [fast.filter(event => event.properties.progressPercent !== 25), fast.filter(event => event.eventName !== 'page_view'),
    fast.map(event => event.properties.progressPercent === 100 ? { ...event, eventTime: fast[0].eventTime } : event),
    fast.map(event => event.properties.progressPercent === 100 ? { ...event, serverTime: new Date(now + 10000).toISOString() } : event),
    fast.map(event => ({ ...event, eventTime: 'not a date' }))];
  for (const events of cases) assert.equal(verdicts(events).sessions[0].score, 0);
});

test('missing CAPTCHA, direct referrer, city and hosting hints contribute zero points', () => {
  const event = { ...fixtures()[0], city: 'Boydton', referrer: '', properties: { asn: 'AS8075', hosting: true, botAssessmentStatus: 'MISSING_TOKEN' } };
  assert.equal(verdicts([event]).sessions[0].score, 0);
  assert.equal(scoreVisitorSample([event]).missingAssessment, 1);
});

test('only valid recorded provider assessments are scored and malformed numeric values are ignored', () => {
  const base = fixtures()[0], properties = { botAssessmentProvider: 'GOOGLE_RECAPTCHA_ENTERPRISE', botAssessmentStatus: 'VALID', botAssessmentHumanScore: 0.1 };
  const result = verdicts([{ ...base, properties }]);
  assert.equal(result.sessions[0].verdict, 'high');
  assert.equal(result.sessions[0].score, 90);
  for (const bad of [null, '', '0', -1, 2, NaN]) assert.equal(verdicts([{ ...base, properties: { ...properties, botAssessmentHumanScore: bad } }]).sessions[0].score, 0);
  for (const changed of [{ botAssessmentStatus: 'TIMEOUT' }, { botAssessmentProvider: 'client' }]) {
    assert.equal(verdicts([{ ...base, properties: { ...properties, ...changed } }]).sessions[0].score, 0);
  }
  assert.equal(verdicts([{ ...base, userAgent: 'Googlebot/2.1', properties: { ...properties, botAssessmentHumanScore: 0.9 } }]).sessions[0].score, 90);
});

test('all input is bounded, grouped rows are rejected and missing sessions cannot be merged', () => {
  const one = fixtures()[0];
  const sample = scoreVisitorSample([null, { ...one, visit: { eventCount: 4 } }, { ...one, eventId: 'missing-a', sessionId: null }, { ...one, eventId: 'missing-b', sessionId: null }]);
  assert.equal(sample.invalid, 1); assert.equal(sample.grouped, 1); assert.equal(sample.missingSession, 2);
  assert.equal(sample.sessions.length, 2);
  const bounded = scoreVisitorSample(Array.from({ length: 200 }, (_, i) => ({ ...one, eventId: String(i) })));
  assert.equal(bounded.eventCount, 100); assert.equal(bounded.truncated, true);
  assert.equal(scoreVisitorSample(null).eventCount, 0);
});

test('threshold normalization keeps values finite, bounded and strictly ordered', () => {
  assert.deepEqual(diagnosticThresholds({ suspected: 90, high: 20 }), { suspected: 90, high: 91 });
  assert.deepEqual(diagnosticThresholds({ suspected: -10, high: 999 }), { suspected: 1, high: 100 });
  assert.deepEqual(diagnosticThresholds({ suspected: NaN, high: Infinity }), { suspected: 50, high: 80 });
});
