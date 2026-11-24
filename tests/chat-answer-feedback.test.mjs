import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  agentRunSource, createFeedbackAdminHandler, createFeedbackHandler, exportLine, freezeRun, memoryFeedbackStore,
  pagePath, supabaseFeedbackStore, validRunId, validSessionId,
} from '../src/lib/chat/answerFeedback.mjs';

const RUN = '3f44067a-278f-4ce3-8780-2a00379dda15', SESSION = '29df378a-8bed-47d3-bd81-038b8a7053b5';
// A run as the agent service returns it from /api/admin/conversations.
const run = (over = {}) => ({
  runId: RUN, question: 'How is the platform built?', answer: 'A Next.js site in front of Java services.', route: 'KNOWLEDGE_QA',
  status: 'completed', startedAt: '2026-11-24T04:01:32Z', completedAt: '2026-11-24T04:01:37Z', latencyMs: 5057,
  sessionId: SESSION, conversationId: 'conv_5f7aa34db97c', steps: [
    { type: 'safety.check_completed', status: 'pass', detail: { model: 'gemini-2.5-flash-lite', verdict: 'PASS', category: 'SAFE', checkType: 'input', promptVersion: 'input_safety_v6' } },
    { type: 'retrieval.completed', status: 'success', detail: { query: 'How is the platform built?', retrievalStrategy: 'supabase_current_lexical', zeroHit: false, sources: [
      { url: 'https://www.yuqi.site/work-single/a', title: 'Portfolio Platform', chunkId: 'c1', documentId: 'd1', sourceType: 'PROJECT', score: 0.6 },
      { url: 'https://www.yuqi.site/work-single/a', title: 'Portfolio Platform', chunkId: 'c2', documentId: 'd1', sourceType: 'PROJECT', score: 0.3 },
      { url: 'https://www.yuqi.site/work-single/a', title: 'Portfolio Platform', chunkId: 'c1', documentId: 'd1', sourceType: 'PROJECT', score: 0.6 }] } },
    { type: 'model_call.completed', status: 'success', detail: { model: 'gemini-2.5-flash-lite', provider: 'google', usage: { costUsd: 0.0005351, inputTokens: 4675, outputTokens: 169 }, promptVersion: 'portfolio_assistant_v5' } },
    { type: 'safety.check_completed', status: 'pass', detail: { model: 'gemini-2.5-flash-lite', verdict: 'PASS', category: 'SAFE', checkType: 'output_ctx', promptVersion: 'output_context_safety_v4' } },
  ], ...over,
});
function reply() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  res.send = body => { res.body = body; return res; };
  return res;
}
const post = body => ({ method: 'POST', body, headers: {} });
function setup({ found = run(), configured = true, ...options } = {}) {
  const store = memoryFeedbackStore(), lookups = [];
  const runs = { configured, async find(id, hours) { lookups.push(hours); return typeof found === 'function' ? found(id, hours, lookups.length) : found; } };
  return { store, lookups, handler: createFeedbackHandler({ runs, store, settleMs: 0, ...options }) };
}

test('a rated answer is stored as the agent recorded it, with what an audit asks first', () => {
  const row = freezeRun(run(), { verdict: 'down', page: '/work-single/abc?utm=x#top' });
  assert.equal(row.run_id, RUN);
  assert.equal(row.verdict, 'down');
  assert.deepEqual([row.question, row.answer, row.route, row.status, row.latency_ms], ['How is the platform built?', 'A Next.js site in front of Java services.', 'KNOWLEDGE_QA', 'completed', 5057]);
  assert.deepEqual(row.models, ['gemini-2.5-flash-lite']);
  assert.deepEqual(row.prompt_versions, ['input_safety_v6', 'portfolio_assistant_v5', 'output_context_safety_v4'], 'in the order the run used them');
  assert.equal(row.source_count, 2, 'a chunk retrieved twice is one source');
  assert.equal(row.cost_usd, 0.000535);
  assert.equal(row.page_path, '/work-single/abc', 'the page, never its query string');
  assert.equal(row.answered_at, '2026-11-24T04:01:37Z');
  assert.deepEqual(row.run.steps, run().steps, 'every recorded step is kept');
  assert.equal(pagePath('https://evil.example/x'), null);
  assert.equal(pagePath(undefined), null);

  // An absurdly large run still stores its question and answer.
  const huge = freezeRun(run({ steps: Array.from({ length: 400 }, () => ({ type: 'tool_call.completed', detail: { output: 'x'.repeat(2000) } })) }), { verdict: 'up' });
  assert.deepEqual([huge.run.steps.length, huge.run.stepsTruncated], [0, 400]);
  assert.ok(JSON.stringify(huge.run).length < 400_000);
  assert.equal(freezeRun(run({ answer: 'y'.repeat(70_000) }), { verdict: 'up' }).answer.length, 60_000);
});

