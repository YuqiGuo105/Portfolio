import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as visitorSessions from '../src/lib/visitorSessions.mjs';
import { groupVisitorEvents } from '../src/lib/visitorWorkbench.mjs';
import { createVisitorPreviewApi } from '../src/lib/visitorPreview.mjs';
import { createVisitorActorHeaders } from '../src/lib/visitorActorHeaders.mjs';
import { createMediaTelemetry, mediaContext, MEDIA_PROPERTIES } from '../src/lib/media/telemetry.mjs';
import { clearPlaybackStats, mediaNetworkProperties, notePlaybackStats } from '../src/lib/media/playbackStats.mjs';

const { groupVisitorSessions, sessionHeadline, connectionSummary, formatSeconds, formatRate, pageTimeline, timeOnPage } = visitorSessions;
const at = seconds => new Date(Date.UTC(2026, 10, 23, 12, 0, seconds)).toISOString();
const event = (sessionId, seconds, eventName, pageUrl, properties = {}, extra = {}) =>
  ({ eventId: `${sessionId}-${seconds}-${eventName}`, siteId: 'site', sessionId, eventName, eventTime: at(seconds), pageUrl, properties, ...extra });

test('a session is one record: pages in the order opened, each with its reading, clicks and video', () => {
  const play = { component: 'video', mediaId: 'intro', placement: 'home_intro', playMode: 'explicit', playbackId: 'p1', durationSeconds: 60 };
  const raw = [
    event('a', 0, 'page_view', '/'),
    event('a', 2, 'media_impression', '/', { component: 'video', mediaId: 'intro' }),
    event('a', 4, 'media_play_request', '/', { ...play, playTrigger: 'button' }),
    event('a', 5, 'media_start', '/', { ...play, startupMs: 420, quality: '720p', bandwidthKbps: 5200, effectiveType: '4g' }),
    event('a', 30, 'media_summary', '/', { ...play, watchedSeconds: 25, coveragePercent: 41, stallCount: 1, stallMs: 900, quality: '1080p', bitrateKbps: 5000, bandwidthKbps: 8400, effectiveType: '4g' }),
    // A summary delivered late must not lower the totals or roll the quality back.
    event('a', 20, 'media_summary', '/', { ...play, watchedSeconds: 15, coveragePercent: 25, quality: '720p', bandwidthKbps: 5200 }),
    event('a', 40, 'read_progress', '/', { progressPercent: 25 }),
    event('a', 45, 'read_progress', '/', { progressPercent: 50 }),
    event('a', 50, 'project_open', '/', { component: 'projects' }, { targetUrl: '/work-single/abc', targetContent: { title: 'Portfolio Platform', type: 'project' } }),
    event('a', 51, 'page_view', '/work-single/abc', {}, { pageContent: { title: 'Portfolio Platform', type: 'project' } }),
    event('a', 80, 'read_progress', '/work-single/abc', { progressPercent: 100 }),
    event('a', 90, 'outbound_link_clicked', '/work-single/abc', { action: 'github', component: 'article' }, { targetUrl: 'https://github.com/example/repo' }),
    event('a', 95, 'widget_opened', '/work-single/abc', { component: 'chat', action: 'open' }),
    event('a', 120, 'page_view', '/'),
    event('b', 60, 'page_view', '/blogs', {}, { bot: true }),
  ];
  // Every stored row carries the visitor's context, as the pipeline writes it.
  const client = { city: 'Seattle', country: 'US', deviceType: 'desktop', referrer: 'https://www.google.com/', bot: false };
  // The admin route attaches the page's title to every record of that page.
  const titled = row => (row.pageUrl === '/work-single/abc' ? { pageContent: { title: 'Portfolio Platform', type: 'project' }, ...row } : row);
  const sessions = groupVisitorSessions(groupVisitorEvents(raw.map(row => titled(row.sessionId === 'a' ? { ...client, ...row } : row))));
  assert.deepEqual(sessions.map(session => session.sessionId), ['a', 'b'], 'newest activity first');
  const [a, b] = sessions;
  // Page visits arrive already grouped by session and page, so coming back to "/" adds to its record.
  assert.deepEqual(a.pages.map(page => page.path), ['/', '/work-single/abc']);
  assert.equal(a.start, at(0)); assert.equal(a.end, at(120)); assert.equal(a.durationMs, 120000);
  assert.deepEqual(a.visitor, { city: 'Seattle', region: '', country: 'US', deviceType: 'desktop', browser: '', os: '', referrer: 'https://www.google.com/', ipAddress: '', bot: false });
  assert.deepEqual(a.totals, { pages: 2, events: 15 - 1, clicks: 2, actions: 1, plays: 1, watchedSeconds: 25 });
  assert.equal(sessionHeadline(a), '2 pages, 2 clicks, 1 action, 25 s of video');

  const home = a.pages[0];
  assert.equal(home.scroll, 50);
  assert.deepEqual(home.checkpoints.map(point => point.percent), [25, 50]);
  assert.equal(home.videosSeen, 1);
  assert.deepEqual(home.clicks.map(click => [click.kind, click.label, click.href]), [['content', 'Portfolio Platform', '/work-single/abc']]);
  assert.equal(home.media.length, 1);
  const media = home.media[0];
  assert.deepEqual([media.started, media.completed, media.watchedSeconds, media.durationSeconds, media.coveragePercent], [true, false, 25, 60, 41]);
  assert.deepEqual([media.quality, media.qualities, media.bandwidthKbps, media.bitrateKbps, media.effectiveType], ['1080p', ['720p', '1080p'], 8400, 5000, '4g']);
  assert.deepEqual([media.startupMs, media.stallCount, media.stallMs, media.trigger], [420, 1, 900, 'button']);
  assert.equal(connectionSummary(media), 'about 8.4 Mbps measured, 4G');
  assert.equal('readAt' in media, false);

  const project = a.pages[1];
  assert.equal(project.reference.title, 'Portfolio Platform');
  assert.equal(project.scroll, 100);
  assert.deepEqual(project.clicks.map(click => [click.kind, click.label, click.href]), [['outbound', 'GitHub link', 'https://github.com/example/repo']]);
  assert.deepEqual(project.actions.map(action => [action.label, action.detail]), [['Opened chat', '']]);
  assert.equal(b.visitor.bot, true);
  assert.equal(sessionHeadline(b), '1 page');
  assert.equal(a.representative.eventTime, at(120));
});

