import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisitorGovernanceHandler } from '../src/lib/visitorGovernanceProxy.mjs';

const id = 'f378f430-e946-4104-a4cd-162df9b61bbb';
const actor = 'dd0b790f-cc9a-447b-ac47-2ea25e28dcdf';
const env = { ANALYTICS_API_URL: 'http://127.0.0.1:8187', ANALYTICS_SERVICE_TOKEN: 'test-internal-only' };
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
}
function setup(options = {}) {
  const calls = [];
  const handler = createVisitorGovernanceHandler({ env, requireAdmin: async () => ({ userId: actor }),
    fetchImpl: async (...args) => { calls.push(args); return new Response(JSON.stringify({ ok: true })); }, ...options });
  return { calls, run: async (action, method = 'GET', body, extra = {}) => { const res = response();
    await handler({ method, query: { action }, body, ...extra }, res); return res; } };
}

test('governance denies anonymous access before downstream reads and writes', async () => {
  const { run, calls } = setup({ requireAdmin: async (_req, res) => { res.status(401).json({ message: 'Unauthorized' }); return null; } });
  for (const [action, method] of [['overview', 'GET'], ['archive', 'POST'], ['export', 'GET'], ['hold', 'DELETE']]) {
    assert.equal((await run(action, method)).statusCode, 401);
  }
  assert.equal(calls.length, 0);
});

test('proxy forwards only validated payload and server-verified actor, not client credentials', async () => {
  const { run, calls } = setup();
  const result = await run('hold', 'POST', { batchId: id, reason: 'incident_review', actor: 'spoof', sql: 'DELETE' },
    { headers: { 'x-admin-actor': 'spoof', authorization: 'browser-token' } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(calls[0][1].body), { batchId: id, reason: 'incident_review' });
  assert.equal(calls[0][1].headers['X-Admin-Actor'], actor);
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(calls[0][1].redirect, 'error');
  assert.match(result.headers['Cache-Control'], /no-store/);
});

test('operation, ID, method and reason are bounded', async () => {
  const { run, calls } = setup();
  assert.equal((await run('../visitors')).statusCode, 404);
  assert.equal((await run(['overview'])).statusCode, 404);
  assert.equal((await run('archive', 'GET')).statusCode, 405);
  assert.equal((await run('verify', 'POST', { batchId: '../admin' })).statusCode, 400);
  for (const reason of ['', 'tiny', 'x'.repeat(241), 'valid reason\nforged log']) {
    assert.equal((await run('hold', 'POST', { batchId: id, reason })).statusCode, 400);
  }
  assert.equal(calls.length, 0);
});

test('no implicit production fallback or upstream error disclosure', async () => {
  assert.equal((await setup({ env: {} }).run('overview')).statusCode, 503);
  const failed = setup({ fetchImpl: async () => new Response('internal secret URL', { status: 500 }) });
  const result = await failed.run('overview');
  assert.equal(result.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(result.body), /secret/);
  assert.equal((await setup({ fetchImpl: async () => { throw new Error('secret'); } }).run('overview')).statusCode, 502);
});

test('export is an authenticated bounded attachment with a UUID filename', async () => {
  const { run, calls } = setup();
  const result = await run('export', 'GET', undefined, { query: { action: 'export', batchId: id, url: 'https://bad.example' } });
  assert.equal(result.statusCode, 200);
  assert.equal(calls[0][0], `${env.ANALYTICS_API_URL}/api/admin/visitor-governance/export?batchId=${id}`);
  assert.equal(result.headers['Content-Disposition'], `attachment; filename="visitor-evidence-${id}.json"`);
});