test('a visitor can rate only a run their own session received, and only its ID travels', async () => {
  const { handler, store, lookups } = setup();
  const liked = reply();
  await handler(post({ runId: RUN, verdict: 'up', sessionId: SESSION, page: '/' }), liked);
  assert.deepEqual([liked.statusCode, liked.body], [200, { saved: true, verdict: 'up' }]);
  assert.equal(liked.headers['cache-control'], 'private, no-store');
  assert.deepEqual(lookups, [48], 'found in the last two days: one lookup');
  const stored = store.rows.get(RUN);
  assert.equal(stored.answer, run().answer, 'the answer comes from the agent record');
  const firstRated = stored.rated_at;

  // Text sent by the browser is ignored: there is nowhere for it to go.
  const forged = reply();
  await handler(post({ runId: RUN, verdict: 'down', sessionId: SESSION, answer: 'forged', question: 'forged', run: { answer: 'forged' } }), forged);
  assert.equal(forged.statusCode, 200);
  assert.deepEqual([store.rows.size, store.rows.get(RUN).verdict, store.rows.get(RUN).answer], [1, 'down', run().answer], 'a new verdict replaces the old one');
  assert.equal(store.rows.get(RUN).rated_at, firstRated, 'the first rating time is kept');

  // Another session, and a run that does not exist, get the same answer.
  const other = setup();
  const stranger = reply(), unknown = reply();
  await other.handler(post({ runId: RUN, verdict: 'up', sessionId: 'another-session-000' }), stranger);
  const none = setup({ found: null });
  await none.handler(post({ runId: RUN, verdict: 'up', sessionId: SESSION }), unknown);
  assert.deepEqual([stranger.statusCode, stranger.body], [404, { error: 'unknown_run' }]);
  assert.deepEqual([unknown.statusCode, unknown.body], [404, { error: 'unknown_run' }]);
  assert.equal(other.store.rows.size + none.store.rows.size, 0);
  assert.deepEqual(none.lookups, [48, 720], 'an older run is looked for once more, in the full month');

  // Taking it back removes the row, but only for the session that rated.
  const notMine = reply(), mine = reply();
  await handler(post({ runId: RUN, verdict: null, sessionId: 'another-session-000' }), notMine);
  assert.equal(store.rows.size, 1);
  await handler(post({ runId: RUN, verdict: null, sessionId: SESSION }), mine);
  assert.deepEqual([mine.statusCode, mine.body, store.rows.size], [200, { saved: true, verdict: null }, 0]);
});

test('a rating that arrives before the answer is recorded waits once; bad input never reaches the agent', async () => {
  // First lookup: the run has started but has no answer yet.
  const early = setup({ found: (id, hours, call) => (call === 1 ? run({ answer: null }) : run()) });
  const res = reply();
  await early.handler(post({ runId: RUN, verdict: 'up', sessionId: SESSION }), res);
  assert.deepEqual([res.statusCode, early.lookups, early.store.rows.size], [200, [48, 48], 1]);

  const blocked = setup({ found: run({ answer: null, status: 'blocked' }) });
  const nothing = reply();
  await blocked.handler(post({ runId: RUN, verdict: 'down', sessionId: SESSION }), nothing);
  assert.deepEqual([nothing.statusCode, nothing.body, blocked.store.rows.size], [409, { error: 'nothing_to_rate' }, 0]);

  for (const body of [{}, null, 'x', { runId: 'nope', verdict: 'up', sessionId: SESSION }, { runId: RUN, verdict: 'maybe', sessionId: SESSION },
    { runId: RUN, verdict: 'up' }, { runId: RUN, verdict: 'up', sessionId: 'short' }, { runId: RUN, verdict: 'up', sessionId: 'has spaces in it' }]) {
    const bad = setup(), out = reply();
    await bad.handler(post(body), out);
    assert.deepEqual([out.statusCode, bad.lookups.length], [400, 0], JSON.stringify(body));
  }
  const get = reply();
  await setup().handler({ method: 'GET', headers: {} }, get);
  assert.deepEqual([get.statusCode, get.headers.allow], [405, 'POST']);

  const busy = setup({ limited: async ip => ip === '203.0.113.9', ip: () => '203.0.113.9' }), limited = reply();
  await busy.handler(post({ runId: RUN, verdict: 'up', sessionId: SESSION }), limited);
  assert.deepEqual([limited.statusCode, busy.lookups.length], [429, 0]);

  // Without the agent service (the local fallback) there is no record to copy; the window is not told off.
  const local = setup({ configured: false }), unsaved = reply();
  await local.handler(post({ runId: RUN, verdict: 'up', sessionId: SESSION }), unsaved);
  assert.deepEqual([unsaved.statusCode, unsaved.body, local.lookups.length], [200, { saved: false, verdict: 'up' }, 0]);

  const down = setup({ found: () => { throw new Error('Agent history answered 502'); } }), failed = reply();
  const logged = console.error; console.error = () => {};
  try { await down.handler(post({ runId: RUN, verdict: 'up', sessionId: SESSION }), failed); } finally { console.error = logged; }
  assert.deepEqual([failed.statusCode, failed.body], [503, { error: 'unavailable' }]);

  assert.ok(validRunId(RUN) && !validRunId(`${RUN}'--`) && validSessionId(SESSION) && !validSessionId(''));
});