test('an IP address never joins sessions, and a record without a session ID stands alone', () => {
  const shared = { ipAddress: '198.51.100.7' };
  const sessions = groupVisitorSessions([
    event('x', 0, 'page_view', '/', {}, shared), event('y', 5, 'page_view', '/', {}, shared),
    { ...event('', 9, 'page_view', '/cv', {}, shared), eventId: 'no-session-1' }, { ...event('', 12, 'page_view', '/cv', {}, shared), eventId: 'no-session-2' },
  ]);
  assert.equal(sessions.length, 4);
  assert.equal(sessions.filter(session => !session.sessionId).length, 2);
  assert.deepEqual(groupVisitorSessions(null), []);
  assert.deepEqual(groupVisitorSessions([null, undefined]), []);
});

test('when older records were not read, only sessions near that edge are marked as possibly longer', () => {
  const records = [event('old', 0, 'page_view', '/'), event('recent', 3600, 'page_view', '/')];
  const [recent, old] = groupVisitorSessions(records, { boundary: at(0) });
  assert.equal(old.mayStartEarlier, true); assert.equal(recent.mayStartEarlier, false);
  assert.equal(groupVisitorSessions(records).every(session => session.mayStartEarlier === false), true);
});

test('figures are worded without false precision', () => {
  assert.equal(formatSeconds(42.4), '42 s'); assert.equal(formatSeconds(60), '1 min'); assert.equal(formatSeconds(135), '2 min 15 s'); assert.equal(formatSeconds(null), '');
  assert.equal(formatRate(650), '650 kbps'); assert.equal(formatRate(8400), '8.4 Mbps');
  assert.equal(connectionSummary({ bandwidthKbps: null, downlinkMbps: 1.2, effectiveType: '3g' }), 'about 1.2 Mbps reported by the browser, 3G');
  assert.equal(connectionSummary({ bandwidthKbps: null, downlinkMbps: null, effectiveType: '' }), '');
});

