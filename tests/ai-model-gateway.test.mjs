import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { CHEAP_TEXT_MODEL, createModelGateway, quoteRequest, qwenRequest } from '../services/voice/modelGateway.mjs';
import { SpendDenied } from '../src/lib/voice/spendGuard.mjs';

const secret = 'test-only-internal-gateway-secret';
const body = { systemInstruction: { parts: [{ text: 'Return only JSON.' }] },
  contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
  generationConfig: { maxOutputTokens: 128, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' } };
const env = { AI_GATEWAY_TOKEN: secret, QWEN_TEXT_API_KEY: 'test-private-qwen', QWEN_LIVE_WORKSPACE_ID: 'test-workspace', GEMINI_API_KEY: 'test-private-google' };
test('default text candidate is the pinned low-cost model with no hidden thinking or fallback', () => {
  const request = qwenRequest(body, true);
  assert.equal(request.model, CHEAP_TEXT_MODEL);
  assert.equal(request.enable_thinking, false);
  assert.equal(request.max_completion_tokens, 128);
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.equal(request.stream_options.include_usage, true);
  assert.equal(quoteRequest(CHEAP_TEXT_MODEL, 'generateContent', body).provider, 'qwen');
});
test('unpriced models and unbounded inputs are rejected before provider access', () => {
  for (const request of [
    { ...body, tools: [{ google_search: {} }] },
    { ...body, cached_content: 'remote-context' },
    { ...body, generationConfig: { maxOutputTokens: 100000 } },
    { ...body, contents: [{ parts: [{ fileData: { fileUri: 'https://example.com/private' } }] }] },
    { ...body, generationConfig: { ...body.generationConfig, candidate_count: 99 } },
    { ...body, model: 'qwen3.8-max' },
    { ...body, contents: {} },
  ]) assert.throws(() => quoteRequest(CHEAP_TEXT_MODEL, 'generateContent', request), SpendDenied);
  assert.throws(() => quoteRequest('qwen3.8-max', 'generateContent', body), SpendDenied);
});
async function fixture({ denied = false, fail = false, streaming = false, frames, settleWait } = {}) {
  const calls = [], charges = [], reservations = [];
  const handler = createModelGateway({ env,
    spend: { reserve: async (...args) => { if (denied) throw new SpendDenied('monthly_limit'); reservations.push(args); return { settle: async charge => { if (settleWait) await settleWait; charges.push(charge); } }; } },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (fail) return new Response('private upstream error', { status: 402 });
      const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
      if (streaming) return new Response(frames ?? `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
      return Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage });
    },
  });
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { calls, charges, reservations,
    request: (token = secret, data = body) => fetch(`http://127.0.0.1:${server.address().port}/ai/v1beta/models/${CHEAP_TEXT_MODEL}:${streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, { method: 'POST', headers: { 'x-goog-api-key': token }, body: JSON.stringify(data) }),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
test('authentication and budget denial make zero paid calls', async () => {
  const f = await fixture({ denied: true });
  try {
    assert.equal((await f.request('invalid')).status, 401);
    assert.equal((await f.request()).status, 429);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
test('synchronous Qwen response preserves the current Java response contract and settles usage', async () => {
  const f = await fixture();
  try {
    const response = await f.request();
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.candidates[0].content.parts[0].text, '{"ok":true}');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer test-private-qwen');
    assert.equal(f.calls[0].url, 'https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.deepEqual(f.charges, [36]);
  } finally { await f.close(); }
});
test('streaming responses include deltas and final usage without model retries', async () => {
  const f = await fixture({ streaming: true });
  try {
    const response = await f.request();
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Hello/);
    assert.deepEqual(f.charges, [36]);
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('upstream rejection retains the reservation, hides private errors, and never switches provider', async () => {
  const f = await fixture({ fail: true });
  try {
    const response = await f.request();
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private upstream|test-private/);
    assert.deepEqual(f.charges, [null]);
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});

test('response remains open until the accounting write completes', async () => {
  let release;
  const settleWait = new Promise(resolve => { release = resolve; });
  const f = await fixture({ streaming: true, settleWait });
  try {
    const response = await f.request();
    let ended = false;
    const output = response.text().then(value => { ended = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(ended, false);
    release();
    assert.match(await output, /Hello/);
    assert.deepEqual(f.charges, [36]);
  } finally { release(); await f.close(); }
});

test('truncated streams and invalid billing metadata retain the whole reservation', async () => {
  for (const frames of [
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"total_tokens":2}}\n\ndata: {',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"total_tokens":2}}\n\n',
  ]) {
    const f = await fixture({ streaming: true, frames });
    try {
      try { const response = await f.request(); await response.text(); } catch { /* A stream error destroys the connection. */ }
      assert.deepEqual(f.charges, [null]);
    } finally { await f.close(); }
  }
});