test('the run is read from the agent service with the internal token, by exact ID', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ items: [run({ runId: '11111111-1111-4111-8111-111111111111' }), run()] }) }; };
  const source = agentRunSource({ base: 'https://agent.example/', token: 'internal', fetch: fetcher });
  assert.equal(source.configured, true);
  assert.equal((await source.find(RUN, 48)).runId, RUN);
  const url = new URL(calls[0].url);
  assert.deepEqual([url.origin + url.pathname, url.searchParams.get('q'), url.searchParams.get('hours'), url.searchParams.get('limit')],
    ['https://agent.example/api/admin/conversations', RUN, '48', '5']);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer internal');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(await agentRunSource({ base: 'https://agent.example', token: 'internal', fetch: async () => ({ ok: true, json: async () => ({ items: [run({ runId: '11111111-1111-4111-8111-111111111111' })] }) }) }).find(RUN), null,
    'a run that only mentions the ID is not the run');
  await assert.rejects(agentRunSource({ base: 'https://agent.example', token: 'internal', fetch: async () => ({ ok: false, status: 502 }) }).find(RUN), /502/);
  const off = agentRunSource({ base: '', token: '' });
  assert.deepEqual([off.configured, await off.find(RUN)], [false, null]);
});

test('the owner lists rated answers and downloads them as a regression file', async () => {
  const store = memoryFeedbackStore();
  await store.save(freezeRun(run(), { verdict: 'up', page: '/' }));
  await new Promise(resolve => setTimeout(resolve, 3));
  await store.save(freezeRun(run({ runId: '22222222-2222-4222-8222-222222222222', question: 'Where does he work?', answer: 'I could not confirm that.' }), { verdict: 'down' }));
  let allowed = true;
  const handler = createFeedbackAdminHandler({ store, authorize: async (req, res) => (allowed ? { email: 'owner@example.com' } : (res.status(403).json({ error: 'forbidden' }), null)) });
  const get = query => ({ method: 'GET', query, headers: {} });

  const list = reply();
  await handler(get({}), list);
  assert.equal(list.body.enabled, true);
  assert.deepEqual(list.body.items.map(item => item.verdict), ['down', 'up'], 'newest first');
  assert.ok(!('run' in list.body.items[0]) && !('session_id' in list.body.items[0]), 'the list is light unless the run is asked for');
  const full = reply();
  await handler(get({ full: '1', verdict: 'up' }), full);
  assert.deepEqual([full.body.items.length, full.body.items[0].run.runId], [1, RUN]);

  const file = reply();
  await handler(get({ format: 'jsonl', verdict: 'up' }), file);
  assert.match(file.headers['content-type'], /^application\/x-ndjson/);
  assert.equal(file.headers['content-disposition'], 'attachment; filename="rated-answers-up.jsonl"');
  const lines = file.body.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]), ['runId', 'verdict', 'question', 'answer', 'route', 'status', 'models', 'promptVersions', 'retrieval', 'safety', 'usage', 'latencyMs', 'costUsd', 'page', 'answeredAt', 'ratedAt']);
  assert.equal(lines[0].usage[0].inputTokens, 4675);
  assert.equal(lines[0].usage[0].outputTokens, 169);
  assert.deepEqual(lines[0].promptVersions, ['input_safety_v6', 'portfolio_assistant_v5', 'output_context_safety_v4']);
  assert.deepEqual([lines[0].retrieval.query, lines[0].retrieval.strategy, lines[0].retrieval.sources.length, lines[0].retrieval.sources[0].chunkId], ['How is the platform built?', 'supabase_current_lexical', 3, 'c1']);
  assert.deepEqual(lines[0].safety.map(check => `${check.check}:${check.verdict}`), ['input:PASS', 'output_ctx:PASS']);
  assert.ok(!JSON.stringify(lines[0]).includes(SESSION), 'the file names no visitor session');
  assert.equal(exportLine({ run_id: RUN, verdict: 'up', question: 'q', answer: 'a', run: {} }).retrieval, null);

  allowed = false;
  const denied = reply();
  await handler(get({ format: 'jsonl' }), denied);
  assert.equal(denied.statusCode, 403);
  const posted = reply();
  await handler({ method: 'POST', headers: {} }, posted);
  assert.equal(posted.statusCode, 405);

  // Before the migration is run the page says so instead of failing.
  const missing = createFeedbackAdminHandler({ authorize: async () => ({}), store: { list: async () => null } }), off = reply();
  await missing(get({}), off);
  assert.deepEqual(off.body, { enabled: false, items: [] });
});

