import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../pages/api/admin/visitors.js', import.meta.url), 'utf8'), {
  filename: 'visitors.js', jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' }, module: { type: 'commonjs' },
});
function handler(allowed) {
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name.includes('agentServiceProxy')) return { requireAdminUser: async (_req, res) => {
      if (allowed) return { role: 'ADMIN' };
      res.status(401).json({ error: 'unauthorized' }); return null;
    } };
    if (name.includes('supabaseServer')) return { supabaseServer: { from: () => { throw new Error('Unexpected content lookup'); } } };
    if (name.includes('analyticsHostFilter')) return { isLoopbackUrl: () => false };
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  return exports.default;
}
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}
test('grouped and raw views retain admin gate, bounded routing, metadata and raw export', async () => {
  const originalFetch = globalThis.fetch, previousToken = process.env.ANALYTICS_SERVICE_TOKEN;
  process.env.ANALYTICS_SERVICE_TOKEN = 'test-only-token';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(new URL(url));
    assert.equal(options.headers['X-Internal-Token'], 'test-only-token');
    return new Response(JSON.stringify({ items: [{ eventId: 'sample', pageUrl: '/', visit: { eventCount: 5, maxProgressPercent: 100 } }], page: { totalElements: 1 } }));
  };
  try {
    const unauthorized = response();
    await handler(false)({ method: 'GET', query: { view: 'visits' } }, unauthorized);
    assert.equal(unauthorized.statusCode, 401); assert.equal(requests.length, 0);
    const serve = handler(true), res = response();
    await serve({ method: 'GET', query: { view: 'visits', sessionId: 'sample-session', page: '0', size: '25', arbitrary: 'no' } }, res);
    assert.equal(requests[0].pathname, '/api/admin/visitor-visits');
    assert.equal(requests[0].searchParams.get('sessionId'), 'sample-session');
    assert.equal(requests[0].searchParams.has('view'), false); assert.equal(requests[0].searchParams.has('arbitrary'), false);
    assert.equal(res.body.items[0].visit.maxProgressPercent, 100); assert.match(res.headers['Cache-Control'], /no-store/);
    await serve({ method: 'GET', query: { view: 'events' } }, response());
    assert.equal(requests[1].pathname, '/api/admin/visitors');
    const invalid = response(); await serve({ method: 'GET', query: { view: '../../public' } }, invalid);
    assert.equal(invalid.statusCode, 400); assert.equal(requests.length, 2);
    const exported = response(); await serve({ method: 'GET', query: { view: 'visits', format: 'json' } }, exported);
    assert.equal(requests[2].pathname, '/api/admin/visitors', 'Exports always preserve raw events');
    assert.equal(exported.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.ANALYTICS_SERVICE_TOKEN;
    else process.env.ANALYTICS_SERVICE_TOKEN = previousToken;
  }
});
