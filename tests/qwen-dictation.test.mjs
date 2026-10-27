import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readDictationWav, transcribeQwen } from '../src/lib/voice/qwenDictation.mjs';
import { SpendDenied } from '../src/lib/voice/spendGuard.mjs';
import { localQwenEnabled, sameOrigin } from '../src/lib/localAssistant.mjs';

function wav(seconds = 1) {
  const data = Buffer.alloc(44 + seconds * 32000);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}
const env = { QWEN_LIVE_API_KEY: 'test-secret', QWEN_LIVE_WORKSPACE_ID: 'test-workspace' };
function harness(events = [{ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i', transcript: '系统架构 Redis Java' }]) {
  const socket = new EventEmitter(), sent = [], charges = [];
  socket.readyState = 1;
  socket.terminate = () => { socket.readyState = 3; socket.emit('close'); };
  const emit = event => socket.emit('message', JSON.stringify(event));
  socket.send = raw => {
    const event = JSON.parse(raw); sent.push(event);
    if (event.type === 'session.update') queueMicrotask(() => { emit({ type: 'session.updated' }); emit({ type: 'session.updated' }); });
    if (event.type === 'input_audio_buffer.commit') queueMicrotask(() => {
      emit({ type: 'input_audio_buffer.committed', item_id: 'i' }); events.forEach(emit);
    });
  };
  return { socket, sent, charges, options: { env, connect: () => { queueMicrotask(() => emit({ type: 'session.created' })); return socket; },
    spend: { reserve: async () => ({ settle: async value => charges.push(value) }) } } };
}
test('validates size, PCM format and duration before any paid connection', () => {
  assert.equal(readDictationWav(wav().toString('base64')).length, 32000);
  for (const value of ['', 'not base64', wav(61).toString('base64'), wav().subarray(0, 100).toString('base64')]) assert.throws(() => readDictationWav(value));
  const stereo = wav(); stereo.writeUInt16LE(2, 22);
  assert.throws(() => readDictationWav(stereo.toString('base64')));
});
test('recognition preserves mixed languages and never requests an answer', async () => {
  const h = harness();
  assert.deepEqual(await transcribeQwen(wav().toString('base64'), h.options), { text: '系统架构 Redis Java' });
  assert.equal(h.sent.filter(x => x.type === 'input_audio_buffer.commit').length, 1);
  assert.equal(h.sent.some(x => x.type === 'response.create'), false);
  assert.equal(h.sent[0].session.turn_detection, null);
  assert.deepEqual(h.sent[0].session.tools, []);
  assert.deepEqual(h.charges, [null]);
  assert.equal(h.socket.readyState, 3);
});
test('empty recognition is an explicit no-speech result, not a hallucinated answer', async () => {
  const h = harness([{ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i', transcript: '' }]);
  await assert.rejects(transcribeQwen(wav().toString('base64'), h.options), { code: 'no_speech', status: 422 });
});
test('provider errors are sanitized and never retried', async () => {
  const h = harness([{ type: 'error', error: { message: 'secret URL test-secret' } }]);
  await assert.rejects(transcribeQwen(wav().toString('base64'), h.options), error => error.code === 'dictation_unavailable' && !error.message.includes('test-secret'));
  assert.equal(h.sent.filter(x => x.type === 'session.update').length, 1);
});
test('budget failure prevents opening a socket', async () => {
  let opened = false;
  await assert.rejects(transcribeQwen(wav().toString('base64'), { env, connect: () => { opened = true; }, spend: { reserve: async () => { throw new SpendDenied('monthly_limit'); } } }), SpendDenied);
  assert.equal(opened, false);
});
test('timeout and cancellation close sockets and retain unknown spending', async () => {
  const h = harness([]);
  await assert.rejects(transcribeQwen(wav().toString('base64'), { ...h.options, timeoutMs: 10 }), { code: 'dictation_timeout' });
  assert.equal(h.socket.readyState, 3);
  const h2 = harness([]), controller = new AbortController();
  const pending = transcribeQwen(wav().toString('base64'), { ...h2.options, signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { code: 'cancelled' });
  assert.equal(h2.socket.readyState, 3); assert.deepEqual(h2.charges, [null]);
});
test('foreign item transcripts are ignored', async () => {
  const h = harness([{ type: 'conversation.item.input_audio_transcription.completed', item_id: 'foreign', transcript: 'wrong' },
    { type: 'conversation.item.input_audio_transcription.completed', item_id: 'i', transcript: 'correct' }]);
  assert.equal((await transcribeQwen(wav().toString('base64'), h.options)).text, 'correct');
});
test('local provider overrides cannot activate on production or remote callers', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' } }, enabled = { LOCAL_QWEN_ASSISTANT: 'true', NODE_ENV: 'development' };
  assert.ok(localQwenEnabled(req, enabled));
  for (const extra of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { K_SERVICE: 'agent' }, { LOCAL_QWEN_ASSISTANT: '' }]) assert.equal(localQwenEnabled(req, { ...enabled, ...extra }), false);
  assert.equal(localQwenEnabled({ socket: { remoteAddress: '8.8.8.8' } }, enabled), false);
  assert.equal(sameOrigin({ headers: { origin: 'https://evil.example', host: 'localhost:3118' } }), false);
  assert.equal(sameOrigin({ headers: { 'sec-fetch-site': 'cross-site' } }), false);
});
