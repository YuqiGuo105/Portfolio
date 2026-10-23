import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createVoiceHistory } from '../src/lib/voice/history.mjs';
import { voiceHistoryOptions, voiceHistoryResponse } from '../src/lib/voice/historyView.mjs';

if (!process.argv.includes('--approved-database-test')) throw new Error('Explicit database verification approval required.');
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Server-side database configuration is required.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const history = createVoiceHistory({ env: { ...process.env, NODE_ENV: 'development', VOICE_RECORD_TRANSCRIPTS: 'true' },
  provider: 'Qwen', model: 'synthetic-database-test', page: { path: '/' } });
try {
  await history.start();
  history.observe({ serverContent: { inputTranscription: { text: 'Synthetic voice history verification.', finished: true } } });
  history.observe({ serverContent: { outputTranscription: { text: 'Synthetic answer, no audio or real visitor content.' }, turnComplete: true } });
  await history.flush();
  history.observe({ serverContent: { outputTranscription: { text: 'Interrupted synthetic answer.' } } });
  history.observe({ serverContent: { interrupted: true } });
  await history.close('client_hangup');
  const { data, error } = await client.from('conversation')
    .select('id,status,channel,created_at,updated_at,messages:message!conversation_id(id,conversation_id,role,content,metadata_json,created_at)')
    .eq('id', history.conversationId)
    .order('created_at', { referencedTable: 'messages', ascending: true })
    .order('metadata_json->sequence', { referencedTable: 'messages', ascending: true, nullsFirst: false })
    .limit(500, { referencedTable: 'messages' });
  assert.equal(error, null);
  assert.equal(data.length, 1);
  const view = voiceHistoryResponse(data, voiceHistoryOptions()).items[0];
  assert.equal(view.status, 'completed'); assert.equal(view.messages.length, 3);
  assert.deepEqual(view.messages.map(row => row.sequence), [1, 2, 3]);
  assert.equal(view.messages[2].completion, 'interrupted');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.ok(anonKey, 'Anonymous key is required to verify denied reads');
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const table of ['conversation', 'message']) {
    const result = await anon.from(table).select('id').eq(table === 'message' ? 'conversation_id' : 'id', history.conversationId);
    assert.ok(result.error || !result.data?.length, `Anonymous ${table} read must be denied`);
  }
  console.log(JSON.stringify({ saved: true, orderedTurns: 3, interruptedPreserved: true, anonymousReadsDenied: true }));
} finally {
  // Delete only the synthetic UUID created by this invocation, children first.
  const messages = await client.from('message').delete().eq('conversation_id', history.conversationId);
  const conversation = await client.from('conversation').delete().eq('id', history.conversationId);
  assert.equal(messages.error, null); assert.equal(conversation.error, null);
  console.log('Synthetic history cleaned up.');
}