test('the local preview offers the same view with complete synthetic journeys', async () => {
  const result = await createVisitorPreviewApi().visitors.list({ view: 'sessions', hours: 24, page: 0, size: 50 });
  assert.equal(result.view, 'sessions'); assert.equal(result.sample.complete, true);
  const reader = result.items.find(session => session.sessionId === 'sample-reader-session');
  assert.equal(sessionHeadline(reader), '3 pages, 2 clicks, 2 actions, 42 s of video');
  const slow = result.items.find(session => session.sessionId === 'sample-slow-video-session').pages[0].media[0];
  assert.deepEqual([slow.quality, slow.stallCount, connectionSummary(slow)], ['360p', 3, 'about 650 kbps measured, 3G']);
});

test('every playback record says which quality was on screen and how fast the connection was', () => {
  const video = { duration: 20, currentTime: 0, paused: false, seeking: false, playbackRate: 1, readyState: 4, videoWidth: 1280, videoHeight: 720 };
  // Nothing reported by a player: the decoded size is still a fact, and the browser may know the connection.
  assert.deepEqual(mediaNetworkProperties(video, { downlink: 9.96, effectiveType: '4g' }), { quality: '720p', downlinkMbps: 10, effectiveType: '4g' });
  assert.deepEqual(mediaNetworkProperties({}, undefined), {});
  assert.deepEqual(mediaNetworkProperties(video, { downlink: Infinity, effectiveType: 'wifi<script>' }), { quality: '720p' });
  notePlaybackStats(video, { height: 1080, bitrate: 5_012_000, bandwidth: 8_432_100 });
  notePlaybackStats(video, { bandwidth: 7_990_000 });
  assert.deepEqual(mediaNetworkProperties(video, null), { quality: '1080p', bitrateKbps: 5010, bandwidthKbps: 8000 });

  let clock = 0;
  const events = [];
  const tracker = createMediaTelemetry({ context: mediaContext({ id: 'movie' }, 'article', '/'), emit: (name, context) => events.push({ name, ...context.properties }),
    now: () => clock, id: () => 'play-1', network: element => mediaNetworkProperties(element, { downlink: 10, effectiveType: '4g' }) });
  tracker.playing(video);
  for (let second = 0; second < 16; second++) { clock += 1000; video.currentTime += 1; tracker.sample(video); }
  const summary = events.find(item => item.name === 'media_summary');
  assert.deepEqual([summary.quality, summary.bitrateKbps, summary.bandwidthKbps, summary.downlinkMbps, summary.effectiveType], ['1080p', 5010, 8000, 10, '4g']);
  // A throughput estimate that drifts while nothing was watched does not produce another record.
  const before = events.length;
  notePlaybackStats(video, { bandwidth: 3_000_000 }); tracker.boundary(video); tracker.boundary(video);
  assert.equal(events.length, before + 1, 'one summary for the pause, none for the drift');
  clearPlaybackStats(video);
  assert.deepEqual(mediaNetworkProperties(video, null), { quality: '720p' });
  // A failing reader can never interrupt playback or the viewing figures.
  const guarded = createMediaTelemetry({ context: mediaContext({ id: 'm' }), emit: () => {}, now: () => 0, network: () => { throw new Error('unavailable'); } });
  guarded.playing(video); assert.equal(guarded.metrics().watchedSeconds, 0);
});

test('the new properties pass every allowlist on the way to storage', () => {
  const added = ['bitrateKbps', 'bandwidthKbps', 'downlinkMbps', 'effectiveType'];
  const track = readFileSync(new URL('../pages/api/track.js', import.meta.url), 'utf8');
  for (const property of [...added, 'quality']) { assert.ok(MEDIA_PROPERTIES.includes(property), property); assert.ok(track.includes(`'${property}'`), property); }
});

const require = createRequire(import.meta.url);
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../pages/api/admin/visitors.js', import.meta.url), 'utf8'), {
  filename: 'visitors.js', jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' }, module: { type: 'commonjs' },
});
function route(allowed = true) {
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name.includes('agentServiceProxy')) return { requireAdminUser: async (_req, res) => { if (allowed) return { role: 'ADMIN' }; res.status(401).json({ error: 'unauthorized' }); return null; } };
    if (name.includes('supabaseServer')) return { supabaseServer: { from: () => ({ select: () => ({ in: async () => ({ data: [{ id: 'abc', title: 'Portfolio Platform', image_url: null }], error: null }) }) }) } };
    if (name.includes('analyticsHostFilter')) return { isLoopbackUrl: value => String(value || '').includes('localhost') };
    if (name.includes('visitorActorHeaders')) return { createVisitorActorHeaders };
    if (name.includes('visitorSessions')) return visitorSessions;
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  return exports.default;
}
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });

