import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceHistory } from '../src/lib/voice/history.mjs';

const env = { NODE_ENV: 'production', VOICE_RECORD_TRANSCRIPTS: 'true', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-only' };
function fixture(overrides = {}) {
  const calls = [], rows = new Map();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, method: options.method, body, options });
    if (url.includes('/message?')) for (const row of body) rows.set(row.id, row);
    return { ok: true };
  };
  const history = createVoiceHistory({ env, fetchImpl, provider: 'Qwen', model: 'test', page: { path: '/' }, ...overrides });
  return { history, calls, rows };
}
const observe = (history, serverContent) => history.observe({ serverContent });

test('recording is explicit and server-only', () => {
  assert.equal(createVoiceHistory({ env: {} }), null);
});
test('one call holds ordered multi-turn text, not audio, with generated semantics', async () => {
  const { history, calls, rows } = fixture();
  await history.start();
  observe(history, { inputTranscription: { text: 'Hello', finished: true } });
  observe(history, { outputTranscription: { text: 'Hi ' }, modelTurn: { parts: [{ inlineData: { data: 'secret-audio' } }] } });
  observe(history, { outputTranscription: { text: 'there' }, turnComplete: true });
  await history.flush();
  observe(history, { inputTranscription: { text: 'Education?', finished: true } });
  observe(history, { outputTranscription: { text: 'Syracuse University' }, turnComplete: true });
  await history.close('client_hangup');
  assert.deepEqual([...rows.values()].map(row => [row.role, row.content, row.metadata_json.sequence]), [
    ['user', 'Hello', 1], ['assistant', 'Hi there', 2], ['user', 'Education?', 3], ['assistant', 'Syracuse University', 4],
  ]);
  assert.equal(calls[0].body.channel, 'voice');
  assert.equal(calls.at(-1).body.status, 'completed');
  assert.equal([...rows.values()][1].metadata_json.completion, 'generated');
  assert.ok(!JSON.stringify(calls.map(call => call.body)).includes('secret-audio'));
  assert.equal(new Set([...rows.values()].map(row => row.conversation_id)).size, 1);
});
test('empty flush does not block later writes; interrupted and hangup partials survive', async () => {
  const { history, rows } = fixture();
  await history.start(); await history.flush();
  observe(history, { outputTranscription: { text: 'Partial' } });
  await history.flush();
  observe(history, { interrupted: true });
  await history.flush();
  observe(history, { outputTranscription: { text: 'Another partial' } });
  await history.close('client_hangup');
  assert.equal(rows.size, 2);
  assert.deepEqual([...rows.values()].map(row => row.metadata_json.completion), ['interrupted', 'call-ended']);
});
test('checkpoints update stable message IDs and retry unknown outcomes idempotently', async () => {
  const rows = new Map(); let attempts = 0;
  const { history } = fixture({ fetchImpl: async (url, options) => {
    if (url.includes('/message?')) {
      for (const row of JSON.parse(options.body)) rows.set(row.id, row);
      if (++attempts === 1) throw new Error('Network broke after commit');
    }
    return { ok: true };
  } });
  await history.start();
  observe(history, { outputTranscription: { text: 'First ' } }); await history.flush();
  observe(history, { outputTranscription: { text: 'second' }, turnComplete: true });
  await history.close();
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0].content, 'First second');
  assert.equal(attempts, 3);
});
test('database failure stops recording and notifies the relay without content leakage', async () => {
  let errors = 0, writes = 0;
  const { history } = fixture({ onError: () => errors++, fetchImpl: async url => {
    if (url.includes('/message?')) { writes++; return { ok: false, status: 403 }; }
    return { ok: true };
  } });
  await history.start(); observe(history, { outputTranscription: { text: 'Private' } });
  assert.equal(await history.flush(), false);
  await history.close('history_unavailable');
  assert.equal(errors, 1); assert.equal(writes, 1);
});
test('local records are labeled separately; call IDs are isolated and content is bounded', async () => {
  const one = fixture({ env: { ...env, NODE_ENV: 'development' } }), two = fixture();
  await one.history.start(); await two.history.start();
  observe(one.history, { inputTranscription: { text: 'x'.repeat(9000) } });
  await one.history.close(); await two.history.close();
  assert.equal(one.calls[0].body.channel, 'voice-local');
  assert.notEqual(one.history.conversationId, two.history.conversationId);
  const row = [...one.rows.values()][0];
  assert.equal(row.content.length, 6000); assert.equal(row.metadata_json.truncated, true);
});
test('hangup during conversation creation cannot leave an active orphan', async () => {
  let resolve; const gate = new Promise(r => { resolve = r; }); const calls = [];
  const { history } = fixture({ fetchImpl: async (url, options) => {
    calls.push({ method: options.method, body: JSON.parse(options.body) });
    if (options.method === 'POST') await gate;
    return { ok: true };
  } });
  const start = history.start(); await history.close('client_closed'); resolve(); await start;
  assert.equal(calls.at(-1).method, 'PATCH');
  assert.equal(calls.at(-1).body.status, 'interrupted');
});
