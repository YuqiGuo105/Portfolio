import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPlaygroundHandler, PlaygroundError, publicationSteps, runPlayground, validateScenario } from '../src/lib/mcpPlayground.mjs';

const project = { type: 'PROJECT', title: 'Event pipeline', summary: 'Kafka and transactional outbox.', url: 'https://www.yuqi.site/work-single/project-1', tags: ['Kafka'] };
const article = { ...project, type: 'BLOG', title: 'Kubernetes', url: 'https://www.yuqi.site/blog-single/article-1' };
const contract = '<table><tr><th>Stage</th><th>Responsibility</th><th>Guarantee</th></tr><tr><td>Commit</td><td>Source &amp; outbox</td><td><strong>Atomic</strong> transaction<script>alert(1)</script></td></tr></table>';
const rpc = (id, data, extra = {}) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], ...extra } });
const upstream = (data, capture = () => {}) => async (url, options) => {
  const request = JSON.parse(options.body); capture(url, options, request);
  return Response.json(rpc(request.id, data));
};

test('only the three fixed scenarios are accepted; no arbitrary tool, query, URL or prototype names', () => {
  for (const scenario of ['projects', 'kubernetes', 'publishing']) assert.equal(validateScenario({ scenario }), scenario);
  for (const body of [null, [], 'projects', {}, { scenario: '__proto__' }, { scenario: 'constructor' }, { scenario: 'get_profile' }, { scenario: 'projects', tool: 'admin.publish_content' }, { scenario: 'projects', query: 'private' }, { scenario: 'projects', url: 'http://localhost' }]) {
    assert.throws(() => validateScenario(body), { code: 'invalid_scenario' });
  }
});

test('project example calls the fixed public MCP tool, without cookies or authorization', async () => {
  let called = 0;
  const result = await runPlayground('projects', { fetchImpl: upstream({ results: [project], secret: 'hidden' }, (url, options, request) => {
    called++;
    assert.equal(url, 'https://www.yuqi.site/mcp');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    assert.equal(request.method, 'tools/call');
    assert.deepEqual(request.params, { name: 'search_portfolio', arguments: { query: 'distributed systems', types: ['PROJECT'], limit: 3 } });
  }) });
  assert.equal(called, 1); assert.equal(result.status, 'complete');
  assert.equal(result.items[0].title, project.title); assert.equal(result.calls[0].name, 'search_portfolio');
  assert.ok(result.elapsedMs >= 1); assert.ok(result.retrievedAt);
  assert.ok(!JSON.stringify(result).includes('hidden'));
});

test('article example requests only technical articles with a bounded result count', async () => {
  const result = await runPlayground('kubernetes', { fetchImpl: upstream({ articles: Array(8).fill(article) }, (_url, _opts, request) => {
    assert.deepEqual(request.params, { name: 'search_articles', arguments: { keyword: 'Kubernetes', sourceType: 'BLOG', limit: 3 } });
  }) });
  assert.equal(result.items.length, 3);
});

test('publishing reads the existing project and parses authored table rows without generating or writing', async () => {
  const result = await runPlayground('publishing', { fetchImpl: upstream({ ...project, body: contract, adminNotes: 'SECRET' }, (_url, _opts, request) => {
    assert.equal(request.params.name, 'get_project');
    assert.equal(request.params.arguments.projectId, '8edf9020-39b6-4db4-83b3-43c459bef1cf');
  }) });
  assert.deepEqual(result.steps, [{ title: 'Commit', responsibility: 'Source & outbox', guarantee: 'Atomic transaction' }]);
  assert.equal(result.status, 'complete');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.ok(!JSON.stringify(result).includes('<table>'));
  assert.deepEqual(publicationSteps('<table><tr><td>Unrelated table</td></tr></table>'), []);
});

test('missing publication table is honestly partial, never synthesized', async () => {
  const result = await runPlayground('publishing', { fetchImpl: upstream({ ...project, body: '<p>New project format</p>' }) });
  assert.equal(result.status, 'partial'); assert.deepEqual(result.steps, []);
});

