import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createVisitorActorHeaders } from '../src/lib/visitorActorHeaders.mjs';

const require = createRequire(import.meta.url);
const { transform } = require('next/dist/build/swc');
const actor = '42a1f734-31bf-4cd2-8e1d-0f6a3b2c9d80';
const forgedActor = '9512bace-1780-4e96-8f03-84b19f56e0ce';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const routes = ['visitors', 'visitor-overview', 'visitor-intelligence'];
const compiled = new Map();
for (const route of routes) {
  const { code } = await transform(readFileSync(new URL(`../pages/api/admin/${route}.js`, import.meta.url), 'utf8'), {
    filename: `${route}.js`, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' }, module: { type: 'commonjs' },
  });
  compiled.set(route, code);
}

function handler(route, { auth = { userId: actor, email: 'private-admin@example.test' }, status = 401, fetchImpl }) {
  const exports = {};
  new Function('require', 'exports', 'fetch', 'process', compiled.get(route))(name => {
    if (name.includes('agentServiceProxy')) return { requireAdminUser: async (_req, res) => {
      if (auth) return auth;
      res.status(status).json({ error: 'denied' }); return null;
    } };
    if (name.includes('visitorActorHeaders')) return { createVisitorActorHeaders };
    if (name.includes('supabaseServer')) return { supabaseServer: { from() { throw new Error('Unexpected database call'); } } };
    if (name.includes('analyticsHostFilter')) return { isLoopbackUrl: () => false };
    throw new Error(`Unexpected import ${name}`);
  }, exports, fetchImpl, { env: {
    ANALYTICS_SERVICE_TOKEN: 'fixture-internal-token',
    ANALYTICS_API_URL: 'https://analytics.example.test',
    ADMIN_VISITOR_EXPORT_MAX_ROWS: '1000',
  } });
  return exports.default;
}

function request(query = {}) {
  return { method: 'GET', query: { actor: forgedActor, userId: forgedActor, ...query }, body: { userId: forgedActor }, headers: {
    authorization: 'Bearer browser-session',
    'x-admin-actor': forgedActor, 'X-Admin-Actor': forgedActor,
    'x-admin-action': 'visitor_export', 'x-admin-export-format': 'csv',
    'x-admin-request-id': forgedActor, 'x-internal-token': 'forged-internal-token',
  } };
}
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}
const emptyPage = () => new Response(JSON.stringify({ items: [], page: { totalElements: 0 } }));

test('actor headers accept only a UUID from verified userId and never fall back to email', () => {
  assert.equal(createVisitorActorHeaders({ userId: actor.toUpperCase() })['X-Admin-Actor'], actor);
  for (const userId of [undefined, null, '', 123, {}, [], 'admin@example.test', 'not-a-uuid', `${actor}\r\nX-Forged: yes`]) {
    const headers = createVisitorActorHeaders({ userId, email: 'private-admin@example.test', actor: forgedActor });
    assert.equal(headers['X-Admin-Actor'], 'verified-admin');
    assert.equal(headers['X-Admin-Action'], 'visitor_read');
    assert.equal(headers['X-Admin-Export-Format'], undefined);
    assert.match(headers['X-Admin-Request-Id'], uuid);
    assert.doesNotMatch(JSON.stringify(headers), /@|private-admin|X-Forged/);
  }
});