test('the Supabase store writes one row per run and treats a missing table as "not set up yet"', async () => {
  const calls = [];
  const builder = result => {
    const chain = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
    for (const name of ['upsert', 'update', 'delete', 'select', 'eq', 'order', 'limit']) chain[name] = (...args) => { calls.push([name, ...args]); return chain; };
    return chain;
  };
  const store = supabaseFeedbackStore({ from: name => { calls.push(['from', name]); return builder({ data: [{ run_id: RUN }], error: null }); } });
  assert.equal(await store.save({ run_id: RUN, verdict: 'up' }), true);
  const upsert = calls.find(call => call[0] === 'upsert');
  assert.deepEqual([calls[0], upsert[2], Object.keys(upsert[1]).includes('rated_at')], [['from', 'chat_answer_feedback'], { onConflict: 'run_id', ignoreDuplicates: true }, false],
    'rated_at is left to the database so a changed verdict keeps the first time');
  calls.length = 0;
  await store.remove(RUN, SESSION);
  assert.deepEqual(calls.filter(call => call[0] === 'eq'), [['eq', 'run_id', RUN], ['eq', 'session_id', SESSION]]);
  calls.length = 0;
  await store.list({ verdict: 'down', limit: 7 });
  assert.ok(!calls.find(call => call[0] === 'select')[1].includes(', run'), 'the frozen run is not read for the list');
  assert.deepEqual([calls.find(call => call[0] === 'eq'), calls.find(call => call[0] === 'limit')], [['eq', 'verdict', 'down'], ['limit', 7]]);
  calls.length = 0;
  await store.list({ full: true });
  assert.ok(calls.find(call => call[0] === 'select')[1].endsWith(', run'));

  const absent = supabaseFeedbackStore({ from: () => builder({ data: null, error: { code: 'PGRST205' } }) });
  assert.deepEqual([await absent.save({ run_id: RUN }), await absent.remove(RUN, SESSION), await absent.list()], [null, null, null]);
  const broken = supabaseFeedbackStore({ from: () => builder({ data: null, error: { code: '57014' } }) });
  await assert.rejects(broken.save({ run_id: RUN }), /unavailable/);
});