test('the visitors view groups page visits on the server, keeps the admin gate and says when it is a sample', async () => {
  const originalFetch = globalThis.fetch, previous = process.env.ANALYTICS_SERVICE_TOKEN;
  process.env.ANALYTICS_SERVICE_TOKEN = 'test-only-token';
  const requests = [];
  // 250 page visits in the window, 3 per session, newest first, 100 per upstream page.
  const visits = Array.from({ length: 250 }, (_, index) => ({ eventId: `v${index}`, siteId: 'site', sessionId: `s${Math.floor(index / 3)}`, eventName: 'page_view',
    eventTime: at(100000 - index * 60), pageUrl: index % 3 ? '/work-single/abc' : '/', visit: { eventCount: 2, firstEventTime: at(100000 - index * 60 - 5), lastEventTime: at(100000 - index * 60), maxProgressPercent: 50, openedAt: at(100000 - index * 60 - 5), checkpoints: [] } }));
  visits[4].pageUrl = 'http://localhost:3000/'; // never shown
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url); requests.push(parsed);
    assert.equal(options.headers['X-Internal-Token'], 'test-only-token');
    const page = Number(parsed.searchParams.get('page')), size = Number(parsed.searchParams.get('size'));
    return new Response(JSON.stringify({ view: 'visits', items: visits.slice(page * size, (page + 1) * size), page: { number: page, size, totalElements: visits.length },
      summary: { totalEvents: 500 }, from: at(0), to: at(100001) }));
  };
  try {
    const denied = response();
    await route(false)({ method: 'GET', query: { view: 'sessions' } }, denied);
    assert.equal(denied.statusCode, 401); assert.equal(requests.length, 0);

    const res = response();
    await route()({ method: 'GET', query: { view: 'sessions', hours: '24', page: '1', size: '10', bot: 'EXCLUDE', arbitrary: 'x' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(requests.map(request => [request.pathname, request.searchParams.get('page'), request.searchParams.get('size')]),
      [['/api/admin/visitor-visits', '0', '100'], ['/api/admin/visitor-visits', '1', '100'], ['/api/admin/visitor-visits', '2', '100']]);
    assert.equal(requests[0].searchParams.get('hours'), '24'); assert.equal(requests[0].searchParams.get('bot'), 'EXCLUDE');
    assert.equal(requests[0].searchParams.has('arbitrary'), false); assert.equal(requests[0].searchParams.has('view'), false);
    // Later pages read the window the first page reported, not a window that moved in between.
    assert.equal(requests[1].searchParams.has('hours'), false); assert.equal(requests[1].searchParams.get('from'), at(0)); assert.equal(requests[2].searchParams.get('to'), at(100001));
    assert.equal(res.body.view, 'sessions');
    assert.deepEqual(res.body.sample, { activities: 250, totalActivities: 250, complete: true });
    assert.deepEqual(res.body.page, { number: 1, size: 10, totalElements: 84, totalPages: 9 });
    assert.equal(res.body.items.length, 10); assert.equal(res.body.items[0].sessionId, 's10');
    assert.equal(res.body.items[0].pages.find(page => page.path === '/work-single/abc').reference.title, 'Portfolio Platform');
    assert.equal(res.body.items.every(session => session.mayStartEarlier === false), true);
    assert.match(res.headers['Cache-Control'], /no-store/);

    const first = response();
    await route()({ method: 'GET', query: { view: 'sessions' } }, first);
    assert.equal(first.body.page.size, 20);
    assert.equal(JSON.stringify(first.body).includes('localhost'), false);
    assert.equal(first.body.items[1].pages.length, 2, 'the loopback record is dropped, the rest of that session stays');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.ANALYTICS_SERVICE_TOKEN; else process.env.ANALYTICS_SERVICE_TOKEN = previous;
  }
});

test('a window larger than the sample is reported as partial and its oldest session is flagged', async () => {
  const originalFetch = globalThis.fetch, previous = process.env.ANALYTICS_SERVICE_TOKEN, pages = process.env.ADMIN_VISITOR_SESSION_PAGES;
  process.env.ANALYTICS_SERVICE_TOKEN = 'test-only-token';
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    const page = Number(new URL(url).searchParams.get('page'));
    const items = Array.from({ length: 100 }, (_, index) => ({ eventId: `p${page}-${index}`, siteId: 'site', sessionId: `s${page}-${index}`, eventName: 'page_view', eventTime: at(900000 - (page * 100 + index) * 3600), pageUrl: '/' }));
    return new Response(JSON.stringify({ items, page: { totalElements: 5000 }, from: at(0), to: at(900001) }));
  };
  try {
    const res = response();
    await route()({ method: 'GET', query: { view: 'sessions', page: '29', size: '20' } }, res);
    assert.equal(calls, 6, 'the default sample is six upstream pages');
    assert.deepEqual(res.body.sample, { activities: 600, totalActivities: 5000, complete: false });
    assert.equal(res.body.page.totalElements, 600);
    assert.equal(res.body.items.at(-1).mayStartEarlier, true); assert.equal(res.body.items[0].mayStartEarlier, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.ANALYTICS_SERVICE_TOKEN; else process.env.ANALYTICS_SERVICE_TOKEN = previous;
    if (pages === undefined) delete process.env.ADMIN_VISITOR_SESSION_PAGES; else process.env.ADMIN_VISITOR_SESSION_PAGES = pages;
  }
});

test('an opened page lists what happened on it in order, and says how long it was open', async () => {
  const result = await createVisitorPreviewApi().visitors.list({ view: 'sessions', hours: 24, page: 0, size: 50 });
  const [home, project, guide] = result.items.find(session => session.sessionId === 'sample-reader-session').pages;
  const rows = pageTimeline(home);
  assert.deepEqual(rows.map(row => [row.kind, row.text, row.detail]), [
    ['open', 'Opened the page', ''],
    ['play', 'Started the homepage introduction', ''],
    ['scroll', 'Scrolled to 25%', ''],
    ['scroll', 'Scrolled to 50%', ''],
    ['click', 'Clicked Portfolio Platform', 'in projects'],
  ]);
  assert.equal(rows.at(-1).href, '/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c');
  assert.deepEqual(rows.map(row => Date.parse(row.time)), rows.map(row => Date.parse(row.time)).sort((a, b) => a - b));
  // "Started a chat" already says chat; the component it came from is not repeated after it.
  assert.deepEqual(pageTimeline(project).filter(row => row.kind === 'action').map(row => [row.text, row.detail]), [['Opened chat', ''], ['Started a chat', '']]);
  assert.deepEqual(pageTimeline({}), []);
  assert.deepEqual(pageTimeline(null), []);

  // Until the next page opened is exact; the last page only has a lower bound.
  assert.deepEqual(timeOnPage(home, project), { ms: Date.parse(project.first) - Date.parse(home.first), atLeast: false });
  assert.deepEqual(timeOnPage(guide, undefined), { ms: Date.parse(guide.last) - Date.parse(guide.first), atLeast: true });
  assert.equal(timeOnPage({ first: home.first, last: home.first }, undefined), null);
  assert.equal(timeOnPage({}, undefined), null);
});

test('the visitors view names its controls and keeps its own sizes against the site theme', () => {
  const card = readFileSync(new URL('../src/components/admin/VisitorSessions.jsx', import.meta.url), 'utf8');
  for (const control of ['Timeline', 'Classification evidence', 'Create alert', 'Identifiers']) assert.ok(card.includes(control), control);
  assert.ok(card.includes("onInspect(item, 'timeline')") && card.includes("onInspect(item, 'evidence')") && card.includes('onAlert(item)'));
  assert.ok(card.includes('A shared IP address does not establish a shared identity.'));
  const css = readFileSync(new URL('../src/components/admin/VisitorSessions.module.css', import.meta.url), 'utf8');
  // Every button in the card states its own height; the theme would make it 60px tall otherwise.
  for (const rule of ['.card .actions button {', '.card .traits :is(button, span) {', '.card .ids button {', '.card .who h3 > button {']) {
    const body = css.slice(css.indexOf(rule), css.indexOf('}', css.indexOf(rule)));
    assert.ok(css.includes(rule) && /height:/.test(body), rule);
  }
  assert.match(css, /prefers-reduced-motion/);
  const page = readFileSync(new URL('../src/components/admin/VisitorsPage.module.css', import.meta.url), 'utf8');
  assert.ok(page.includes('.workspace button { height: auto; line-height: 1.25; }'));
});
