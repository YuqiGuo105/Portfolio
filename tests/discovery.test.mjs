import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chooseHome, referralSource, hybrid, recommend, safeQuery, suggestions, SECTION_ORDER } from '../src/lib/discovery/core.mjs';
import { catalogItem, plainText } from '../src/lib/discovery/catalog.mjs';
import { memoryStore } from '../src/lib/discovery/store.mjs';
import { createDiscoveryService } from '../src/lib/discovery/service.mjs';
import { consumeDiscoveryEvent } from '../src/lib/discovery/feedback.mjs';
import { createModerator, memoryReviews, reviewSubmission, moderationRules } from '../src/lib/discovery/moderation.mjs';
import { createDiscoveryProvider } from '../src/lib/discovery/provider.mjs';
import { createContactHandler } from '../src/lib/contactGuard.mjs';
import { createFlagsHandler } from '../src/lib/globeFlags.mjs';

const items = [
  catalogItem({ id: '11111111-1111-4111-8111-111111111111', title: 'Kafka delivery', content: '<p>At least once delivery with an outbox.</p>', technology: 'Kafka Java', image_url: 'https://example.com/cover.png' }, 'project'),
  catalogItem({ id: '22222222-2222-4222-8222-222222222222', title: 'Kafka retries', content: 'Kafka delivery and retries', tags: 'Kafka Java' }, 'blog'),
  catalogItem({ id: '33333333-3333-4333-8333-333333333333', title: 'Vector search', content: 'Semantic retrieval', tags: 'Search ML' }, 'blog'),
  catalogItem({ id: '44444444-4444-4444-8444-444444444444', title: 'Java architecture', content: 'Distributed systems', tags: 'Java' }, 'project'),
];
const loadCatalog = async () => ({ items, version: 'fixture-1' });
const vector = text => /kafka|delivery|outbox/i.test(text) ? [1, 0, 0] : [0, 1, 0];
function fixture() {
  const store = memoryStore();
  const calls = { embed: 0, rerank: 0 };
  const provider = { embed: async text => { calls.embed++; return vector(text); }, rerank: async (_q, rows) => { calls.rerank++; return [...rows].reverse(); } };
  return { store, provider, calls, loadCatalog, service: createDiscoveryService({ store, provider, loadCatalog }) };
}
const event = (fields = {}) => ({ eventId: `browser:${'a'.repeat(64)}`, siteId: 'yuqi.site', sessionId: 'session-1', consentState: 'granted', eventType: 'page_view', eventTime: new Date().toISOString(), pageUrl: items[0].url, ...fields });
const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });

test('source matching uses hostname boundaries, not identity claims', () => {
  assert.equal(referralSource('https://www.linkedin.com/feed'), 'linkedin');
  assert.equal(referralSource('https://linkedin.com.evil.test'), 'direct');
  assert.equal(referralSource('https://github.com/a'), 'github');
  assert.equal(referralSource('', 'github'), 'github');
  assert.equal(referralSource('bad-url'), 'direct');
});
test('home preserves hero and each section exactly once; source-aware cold start', () => {
  for (const list of Object.values(SECTION_ORDER)) { assert.equal(list[0], 'home-intro'); assert.equal(new Set(list).size, 5); }
  assert.equal(chooseHome('linkedin', {}, () => .5), 'career');
  assert.equal(chooseHome('github', {}, () => .5), 'engineering');
  assert.equal(chooseHome('direct', {}, () => .5), 'original');
});
test('bandit only changes winner after every arm has sufficient evidence', () => {
  const home = { 'github:original': { views: 30, clicks: 25 }, 'github:career': { views: 30, clicks: 4 }, 'github:engineering': { views: 29, clicks: 2 } };
  assert.equal(chooseHome('github', home, () => .5), 'engineering');
  home['github:engineering'].views = 30;
  assert.equal(chooseHome('github', home, () => .5), 'original');
});
test('catalog removes HTML, entities and scripts; no unsafe cover URL', () => {
  assert.equal(plainText('<p>Hi&nbsp;there</p><script>secret</script>'), 'Hi there');
  assert.equal(catalogItem({ ...items[0], id: items[0].contentId, image_url: 'javascript:alert(1)' }, 'project').image, null);
});
test('hybrid retrieval merges lexical and semantic routes without duplicates', () => {
  const result = hybrid('outbox', items, Object.fromEntries(items.map(item => [item.id, vector(item.text)])), [1, 0, 0]);
  assert.equal(result[0].id, items[0].id); assert.equal(new Set(result.map(item => item.id)).size, result.length);
});
test('recommendation excludes current item and requires repeated co-visits', () => {
  const rows = recommend(items[0], items, {}, { [[items[0].id, items[2].id].sort().join('|')]: 2 });
  assert.equal(rows.length, 3); assert.ok(rows.every(row => row.id !== items[0].id)); assert.ok(rows.every(row => row.reason !== 'Also explored'));
});
test('query suggestions suppress personal text and rare queries', () => {
  assert.equal(safeQuery('user@example.com', items), null); assert.equal(safeQuery('call 12345678', items), null); assert.equal(safeQuery('private question', items), null);
  assert.equal(safeQuery('Kafka Java', items), 'kafka java');
  assert.ok(!suggestions('ka', items, { 'kafka java': 4 }).some(row => row.kind === 'query'));
  assert.equal(suggestions('ka', items, { 'kafka java': 5 })[0].text, 'kafka java');
});
test('cache rebuild embeds changed content only and typeahead never calls AI', async () => {
  const f = fixture();
  await f.service.rebuild(); await f.service.rebuild(); await f.service.suggest('ka');
  assert.equal(f.calls.embed, 4); assert.equal(f.calls.rerank, 0);
});
test('each rebuild limits paid attempts and continues from cached vectors', async () => {
  const f = fixture();
  const first = await f.service.rebuild({ maxNewEmbeddings: 2 });
  assert.equal(first.embedded, 2); assert.equal(first.deferred, 2);
  const next = await f.service.rebuild({ maxNewEmbeddings: 2 });
  assert.equal(next.vectors, 4); assert.equal(next.deferred, 0); assert.equal(f.calls.embed, 4);
  const broken = fixture(); broken.provider.embed = async () => { broken.calls.embed++; throw Error('quota'); };
  assert.equal((await broken.service.rebuild({ maxNewEmbeddings: 1 })).unavailable, 1);
  assert.equal(broken.calls.embed, 1);
});
test('All search retains legacy metadata without embedding or reranking it', async () => {
  const f = fixture(), extra = { id: 'Resume:education', title: 'Education', source: 'Resume' };
  const service = createDiscoveryService({ ...f, secondarySearch: async () => [extra] });
  assert.ok((await service.search('Kafka')).results.some(item => item.id === extra.id));
  assert.ok(!(await service.search('Kafka', 'project')).results.some(item => item.id === extra.id));
  assert.equal(f.calls.embed, 0);
});
test('semantic search and recommendations cache results, mint new feedback ids', async () => {
  const f = fixture(); await f.service.rebuild();
  const a = await f.service.search('Kafka', '', true), b = await f.service.search('Kafka', '', true);
  assert.equal(f.calls.embed, 5); assert.equal(f.calls.rerank, 1); assert.deepEqual(a.results, b.results); assert.notEqual(a.requestId, b.requestId);
  const related = await f.service.recommendations(items[0].id); assert.equal(related.items.length, 3); assert.ok(related.items.every(item => !('text' in item)));
});
test('revoked content cannot be returned by stale recommendation cache', async () => {
  const f = fixture(); await f.service.rebuild();
  const service = createDiscoveryService({ ...f, loadCatalog: async () => ({ items: items.slice(0, 2), version: 'fixture-1' }) });
  const result = await service.recommendations(items[0].id);
  assert.ok(result.items.every(item => item.id === items[1].id));
});
test('external API failures retain keyword results', async () => {
  const f = fixture(); await f.service.rebuild(); f.provider.embed = async () => { throw Error('quota'); }; f.provider.rerank = f.provider.embed;
  const result = await f.service.search('Kafka', '', true); assert.ok(result.results.length >= 2); assert.equal(result.modelVersion, 'discovery-v1:keyword');
});
test('Kafka retries count a pair once per session and day', async () => {
  const f = fixture(), a = event(), b = event({ eventId: randomUUID(), pageUrl: items[1].url });
  await consumeDiscoveryEvent(a, f); await consumeDiscoveryEvent(b, f); await consumeDiscoveryEvent(b, f);
  assert.deepEqual(Object.values((await f.service.stats()).pairs), [1]);
});
test('late events do not erase newer daily deduplication receipts', async () => {
  const f = fixture(), now = Date.parse('2026-11-12T01:00:00Z');
  const args = { ...f, now: () => now };
  const p = { experimentId: 'home-v1', campaign: 'github', variant: 'engineering' };
  for (const time of ['2026-11-12T00:30:00Z', '2026-11-11T23:30:00Z', '2026-11-12T00:45:00Z']) {
    await consumeDiscoveryEvent(event({ eventId: randomUUID(), eventType: 'content_impression', eventTime: time, properties: p }), args);
  }
  assert.equal((await f.service.stats()).home['github:engineering'].views, 2);
});
test('learning stops at capacity without discarding live idempotency receipts', async () => {
  const f = fixture(), now = Date.now();
  const receipts = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`event-${i}`, now]));
  await f.store.set('stats', { windowStart: now, receipts, home: {}, pairs: {}, queries: {}, metrics: {}, sessions: {}, days: {} });
  await consumeDiscoveryEvent(event(), f);
  const state = await f.store.get('stats');
  assert.equal(state.learningPaused, true); assert.equal(Object.keys(state.receipts).length, 20000); assert.ok(state.receipts['event-0']);
});
test('request-facing learning state omits receipts and sessions, and retries repair projection writes', async () => {
  const f = fixture(), original = f.store.update; let fail = true;
  f.store.update = async (key, ...args) => { if (key === 'learning-public' && fail) { fail = false; throw Error('interrupted'); } return original(key, ...args); };
  const e = event(); await assert.rejects(consumeDiscoveryEvent(e, f));
  await consumeDiscoveryEvent(e, f);
  const publicState = await f.service.stats();
  assert.ok(!('receipts' in publicState)); assert.ok(!('sessions' in publicState));
  assert.equal(Object.keys((await f.store.get('stats')).receipts).length, 1);
});
test('denied consent, crawlers and server-verified bots do not train ranking', async () => {
  const f = fixture();
  for (const fields of [{ consentState: 'denied' }, { uaRaw: 'Googlebot' }, { properties: { botAssessmentVerifiedBot: true } }, { properties: { botAssessmentHumanScore: .1 } }]) assert.equal(await consumeDiscoveryEvent(event(fields), f), false);
});
test('click metrics validate issued result ids and count once', async () => {
  const f = fixture(); const result = await f.service.search('Kafka');
  const p = { recommendationRequestId: result.requestId, contentId: result.results[0].id };
  await consumeDiscoveryEvent(event({ eventType: 'search_performed', properties: p }), f);
  await consumeDiscoveryEvent(event({ eventId: randomUUID(), eventType: 'search_result_clicked', properties: { ...p, contentId: 'forged' } }), f);
  const click = event({ eventId: randomUUID(), eventType: 'search_result_clicked', properties: p });
  await consumeDiscoveryEvent(click, f); await consumeDiscoveryEvent(click, f);
  assert.equal((await f.service.stats()).metrics.searchClicks, 1); assert.equal((await f.service.stats()).metrics.clickedReciprocalRank, 1);
});
test('normal job links and phone numbers are not blanket rejected', () => {
  assert.equal(moderationRules('contact', 'Please discuss the role https://company.example/jobs at +1 222 333 4444'), null);
  assert.equal(moderationRules('contact', 'a'.repeat(40)).decision, 'reject');
});
test('moderation service redacts contact data and caches the classification', async () => {
  let calls = 0;
  const moderate = createModerator({ store: memoryStore(), reviews: memoryReviews(), provider: { moderate: async (_channel, text) => {
    calls++; assert.ok(!text.includes('test@example.com')); return { decision: 'allow', category: 'clean', risk: 0 };
  } } });
  assert.equal((await moderate('contact', 'Reach test@example.com')).decision, 'allow');
  await moderate('contact', 'Reach test@example.com'); assert.equal(calls, 1);
});
test('moderation outage holds contact/chat, keeps globe private, and deduplicates queue records', async () => {
  const reviews = memoryReviews(), moderate = createModerator({ store: memoryStore(), reviews, provider: { moderate: async () => { throw Error('outage'); } } });
  const a = await moderate('contact', 'Hello'), b = await moderate('contact', 'Hello');
  assert.equal(a.decision, 'review'); assert.equal(a.reviewId, b.reviewId);
  assert.equal((await moderate('globe', 'Hello')).decision, 'review'); assert.equal((await reviews.list()).length, 1);
});
test('review approval is atomic and never sends a second email', async () => {
  const reviews = memoryReviews(); const row = await reviews.enqueue({ id: randomUUID(), fingerprint: 'x', channel: 'contact', status: 'pending', text: 'hello', context: {}, created_at: new Date().toISOString() });
  let mails = 0;
  const input = { reviews, id: row.id, action: 'approve', actor: 'admin', sendMail: async () => { mails++; } };
  await Promise.all([reviewSubmission(input), reviewSubmission(input)]); assert.equal(mails, 1); assert.equal((await reviews.list())[0].status, 'sent');
});
test('unknown mail delivery is not retried automatically; chat approval never runs tools', async () => {
  const reviews = memoryReviews(); const row = await reviews.enqueue({ id: randomUUID(), fingerprint: 'x', channel: 'contact', status: 'pending', text: 'hello', context: {}, created_at: new Date().toISOString() });
  const result = await reviewSubmission({ reviews, id: row.id, action: 'approve', actor: 'admin', sendMail: async () => { throw Error('timeout'); } });
  assert.equal(result.status, 'delivery_unknown');
  const chat = await reviews.enqueue({ ...row, id: randomUUID(), fingerprint: 'chat', channel: 'chat', status: 'pending' });
  await reviewSubmission({ reviews, id: chat.id, action: 'approve', actor: 'admin', sendMail: async () => { assert.fail('No replay'); } });
});
test('review rows disappear at 30 days in local preview', async () => {
  let now = Date.now(); const reviews = memoryReviews(() => now); await reviews.enqueue({ id: '1', fingerprint: '1' });
  now += 31 * 86400000; assert.equal((await reviews.list()).length, 0);
});
test('provider budget denial happens before network access', async () => {
  let calls = 0;
  const provider = createDiscoveryProvider({ env: { DISCOVERY_AI_ENABLED: '1', DISCOVERY_GOOGLE_API_KEY: 'test' }, spend: { reserve: async () => { throw Error('denied'); } }, fetchImpl: async () => { calls++; } });
  await assert.rejects(provider.moderate('contact', 'Hello')); assert.equal(calls, 0);
});
test('provider uses header credentials, bounded output, and rejects invented ranking ids', async () => {
  let settled;
  const provider = createDiscoveryProvider({ env: { DISCOVERY_AI_ENABLED: '1', DISCOVERY_GOOGLE_API_KEY: 'secret' }, spend: { reserve: async () => ({ settle: async value => { settled = value; } }) }, fetchImpl: async (url, options) => {
    assert.ok(!url.includes('secret')); assert.equal(options.headers['x-goog-api-key'], 'secret');
    assert.equal(JSON.parse(options.body).generationConfig.thinkingConfig.thinkingBudget, 0);
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ids":["invented"]}' }] } }], usageMetadata: { promptTokenCount: 10, totalTokenCount: 20 } }) };
  } });
  await assert.rejects(provider.rerank('Kafka', items)); assert.equal(typeof settled, 'number');
});
test('contact moderation runs after authenticated MCP identity and holds mail', async () => {
  let sent = 0, moderated = 0;
  const handler = createContactHandler({ env: { CONTACT_MCP_TOKEN: 'x'.repeat(32) }, isRateLimited: async () => false, sendMail: async () => sent++, moderate: async () => { moderated++; return { decision: 'review' }; }, audit: () => {} });
  const req = { method: 'POST', headers: { 'content-type': 'application/json', 'x-portfolio-contact-token': 'x'.repeat(32) }, body: { email: 'a@b.test', message: 'hello' } }, res = response();
  await handler(req, res); assert.equal(res.statusCode, 202); assert.equal(sent, 0); assert.equal(moderated, 1);
  req.headers['x-portfolio-contact-token'] = 'wrong'; await handler(req, response()); assert.equal(moderated, 1);
});
test('globe allows clean notes but queues uncertain notes', async () => {
  for (const decision of ['allow', 'review']) {
    let saved;
    const handler = createFlagsHandler({ store: () => ({ insert: async row => { saved = row; return { ...row, id: randomUUID() }; } }), isRateLimited: async () => false, moderate: async () => ({ decision }), geoOf: () => null });
    const req = { method: 'POST', headers: { origin: 'https://www.yuqi.site', host: 'www.yuqi.site', 'content-type': 'application/json' }, body: { emoji: '🚀', message: 'Nice work', lat: 10, lng: 20 }, socket: { remoteAddress: '127.0.0.1' } };
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 201); assert.equal(saved.status, decision === 'allow' ? 'approved' : 'pending');
  }
});
