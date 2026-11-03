import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BADGE_HEADERS,
  COUNT_CACHE_MS,
  GITHUB_PROFILE_URL,
  GITHUB_PROFILE_VIEW_EVENT,
  RECORD_TIMEOUT_MS,
  createGithubBadgeHandler,
  fallbackVisitorLog,
  formatCount,
  githubProfileContent,
  githubProfileViewEvent,
  isGithubCamo,
  isGithubProfileView,
  renderViewBadge,
  sumEventCounts,
  textWidth,
} from '../src/lib/githubProfileBadge.mjs';

const CAMO = 'github-camo (876de43e)';
const camoRequest = (headers = {}) => ({ method: 'GET', headers: { 'user-agent': CAMO, 'x-forwarded-for': '140.82.115.1', ...headers } });
const silent = { warn() {} };

function harness(overrides = {}) {
  const produced = [];
  const fallbacks = [];
  let ids = 0;
  let total = overrides.total ?? 41;
  let reads = 0;
  let time = 0;
  const deps = {
    produce: async (event) => { produced.push(event); return true; },
    fallbackInsert: async (row) => { fallbacks.push(row); return { ok: true }; },
    loadCount: async () => { reads += 1; return total; },
    newEventId: () => `evt-${++ids}`,
    now: () => new Date('2026-11-02T12:00:00.000Z'),
    clock: () => time,
    log: silent,
    ...overrides.deps,
  };
  return {
    handle: createGithubBadgeHandler(deps),
    produced,
    fallbacks,
    reads: () => reads,
    setTotal: (value) => { total = value; },
    advance: (ms) => { time += ms; },
  };
}

test('only GitHub image proxy fetches count as profile views', () => {
  assert.equal(isGithubCamo(CAMO), true);
  assert.equal(isGithubCamo('github-camo'), true);
  assert.equal(isGithubCamo('Mozilla/5.0 (Macintosh) Chrome/130'), false);
  assert.equal(isGithubCamo('curl/8.4 github-camo'), false);
  assert.equal(isGithubCamo(''), false);
});

test('a profile view event carries no IP, session or location', () => {
  const event = githubProfileViewEvent({ eventId: 'e1', now: new Date('2026-11-02T12:00:00Z'), userAgent: CAMO });
  assert.equal(event.eventType, GITHUB_PROFILE_VIEW_EVENT);
  assert.equal(event.siteId, 'yuqi.site');
  assert.equal(event.pageUrl, GITHUB_PROFILE_URL);
  assert.equal(event.eventTime, '2026-11-02T12:00:00.000Z');
  for (const key of ['sessionId', 'anonId', 'ipRaw', 'ipHash', 'geoHint', 'targetUrl']) assert.equal(event[key], null, key);
  assert.equal(event.uaRaw, CAMO);
  assert.deepEqual(event.properties, {});
  assert.equal(githubProfileViewEvent({ eventId: 'e2', userAgent: 'x'.repeat(400) }).uaRaw.length, 255);

  const row = fallbackVisitorLog(event);
  assert.equal(row.ip, 'redacted');
  assert.equal(row.event, GITHUB_PROFILE_VIEW_EVENT);
  assert.equal(row.city, null);
  assert.equal(row.latitude, null);
});

test('the workbench recognizes profile views and links them to GitHub', () => {
  assert.equal(isGithubProfileView({ eventName: GITHUB_PROFILE_VIEW_EVENT }), true);
  assert.equal(isGithubProfileView({ eventName: 'page_view' }), false);
  assert.equal(isGithubProfileView(null), false);
  assert.deepEqual(githubProfileContent({ eventName: GITHUB_PROFILE_VIEW_EVENT }), {
    title: 'GitHub profile README', type: 'GitHub', canonicalUrl: GITHUB_PROFILE_URL,
  });
  assert.equal(githubProfileContent({ eventName: 'page_view' }), null);
});

test('rollup rows add up and counts are formatted for the badge', () => {
  assert.equal(sumEventCounts([{ event_count: 3 }, { event_count: '4' }, { event_count: null }, { event_count: -2 }, {}]), 7);
  assert.equal(sumEventCounts(null), 0);
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(1234567), '1,234,567');
  assert.equal(formatCount(12.9), '12');
  for (const unknown of [null, undefined, NaN, -1, 'abc']) assert.equal(formatCount(unknown), '–');
});

