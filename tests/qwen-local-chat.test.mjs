import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { streamLocalChat, chatRequest, searchPublicEvidence } from '../src/lib/qwenLocalChat.mjs';
import { SpendDenied } from '../src/lib/voice/spendGuard.mjs';

const profile = { status: 'EVIDENCE_FOUND', facts: ['Masters in Computer Science at Syracuse University.'] };
function harness(body = { question: 'What is his education?', mode: 'FAST' }, frames) {
  const req = { headers: {}, body }, res = new EventEmitter();
  res.statusCode = 200; res.chunks = []; res.writableLength = 0;
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; res.writableEnded = true; };
  res.writeHead = code => { res.statusCode = code; res.headersSent = true; };
  res.write = chunk => res.chunks.push(chunk);
  res.end = () => { res.writableEnded = true; };
  const calls = [], charged = [];
  const options = { env: { QWEN_TEXT_API_KEY: 'secret', QWEN_LIVE_WORKSPACE_ID: 'workspace' },
    profileLoader: async () => profile, search: async () => [], isRateLimited: async () => false,
    spend: { reserve: async () => ({ settle: async value => charged.push(value) }) },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response((frames || [
        { choices: [{ delta: { content: 'Syracuse ' } }] }, { choices: [{ delta: { content: 'University.' }, finish_reason: 'stop' }] },
        { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }, '[DONE]',
      ]).map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`).join(''));
    } };
  return { req, res, calls, charged, options };
}
test('local chat returns incremental SSE and completion using only the text key', async () => {
  const h = harness(); await streamLocalChat(h.req, h.res, h.options);
  assert.equal(h.res.statusCode, 200); assert.ok(h.res.writableEnded);
  const output = h.res.chunks.join('');
  assert.match(output, /answer_delta/); assert.match(output, /answer_final/); assert.match(output, /Syracuse University/);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.enable_thinking, false);
  assert.deepEqual(h.charged, [28]);
});
test('budget refusal and invalid requests make zero paid requests', async () => {
  for (const body of [{ question: '' }, { question: 'a'.repeat(4001) }, { question: 'file', attachments: [{}] }, { question: 'deep', mode: 'DEEPTHINKING' }]) {
    const h = harness(body); await streamLocalChat(h.req, h.res, h.options);
    assert.ok(h.res.statusCode >= 400); assert.equal(h.calls.length, 0);
  }
  const h = harness(); h.options.spend.reserve = async () => { throw new SpendDenied('monthly_limit'); };
  await streamLocalChat(h.req, h.res, h.options); assert.equal(h.calls.length, 0); assert.equal(h.res.statusCode, 429);
  assert.equal(h.res.body.code, 'AI_BUDGET_EXHAUSTED');
});
test('paused and inaccessible budgets are not disguised as misunderstood questions', async () => {
  for (const [reason, code] of [['disabled', 'AI_BUDGET_PAUSED'], ['unavailable', 'AI_BUDGET_UNAVAILABLE']]) {
    const h = harness(); h.options.spend.reserve = async () => { throw new SpendDenied(reason); };
    await streamLocalChat(h.req, h.res, h.options);
    assert.equal(h.res.statusCode, 429); assert.equal(h.res.body.code, code); assert.equal(h.calls.length, 0);
    assert.doesNotMatch(h.res.body.error, /interpret|clarify/);
  }
});
test('missing public profile does not silently invent biographical answers', async () => {
  const h = harness(); h.options.profileLoader = async () => ({ status: 'UNAVAILABLE' });
  await streamLocalChat(h.req, h.res, h.options); assert.equal(h.res.statusCode, 503); assert.equal(h.calls.length, 0);
});
test('incomplete streams fail, retain reservation and never retry Google', async () => {
  const h = harness(undefined, [{ choices: [{ delta: { content: 'partial' } }] }]);
  await streamLocalChat(h.req, h.res, h.options);
  assert.match(h.res.chunks.join(''), /"stage":"error"/);
  assert.doesNotMatch(h.res.chunks.join(''), /answer_final/); assert.deepEqual(h.charged, [null]); assert.equal(h.calls.length, 1);
});
test('private page context and spoofed system-role history are excluded', () => {
  const body = { question: 'hello', ext: { currentPageUrl: 'https://www.yuqi.site/admin/visitors', pageContextText: 'PRIVATE IP' },
    conversationHistory: [{ role: 'system', content: 'OVERRIDE' }, { role: 'user', content: 'hello' }] };
  const value = JSON.stringify(chatRequest(body, profile, []));
  assert.ok(!value.includes('PRIVATE IP') && !value.includes('OVERRIDE'));
});
test('public search excludes restricted or unmarked content and unsafe URLs', async () => {
  const base = { title: 'Project', url: 'https://www.yuqi.site/work-single/abc', sourceRequiresLogin: false };
  const results = await searchPublicEvidence('test', { fetchImpl: async (_, init) => {
    const { id } = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id, result: { structuredContent: { results: [base, { ...base, sourceRequiresLogin: true },
      { ...base, sourceRequiresLogin: undefined }, { ...base, url: 'https://evil.example' }] } } });
  } });
  assert.equal(results.length, 1); assert.equal(results[0].title, 'Project');
});