test('the chat window sends the run ID and nothing of the answer; the table is closed to browsers', () => {
  const widget = readFileSync(new URL('../src/components/ChatWidget.js', import.meta.url), 'utf8');
  const sender = widget.slice(widget.indexOf('function sendAnswerFeedback'), widget.indexOf('async function endAttachmentConversation'));
  assert.ok(sender.includes('body: JSON.stringify({ runId, verdict, sessionId, page: window.location.pathname })'));
  assert.ok(sender.includes('fetch("/api/rag/answer/feedback"') && sender.includes('keepalive: true') && sender.includes('result?.saved !== true'));
  assert.doesNotMatch(sender, /content|answer:|question/);
  assert.ok(widget.includes('await sendAnswerFeedback({ runId: messages.find((message) => message.id === id)?.runId, verdict, sessionId })'));

  const route = readFileSync(new URL('../pages/api/rag/answer/feedback.js', import.meta.url), 'utf8');
  assert.ok(route.includes("sizeLimit: '2kb'") && route.includes("isRateLimited(ip, 'answer-feedback'") && route.includes('AGENT_SERVICE_INTERNAL_TOKEN'));
  const admin = readFileSync(new URL('../pages/api/admin/chat-feedback.js', import.meta.url), 'utf8');
  assert.ok(admin.includes('authorize: requireAdmin'));

  const sql = readFileSync(new URL('../supabase/migrations/20261124180000_chat_answer_feedback.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes('enable row level security') && sql.includes('revoke all on public.chat_answer_feedback from anon, authenticated'));
  assert.ok(sql.includes('run_id uuid primary key') && sql.includes("check (verdict in ('up', 'down'))"));
  assert.doesNotMatch(sql, /create policy/i);
});

test('changing a verdict leaves the first snapshot frozen', async () => {
  const store = memoryFeedbackStore();
  await store.save(freezeRun(run(), { verdict: 'up' }));
  await store.save(freezeRun(run({ answer: 'Changed later' }), { verdict: 'down' }));
  assert.equal(store.rows.get(RUN).answer, run().answer);
  assert.equal(store.rows.get(RUN).run.answer, run().answer);
  assert.equal(store.rows.get(RUN).verdict, 'down');
});

test('ratings wait for persistence, block overlapping writes, and preserve the previous choice on failure', async () => {
  const widget = readFileSync(new URL('../src/components/ChatWidget.js', import.meta.url), 'utf8');
  const source = widget.slice(widget.indexOf('const rateAnswer ='), widget.indexOf('\n\n  return (', widget.indexOf('const rateAnswer =')));
  let messages = [{ id: 'a', runId: RUN, feedback: null }], finish, fail, calls = 0, errors = [];
  const runRate = new Function('pendingRatingsRef', 'setPendingRatings', 'sendAnswerFeedback', 'messages', 'sessionId', 'setMessages', 'trackWidget', 'reactPot', 'setErrorToast', `${source}; return rateAnswer;`)(
    { current: new Set() }, () => {}, () => { calls++; return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); },
    messages, SESSION, update => { messages = update(messages); }, () => {}, () => {}, error => errors.push(error));
  const like = runRate('a', 'up');
  await runRate('a', null);
  assert.equal(calls, 1);
  assert.equal(messages[0].feedback, null, 'not marked saved before the server responds');
  finish(); await like;
  assert.equal(messages[0].feedback, 'up');
  const cancelFailed = runRate('a', null); fail(new Error('offline')); await cancelFailed;
  assert.equal(messages[0].feedback, 'up');
  assert.match(errors[0], /could not be removed/);
  const cancel = runRate('a', null); finish(); await cancel;
  assert.equal(messages[0].feedback, null);
});

const pglite = process.env.DISCOVERY_PGLITE_MODULE;
test('PostgreSQL: one row per run, closed to browsers, a changed verdict keeps the first rating time', { skip: !pglite }, async () => {
  const { PGlite } = await import(pglite);
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const sql = readFileSync(new URL('../supabase/migrations/20261124180000_chat_answer_feedback.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // safe to run twice
    const row = freezeRun(run(), { verdict: 'up', page: '/' });
    const insert = verdict => db.query(
      `insert into public.chat_answer_feedback (run_id, verdict, session_id, conversation_id, question, answer, route, status, latency_ms, models, prompt_versions, source_count, cost_usd, page_path, answered_at, run, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb, now())
       on conflict (run_id) do update set verdict = excluded.verdict, updated_at = excluded.updated_at`,
      [row.run_id, verdict, row.session_id, row.conversation_id, row.question, row.answer, row.route, row.status, row.latency_ms, row.models, row.prompt_versions, row.source_count, row.cost_usd, row.page_path, row.answered_at, JSON.stringify(row.run)]);
    await db.exec('set role service_role');
    await insert('up');
    const first = (await db.query('select rated_at, verdict, prompt_versions, run->>\'answer\' as answer from public.chat_answer_feedback')).rows[0];
    assert.deepEqual([first.verdict, first.prompt_versions, first.answer], ['up', row.prompt_versions, row.answer]);
    await insert('down');
    const second = (await db.query('select rated_at, verdict from public.chat_answer_feedback')).rows;
    assert.deepEqual([second.length, second[0].verdict, second[0].rated_at.getTime()], [1, 'down', first.rated_at.getTime()]);
    await assert.rejects(insert('maybe'), /check constraint/);
    await db.exec('reset role');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.chat_answer_feedback'), /permission denied/);
      await assert.rejects(db.query(`delete from public.chat_answer_feedback`), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