test('the badge is a self-contained SVG sized to its text', () => {
  const svg = renderViewBadge({ count: 1234 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20" role="img" aria-label="profile views: 1,234">/);
  assert.match(svg, /<title>profile views: 1,234<\/title>/);
  assert.equal((svg.match(/>1,234</g) || []).length, 2);
  assert.doesNotMatch(svg, /<script|href=|xlink|on\w+=/i);
  const width = Number(svg.match(/width="(\d+)"/)[1]);
  assert.equal(width, Math.ceil(textWidth('profile views') + 10) + Math.ceil(textWidth('1,234') + 10));
  assert.ok(Number(renderViewBadge({ count: 1234567 }).match(/width="(\d+)"/)[1]) > width);
  assert.match(renderViewBadge({ count: null }), /aria-label="profile views: –"/);

  const hostile = renderViewBadge({ count: 1, label: '<a href="x">&', color: '"><script>' });
  assert.doesNotMatch(hostile, /<a |<script/);
  assert.match(hostile, /&lt;a href=&quot;x&quot;&gt;&amp;/);
});

test('responses forbid caching so GitHub refetches the badge on every profile load', () => {
  assert.match(BADGE_HEADERS['Cache-Control'], /no-cache/);
  assert.match(BADGE_HEADERS['Cache-Control'], /no-store/);
  assert.match(BADGE_HEADERS['Cache-Control'], /max-age=0/);
  assert.equal(BADGE_HEADERS['Content-Type'], 'image/svg+xml; charset=utf-8');
  assert.match(BADGE_HEADERS['Content-Security-Policy'], /default-src 'none'/);
});

test('a GitHub view is produced to Kafka and counted on the badge', async () => {
  const h = harness();
  const first = await h.handle(camoRequest());
  assert.equal(first.status, 200);
  assert.equal(first.via, 'kafka');
  assert.equal(first.count, 42);
  assert.match(first.body, /profile views: 42/);
  assert.equal(first.headers, BADGE_HEADERS);
  assert.equal(h.produced.length, 1);
  assert.equal(h.produced[0].eventId, 'evt-1');
  assert.equal(h.produced[0].ipRaw, null);
  assert.equal(h.fallbacks.length, 0);

  const second = await h.handle(camoRequest());
  assert.equal(second.count, 43);
  assert.equal(h.reads(), 1, 'the total is cached between views');
});

test('the cached total refreshes after a minute and the badge never counts down', async () => {
  const h = harness();
  await h.handle(camoRequest());
  await h.handle(camoRequest());
  assert.equal(h.reads(), 1);

  // The rollups have caught up with both views plus one recorded elsewhere.
  h.setTotal(44);
  h.advance(COUNT_CACHE_MS + 1);
  const fresh = await h.handle(camoRequest());
  assert.equal(h.reads(), 2);
  assert.equal(fresh.count, 45);

  // A lagging read (this view still in flight) never makes the badge go back.
  h.setTotal(40);
  h.advance(COUNT_CACHE_MS + 1);
  const lagging = await h.handle(camoRequest());
  assert.equal(lagging.count, 45);
});

test('other clients see the badge without being counted', async () => {
  const h = harness();
  const browser = await h.handle({ method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 Chrome/130' } });
  assert.equal(browser.via, 'not_counted');
  assert.equal(browser.count, 41);
  assert.match(browser.body, /^<svg/);
  const head = await h.handle({ method: 'HEAD', headers: { 'user-agent': CAMO } });
  assert.equal(head.via, 'not_counted');
  assert.equal(head.body, '');
  const post = await h.handle({ method: 'POST', headers: { 'user-agent': CAMO } });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET, HEAD');
  const local = createGithubBadgeHandler({
    produce: async () => { throw new Error('must not record'); },
    fallbackInsert: async () => ({ ok: true }),
    loadCount: async () => 5,
    newEventId: () => 'x',
    isLocal: () => true,
    log: silent,
  });
  assert.equal((await local(camoRequest())).via, 'not_counted');
  assert.equal(h.produced.length, 0);
});

test('rate-limited proxy addresses still get a badge but are not counted', async () => {
  const seen = [];
  const h = harness({ deps: { rateLimited: async (ip) => { seen.push(ip); return true; } } });
  const result = await h.handle(camoRequest({ 'x-forwarded-for': '140.82.115.7, 10.0.0.1' }));
  assert.equal(result.via, 'rate_limited');
  assert.equal(result.count, 41);
  assert.deepEqual(seen, ['140.82.115.7']);
  assert.equal(h.produced.length, 0);

  const broken = harness({ deps: { rateLimited: async () => { throw new Error('valkey down'); } } });
  assert.equal((await broken.handle(camoRequest())).via, 'kafka');
});

test('without Kafka the view falls back to visitor_logs', async () => {
  const h = harness({ deps: { produce: async () => false } });
  const result = await h.handle(camoRequest());
  assert.equal(result.via, 'supabase-fallback');
  assert.equal(h.fallbacks.length, 1);
  assert.equal(h.fallbacks[0].event, GITHUB_PROFILE_VIEW_EVENT);
  assert.equal(h.fallbacks[0].ip, 'redacted');

  const failing = harness({ deps: { produce: async () => { throw new Error('broker down'); }, fallbackInsert: async () => ({ ok: false }) } });
  const failed = await failing.handle(camoRequest());
  assert.equal(failed.via, 'failed');
  assert.equal(failed.count, 41, 'an unrecorded view is not added to the badge');
  assert.equal(failed.status, 200);
});

test('a slow Kafka produce does not hold the badge or write a duplicate fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ deps: { produce: () => new Promise(() => {}) } });
  const pending = h.handle(camoRequest());
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  t.mock.timers.tick(RECORD_TIMEOUT_MS);
  const result = await pending;
  assert.equal(result.via, 'timeout');
  assert.equal(h.fallbacks.length, 0);
  assert.equal(result.status, 200);
});

test('an unavailable total still renders a badge', async () => {
  const h = harness({ deps: { loadCount: async () => { throw new Error('supabase down'); } } });
  const result = await h.handle(camoRequest());
  assert.equal(result.via, 'kafka');
  assert.equal(result.count, null);
  assert.match(result.body, /profile views: –/);

  const unconfigured = harness({ deps: { loadCount: async () => null } });
  assert.equal((await unconfigured.handle(camoRequest())).count, null);
});