for (const route of routes) {
  test(`${route}: read attribution ignores browser claims and gets a fresh request ID`, async () => {
    const requests = [];
    const serve = handler(route, { fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), headers: options.headers }); return emptyPage();
    } });
    for (const view of ['events', 'visits']) {
      const res = response();
      await serve(request({ view }), res);
      assert.equal(res.statusCode, 200);
    }
    for (const { url, headers } of requests) {
      assert.equal(url.origin, 'https://analytics.example.test');
      assert.equal(url.searchParams.has('actor'), false);
      assert.equal(url.searchParams.has('userId'), false);
      assert.equal(headers['X-Admin-Actor'], actor);
      assert.equal(headers['X-Admin-Action'], 'visitor_read');
      assert.equal(headers['X-Admin-Export-Format'], undefined);
      assert.match(headers['X-Admin-Request-Id'], uuid);
      assert.notEqual(headers['X-Admin-Request-Id'], forgedActor);
      assert.equal(headers['X-Internal-Token'], 'fixture-internal-token');
      assert.deepEqual(Object.keys(headers).sort(), ['Accept', 'X-Admin-Action', 'X-Admin-Actor', 'X-Admin-Request-Id', 'X-Internal-Token']);
      assert.doesNotMatch(JSON.stringify(headers), /private-admin|browser-session|forged-internal/);
    }
    assert.notEqual(requests[0].headers['X-Admin-Request-Id'], requests[1].headers['X-Admin-Request-Id']);
  });

  test(`${route}: missing verified userId uses a non-identifying fallback despite spoofed headers`, async () => {
    const requests = [];
    const res = response();
    await handler(route, { auth: { email: 'private-admin@example.test' }, fetchImpl: async (_url, options) => {
      requests.push(options.headers); return emptyPage();
    } })(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(requests[0]['X-Admin-Actor'], 'verified-admin');
    assert.doesNotMatch(JSON.stringify(requests[0]), /@|private-admin/);
  });

  test(`${route}: denied or unavailable authorization never fetches`, async () => {
    let calls = 0;
    for (const status of [401, 403, 503]) for (const format of [undefined, 'csv', 'json']) {
      const res = response();
      await handler(route, { auth: null, status, fetchImpl: async () => { calls++; return emptyPage(); } })(request({ format }), res);
      assert.equal(res.statusCode, status);
    }
    assert.equal(calls, 0);
  });
}

for (const format of ['csv', 'json']) test(`${format} export: every page shares server actor, action, format and request ID`, async () => {
  const requests = [];
  let active = 0, peak = 0;
  const serve = handler('visitors', { fetchImpl: async (url, options) => {
    const parsed = new URL(url), page = Number(parsed.searchParams.get('page'));
    requests.push({ url: parsed, headers: { ...options.headers } });
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return new Response(JSON.stringify({
      from: '2026-11-09T00:00:00Z', to: '2026-11-10T00:00:00Z',
      items: Array.from({ length: page === 6 ? 50 : 100 }, (_, i) => ({ eventId: `sample-${page * 100 + i}`, eventName: 'page_view' })),
      page: { totalElements: 650 },
    }));
  } });
  const requestIds = [];
  for (let invocation = 0; invocation < 2; invocation++) {
    requests.length = 0;
    const res = response();
    await serve(request({ format, view: 'visits', hours: '24' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['X-Export-Row-Count'], '650');
    assert.equal(requests.length, 7);
    assert.ok(peak > 1 && peak <= 5, 'existing bounded export concurrency is preserved');
    const requestId = requests[0].headers['X-Admin-Request-Id'];
    assert.match(requestId, uuid);
    requestIds.push(requestId);
    for (const { url, headers } of requests) {
      assert.equal(url.pathname, '/api/admin/visitors');
      assert.equal(headers['X-Admin-Actor'], actor);
      assert.equal(headers['X-Admin-Action'], 'visitor_export');
      assert.equal(headers['X-Admin-Export-Format'], format);
      assert.equal(headers['X-Admin-Request-Id'], requestId);
      assert.equal(headers['X-Internal-Token'], 'fixture-internal-token');
      assert.doesNotMatch(JSON.stringify(headers), /private-admin|browser-session/);
      if (url.searchParams.get('page') !== '0') {
        assert.equal(url.searchParams.get('from'), '2026-11-09T00:00:00Z');
        assert.equal(url.searchParams.get('to'), '2026-11-10T00:00:00Z');
        assert.equal(url.searchParams.has('hours'), false);
      }
    }
    assert.notEqual(requestId, forgedActor);
  }
  assert.notEqual(requestIds[0], requestIds[1]);
});
