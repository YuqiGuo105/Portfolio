import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mapLink, referrerOrigin, assessmentEvidence, alertFromVisitor, readSavedViews, sanitizeSavedView, sessionWindow, eventTimestamp } from '../src/lib/visitorWorkbench.mjs';
import { createVisitorSessionHandler, readVisitorSession, validateSessionRequest } from '../src/lib/visitorSession.mjs';
import { createVisitorPreviewApi } from '../src/lib/visitorPreview.mjs';

const args = { sessionId: 'sample-1', window: { from: '2026-10-10T00:00:00Z', to: '2026-10-11T00:00:00Z' }, page: { number: 0, size: 25 } };
test('map URL includes only approximate location, never visitor identifiers', () => {
  const url = new URL(mapLink({ city: 'Jaipur', region: 'RJ', country: 'IN', ipAddress: '198.51.100.1', sessionId: 'secret' }));
  assert.equal(url.searchParams.get('query'), 'Jaipur, RJ, IN');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(mapLink({ city: 'Unknown' }), null);
});
test('referrer external action strips paths, query and hash; blocks unsafe URLs', () => {
  assert.deepEqual(referrerOrigin('https://linkedin.com/feed/?token=secret#part'), { domain: 'linkedin.com', href: 'https://linkedin.com' });
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'https://x@linkedin.com', 'https://linkedin.com\\@evil.com', 'http://', '']) assert.equal(referrerOrigin(value), null);
});
test('missing or invalid provider scores never become a human assertion', () => {
  assert.equal(assessmentEvidence({ bot: false }).score, null);
  assert.equal(assessmentEvidence({ properties: { botAssessmentStatus: 'FAILED', botAssessmentHumanScore: 0.9 } }).score, null);
  assert.equal(assessmentEvidence({ properties: { botAssessmentStatus: 'VALID', botAssessmentHumanScore: 0 } }).score, 0);
  assert.equal(assessmentEvidence({ properties: { botAssessmentStatus: 'VALID', botAssessmentHumanScore: '0.9' } }).score, null);
});
test('alert seed preserves actual geo codes, source and bot classification, starts paused', () => {
  const seed = alertFromVisitor({ city: 'Jaipur', region: 'RJ', country: 'IN', referrer: 'https://linkedin.com', eventName: 'page_view', bot: false }, 'site');
  assert.equal(seed.geoAreaId, 'REGION:IN:RJ'); assert.equal(seed.enabled, false); assert.equal(seed.threshold, 1);
  assert.deepEqual(seed.filters, { bot: 'EXCLUDE', referrerDomain: 'linkedin.com' });
  assert.equal(alertFromVisitor({ city: 'Unknown' }).geoLevel, 'GLOBAL');
  assert.equal(alertFromVisitor({ bot: null }).filters.bot, 'ALL');
});
test('saved views exclude identifiers and arbitrary fields; storage parser is bounded', () => {
  const view = sanitizeSavedView({ name: ' Mobile ', hours: 24, filters: { device: 'mobile', query: '198.51.100.1', sessionId: 'secret', includeAdmin: true } });
  assert.deepEqual(view, { name: 'Mobile', hours: 24, filters: { device: 'mobile', bot: 'ALL' } });
  assert.deepEqual(readSavedViews('{oops'), []); assert.deepEqual(readSavedViews('{}'), []);
  assert.equal(readSavedViews(JSON.stringify(Array(30).fill(view))).length, 12);
});
test('fixed session window includes selected event and remains bounded; timestamps are explicit', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const window = sessionWindow({ eventTime: '2026-10-10T00:00:00Z' }, 24, now);
  assert.ok(Date.parse(window.from) < Date.parse('2026-10-10T00:00:00Z'));
  assert.match(eventTimestamp(window.from, 'UTC'), /UTC$/); assert.equal(eventTimestamp('invalid'), 'Not recorded');
});
test('session input rejects arbitrary tools, unbounded windows, identifiers and pages', () => {
  assert.equal(validateSessionRequest(args).sessionId, 'sample-1');
  for (const value of [{ ...args, name: 'admin.delete' }, { ...args, sessionId: '../../' }, { ...args, page: { number: 0, size: 1000 } }, { ...args, window: { from: '2020-01-01Z', to: args.window.to } }, { ...args, window: { ...args.window, includeAdmin: true } }]) assert.throws(() => validateSessionRequest(value));
});

function response() { const res = new EventEmitter(); res.headers = {}; res.setHeader = (k, v) => { res.headers[k] = v; }; res.status = code => { res.statusCode = code; return res; }; res.json = body => { res.body = body; res.writableEnded = true; return res; }; return res; }
for (const [role, status] of [['anonymous', 401], ['VIEWER', 403], ['expired', 401]]) test(`session handler never calls MCP for ${role}`, async () => {
  let called = false;
  const handler = createVisitorSessionHandler({ requireAdmin: async (_req, res) => { res.status(status).json({ error: role }); return null; }, read: async () => { called = true; } });
  const res = response(); await handler({ method: 'POST', headers: {}, body: args }, res);
  assert.equal(res.statusCode, status); assert.equal(called, false); assert.match(res.headers['Cache-Control'], /no-store/);
});
test('session endpoint forwards only validated args and hides downstream errors', async () => {
  const req = { method: 'POST', headers: { authorization: 'Bearer test' }, body: args }, res = response();
  await createVisitorSessionHandler({ requireAdmin: async () => ({ roles: 'ADMIN' }), read: async (body, options) => { assert.equal(body.sessionId, args.sessionId); assert.equal(options.authorization, 'Bearer test'); throw new Error('upstream password'); } })(req, res);
  assert.equal(res.statusCode, 502); assert.ok(!JSON.stringify(res.body).includes('password'));
});
test('MCP transport calls exact private read tool with JWT and cancels a terminal SSE stream', async () => {
  let cancelled = false;
  const result = await readVisitorSession(args, { authorization: 'Bearer sample', fetchImpl: async (url, options) => {
    assert.equal(url.pathname, '/mcp/admin'); assert.equal(options.headers.Authorization, 'Bearer sample'); assert.equal(options.redirect, 'error');
    const rpc = JSON.parse(options.body); assert.equal(rpc.params.name, 'visitor.get_session_events'); assert.deepEqual(rpc.params.arguments, args);
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { structuredContent: { items: [], page: { totalElements: 0 } } } })}\n\n`)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal(result.items.length, 0); assert.equal(cancelled, true);
});
test('preview is development-only, without changing the real admin auth gate', () => {
  const source = readFileSync(new URL('../pages/admin/visitor-preview.js', import.meta.url), 'utf8');
  assert.match(source, /NODE_ENV === 'development'.*notFound: true/);
  assert.match(readFileSync(new URL('../pages/admin/visitors.js', import.meta.url), 'utf8'), /<AdminLayout><VisitorsWorkspace \/><\/AdminLayout>/);
  assert.match(readFileSync(new URL('../pages/api/admin/visitor-session.js', import.meta.url), 'utf8'), /requireAdmin: requireAdminUser/);
});
test('sample alert preparation does not apply before confirmation', async () => {
  const api = createVisitorPreviewApi(); const before = await api.visitorAlerts.overview();
  const prepared = await api.visitorAlerts.prepareChange({ patch: alertFromVisitor({ country: 'IN' }, 'preview.local'), reason: 'Preview test' });
  assert.equal((await api.visitorAlerts.overview()).rules.length, before.rules.length);
  await api.visitorAlerts.applyChange(prepared.changeId);
  assert.equal((await api.visitorAlerts.overview()).rules.length, before.rules.length + 1);
});