test('restricted metadata remains linkable, but its body never appears in output or trace', async () => {
  const result = await runPlayground('publishing', { fetchImpl: upstream({ ...project, sourceRequiresLogin: true, body: contract.replace('Commit', 'PRIVATE') }) });
  assert.equal(result.items[0].sourceRequiresLogin, true);
  assert.equal(result.sources.length, 1); assert.deepEqual(result.steps, []);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('result URLs reject offsite links, credentials, query tokens and admin paths', async () => {
  for (const url of ['https://evil.test/work-single/x', 'javascript:alert(1)', 'https://user:pass@www.yuqi.site/work-single/x', 'https://www.yuqi.site/admin', 'https://www.yuqi.site/work-single/x?token=secret', 'https://www.yuqi.site/work-single/x#secret']) {
    const result = await runPlayground('projects', { fetchImpl: upstream({ results: [{ ...project, url }] }) });
    assert.deepEqual(result.sources, []); assert.deepEqual(result.items, []);
  }
});

test('an empty search is a successful empty state', async () => {
  const result = await runPlayground('projects', { fetchImpl: upstream({ results: [] }) });
  assert.equal(result.status, 'empty'); assert.equal(result.calls[0].status, 'completed');
});

test('SSE accepts chunked CRLF frames, ignores notifications, and closes on the matching response', async () => {
  let cancelled = false;
  const result = await runPlayground('projects', { fetchImpl: async (_url, options) => {
    const { id } = JSON.parse(options.body);
    const frame = `: keepalive\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\r\n\r\nevent: message\r\ndata: ${JSON.stringify(rpc(id, { results: [project] }))}\r\n\r\n`;
    return new Response(new ReadableStream({
      start(controller) { for (let i = 0; i < frame.length; i += 17) controller.enqueue(new TextEncoder().encode(frame.slice(i, i + 17))); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  assert.equal(result.status, 'complete'); assert.equal(cancelled, true);
});

test('supports structured MCP results and trailing SSE frames without a blank line', async () => {
  const result = await runPlayground('projects', { fetchImpl: async (_url, options) => {
    const { id } = JSON.parse(options.body);
    return new Response(`data: ${JSON.stringify(rpc(id, {}, { structuredContent: { results: [project] } }))}`, { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  assert.equal(result.items.length, 1);
});

test('rejects MCP failures, mismatched IDs, malformed responses and oversized payloads', async () => {
  const responses = [
    id => rpc(id, { error: 'private upstream detail' }),
    id => rpc(id, {}, { isError: true }),
    id => ({ jsonrpc: '2.0', id, error: { message: 'private upstream detail' } }),
    () => rpc('wrong-id', { results: [project] }),
    id => rpc(id, { results: 'wrong-shape' }),
    id => rpc(id, { results: [], excess: 'x'.repeat(140_000) }),
  ];
  for (const make of responses) await assert.rejects(runPlayground('projects', { fetchImpl: async (_url, options) => Response.json(make(JSON.parse(options.body).id)) }), error => error instanceof PlaygroundError && !error.message.includes('private'));
  await assert.rejects(runPlayground('projects', { fetchImpl: async () => new Response('<html>bad</html>', { headers: { 'Content-Type': 'text/html' } }) }), { code: 'invalid_result' });
});

test('upstream HTTP failures are bounded and never automatically retried', async () => {
  let calls = 0;
  await assert.rejects(runPlayground('projects', { fetchImpl: async () => { calls++; return new Response('secret', { status: 429 }); } }), { code: 'upstream_busy', status: 503 });
  assert.equal(calls, 1);
});

test('deadline and cancellation abort the upstream request', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(runPlayground('projects', { fetchImpl, timeoutMs: 10 }), { code: 'timeout', status: 504 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runPlayground('projects', { fetchImpl, signal: controller.signal }), { code: 'unavailable' });
});

function response() {
  return Object.assign(new EventEmitter(), {
    headers: {}, statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; this.writableEnded = true; return this; },
  });
}
const request = () => ({ method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:3104', origin: 'http://localhost:3104' }, body: { scenario: 'projects' }, socket: { remoteAddress: '127.0.0.1' } });

test('API rejects bad methods, origins, content types and payloads before tool execution', async () => {
  let called = false;
  const handler = createPlaygroundHandler({ isRateLimited: async () => false, run: async () => { called = true; } });
  for (const [change, expected] of [
    [req => { req.method = 'GET'; }, 405],
    [req => { req.headers.origin = 'https://evil.test'; }, 403],
    [req => { req.headers.origin = 'not-a-url'; }, 403],
    [req => { req.headers['sec-fetch-site'] = 'cross-site'; }, 403],
    [req => { req.headers['content-type'] = 'text/plain'; }, 415],
    [req => { req.body.tool = 'admin.publish_content'; }, 400],
  ]) {
    const req = request(); const res = response(); change(req); await handler(req, res);
    assert.equal(res.statusCode, expected); assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(called, false);
});

test('API enforces per-IP and global budgets, with Retry-After and no tool call when limited', async () => {
  for (const limitedScope of ['mcp-playground', 'mcp-playground-global']) {
    let called = false; const buckets = [];
    const handler = createPlaygroundHandler({ isRateLimited: async (ip, scope, options) => { buckets.push({ ip, scope, options }); return scope === limitedScope; }, run: async () => { called = true; } });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 429); assert.equal(res.headers['Retry-After'], '60'); assert.equal(called, false);
    assert.deepEqual(buckets[0].options, { limit: 6, windowMs: 60_000 });
    if (limitedScope.endsWith('global')) assert.deepEqual(buckets[1].options, { limit: 60, windowMs: 60_000 });
  }
});

test('API returns a real result, strips exceptions, and does not forward request credentials', async () => {
  const req = request(); req.headers.authorization = 'SECRET'; req.headers.cookie = 'SECRET';
  const handler = createPlaygroundHandler({ isRateLimited: async () => false, run: async (scenario, options) => {
    assert.equal(scenario, 'projects'); assert.deepEqual(Object.keys(options), ['signal']); return { status: 'complete' };
  } });
  const res = response(); await handler(req, res); assert.deepEqual(res.body, { status: 'complete' });
  const broken = createPlaygroundHandler({ isRateLimited: async () => false, run: async () => { throw new Error('SECRET'); } });
  const failed = response(); await broken(request(), failed);
  assert.equal(failed.statusCode, 503); assert.deepEqual(failed.body, { error: 'unavailable' });
});

test('API cancels work when the browser disconnects', async () => {
  const res = response();
  const handler = createPlaygroundHandler({ isRateLimited: async () => false, run: async (_scenario, { signal }) => {
    res.destroyed = true; res.emit('close'); assert.equal(signal.aborted, true);
    throw new PlaygroundError('unavailable');
  } });
  await handler(request(), res); assert.equal(res.body, undefined); assert.equal(res.listenerCount('close'), 0);
});

test('disconnecting during the rate-limit check cannot start a tool call later', async () => {
  const res = response(); let called = false;
  const handler = createPlaygroundHandler({ isRateLimited: async () => {
    res.destroyed = true; res.emit('close'); return false;
  }, run: async () => { called = true; } });
  await handler(request(), res);
  assert.equal(called, false); assert.equal(res.body, undefined); assert.equal(res.listenerCount('close'), 0);
});
