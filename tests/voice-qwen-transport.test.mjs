import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createQwenConnection, qwenConfiguration } from '../services/voice/qwenTransport.mjs';
import { LIVE_MODEL, liveConfig, voiceGreeting, wireSetup } from '../src/lib/voice/protocol.mjs';
import { QWEN_MODEL, qwenSetup } from '../src/lib/voice/qwenProtocol.mjs';

const env = { NODE_ENV: 'production', QWEN_LIVE_API_KEY: 'test-only-private-key', QWEN_LIVE_WORKSPACE_ID: 'test-workspace' };
const page = { path: '/', title: 'Portfolio', text: 'Public page' };
const profile = { status: 'EVIDENCE_FOUND', facts: ['Owner-approved public profile.'] };
const withoutIds = messages => messages.map(({ event_id, ...message }) => message);

function harness({ autoTools = false, onSend } = {}) {
  const provider = new EventEmitter(), sent = [], events = [], connections = [];
  let opens = 0, closes = 0, terminations = 0;
  provider.readyState = 0; provider.bufferedAmount = 0;
  provider.send = raw => { const message = JSON.parse(raw); sent.push(message); onSend?.(message, provider); };
  provider.terminate = () => { terminations++; provider.readyState = 3; provider.emit('close', 1006, Buffer.from('PRIVATE_CLOSE_REASON')); };
  const connection = createQwenConnection({ env, page, profile, connect: (url, options) => { connections.push({ url, options }); return provider; } });
  const send = message => connection.send(JSON.stringify(message));
  const receive = event => provider.emit('message', Buffer.from(JSON.stringify(event)));
  connection.on('open', () => { opens++; send({ setup: wireSetup(LIVE_MODEL, liveConfig(page, profile)) }); });
  connection.on('close', (...args) => { closes++; assert.equal(JSON.stringify(args).includes('PRIVATE'), false); });
  connection.on('message', raw => {
    const event = JSON.parse(raw.toString()); events.push(event);
    if (autoTools && event.toolCall) send({ toolResponse: { functionResponses: event.toolCall.functionCalls.map(call => ({ id: call.id, name: call.name, response: profile })) } });
  });
  return { provider, connection, sent, events, connections, send, receive,
    get opens() { return opens; }, get closes() { return closes; }, get terminations() { return terminations; },
    ready() { provider.readyState = 1; provider.emit('open'); receive({ type: 'session.created' }); receive({ type: 'session.updated' }); },
    created(id = 'r1') { receive({ type: 'response.created', response: { id } }); },
    tool(id = 'tool1', responseId = 'r1', name = 'get_profile') {
      receive({ type: 'response.function_call_arguments.done', response_id: responseId, call_id: id, name, arguments: '{}' });
    },
    output(id = 'tool1') { send({ toolResponse: { functionResponses: [{ id, name: 'get_profile', response: profile }] } }); },
    done(id = 'r1', extra = {}) { receive({ type: 'response.done', response: { id, status: 'completed', ...extra } }); },
  };
}

test('production configuration uses only credential readiness and the fixed Singapore model allowlist', () => {
  for (const model of [QWEN_MODEL, 'qwen3.5-omni-flash-realtime', 'qwen3.5-omni-plus-realtime']) {
    assert.deepEqual(qwenConfiguration({ ...env, QWEN_LIVE_MODEL: model, QWEN_LIVE_ENDPOINT: 'wss://evil.test', QWEN_LIVE_ENABLED: 'false', QWEN_LIVE_TRIAL_ACK: 'false' }), {
      configured: true, model, endpoint: `wss://test-workspace.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=${model}`,
    });
  }
  assert.equal(qwenConfiguration(env).model, QWEN_MODEL);
  for (const override of [{ QWEN_LIVE_API_KEY: '' }, { QWEN_LIVE_WORKSPACE_ID: '' }, { QWEN_LIVE_WORKSPACE_ID: 'a'.repeat(81) },
    { QWEN_LIVE_WORKSPACE_ID: 'attacker.test/path' }, { QWEN_LIVE_WORKSPACE_ID: 'x@evil.test' }, { QWEN_LIVE_WORKSPACE_ID: 'x?model=other' },
    { QWEN_LIVE_MODEL: 'other-model' }, { QWEN_LIVE_MODEL: `${QWEN_MODEL}&redirect=evil` }]) {
    assert.equal(qwenConfiguration({ ...env, ...override }).configured, false);
    let connected = false;
    assert.throws(() => createQwenConnection({ env: { ...env, ...override }, connect: () => { connected = true; } }), /not configured/);
    assert.equal(connected, false);
  }
});

test('socket lifecycle and handshake wait for session.created and configure the nested protocol exactly once', () => {
  const h = harness();
  assert.ok(h.connection instanceof EventEmitter);
  assert.equal(h.connection.readyState, 0);
  assert.deepEqual(h.connections, [{ url: qwenConfiguration(env).endpoint, options: {
    headers: { Authorization: `Bearer ${env.QWEN_LIVE_API_KEY}` }, handshakeTimeout: 10000,
    maxPayload: 1024 * 1024, followRedirects: false, perMessageDeflate: false,
  } }]);
  h.provider.bufferedAmount = 130000; assert.equal(h.connection.bufferedAmount, 130000);
  h.provider.readyState = 1; h.provider.emit('open'); h.provider.emit('open');
  assert.equal(h.opens, 1); assert.equal(h.connection.readyState, 1); assert.deepEqual(h.sent, []);
  h.receive({ type: 'session.created', session: { private: env.QWEN_LIVE_API_KEY } });
  h.receive({ type: 'session.created' });
  h.send({ setup: { model: 'untrusted', systemInstruction: 'not forwarded' } });
  assert.deepEqual(withoutIds(h.sent), [qwenSetup(page, profile)]);
  assert.equal(h.sent[0].session.audio.input.format.sample_rate, 16000);
  assert.equal(h.sent[0].session.audio.output.format.sample_rate, 24000);
  assert.ok(h.sent[0].session.tools.every(tool => tool.type === 'function' && tool.function.parameters.type === 'object'));
  h.receive({ type: 'session.updated', session: { private: env.QWEN_LIVE_API_KEY } });
  h.receive({ type: 'session.updated' }); h.receive({ type: 'session.created' });
  assert.deepEqual(h.events, [{ setupComplete: {} }]);
  h.connection.terminate(); h.connection.terminate();
  h.provider.emit('error', new Error('SECRET_LATE_ERROR')); h.provider.emit('open'); h.receive({ type: 'session.updated' });
  assert.equal(h.connection.readyState, 3); assert.equal(h.closes, 1); assert.equal(h.terminations, 1); assert.equal(h.opens, 1);
  assert.equal(h.connections.length, 1);
});

test('the relay greeting and PCM map to Qwen without leaking Google setup or adding responses on mute', () => {
  const h = harness();
  h.connection.on('message', raw => { if (JSON.parse(raw).setupComplete) h.send(voiceGreeting()); });
  h.ready(); h.send(voiceGreeting());
  h.send({ realtimeInput: { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } } });
  h.send({ realtimeInput: { audioStreamEnd: true } });
  assert.deepEqual(withoutIds(h.sent.slice(1)), [
    { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: voiceGreeting().clientContent.turns[0].parts[0].text }] } },
    { type: 'response.create' }, { type: 'input_audio_buffer.append', audio: 'AAAA' }, { type: 'input_audio_buffer.clear' },
  ]);
  assert.ok(h.sent.every(message => /^event_[a-f0-9-]{36}$/.test(message.event_id)));
  assert.equal(new Set(h.sent.map(message => message.event_id)).size, h.sent.length);
});

test('normalizes ASR, streamed captions, 24kHz audio, final-only captions and token usage', () => {
  const h = harness(); h.ready(); h.created();
  h.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'input1', transcript: 'Education?' });
  h.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'input1', transcript: 'Education?' });
  h.receive({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'Public ', event_id: 'delta1' });
  h.receive({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'Public ', event_id: 'delta1' });
  h.receive({ type: 'response.audio_transcript.done', response_id: 'r1', transcript: 'Public profile.' });
  h.receive({ type: 'response.audio.delta', response_id: 'r1', delta: 'AAAA' });
  h.done('r1', { usage: { total_tokens: 42, input_tokens: 20, output_tokens: 22, private: 'SECRET' } });
  h.done('r1', { usage: { total_tokens: 42 } });
  assert.deepEqual(h.events, [
    { setupComplete: {} }, { serverContent: { inputTranscription: { text: 'Education?' } } },
    { serverContent: { outputTranscription: { text: 'Public ' } } }, { serverContent: { outputTranscription: { text: 'profile.' } } },
    { serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] } } },
    { usageMetadata: { totalTokenCount: 42 } }, { serverContent: { turnComplete: true } },
  ]);
  h.created('r2');
  h.receive({ type: 'response.audio_transcript.done', response_id: 'r2', transcript: 'Final only.' });
  h.done('r2', { usage: { input_tokens: 10, output_tokens: 5 } });
  assert.deepEqual(h.events.slice(-3), [{ serverContent: { outputTranscription: { text: 'Final only.' } } },
    { usageMetadata: { totalTokenCount: 15 } }, { serverContent: { turnComplete: true } }]);
});

test('incremental ASR and alternative text captions are not duplicated by their completion events', () => {
  const h = harness(); h.ready(); h.created();
  h.receive({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'Hello' });
  h.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'Hello there' });
  h.receive({ type: 'response.text.delta', response_id: 'r1', item_id: 'a1', delta: 'Hi' });
  h.receive({ type: 'response.text.done', response_id: 'r1', item_id: 'a1', text: 'Hi' });
  h.receive({ type: 'response.audio_transcript.done', response_id: 'r1', item_id: 'a1', transcript: 'Hi' });
  assert.deepEqual(h.events.slice(1), [{ serverContent: { inputTranscription: { text: 'Hello' } } },
    { serverContent: { inputTranscription: { text: ' there' } } }, { serverContent: { outputTranscription: { text: 'Hi' } } }]);
});

for (const ordering of ['outputs-first', 'done-first', 'mixed']) {
  test(`tool continuation waits for the completed turn and every output: ${ordering}`, () => {
    const h = harness(); h.ready(); h.created(); h.tool('a'); h.tool('b', 'r1', 'read_page');
    assert.deepEqual(h.events.slice(1), ['a', 'b'].map((id, index) => ({ toolCall: { functionCalls: [{ id, name: index ? 'read_page' : 'get_profile', args: {} }] } })));
    if (ordering === 'done-first') h.done();
    h.output('a');
    if (ordering === 'mixed') h.done();
    assert.equal(h.sent.filter(event => event.type === 'response.create').length, 0);
    h.output('b');
    if (ordering === 'outputs-first') {
      assert.equal(h.sent.filter(event => event.type === 'response.create').length, 0); h.done();
    }
    assert.deepEqual(withoutIds(h.sent.slice(1)), ['a', 'b'].map(id => ({ type: 'conversation.item.create', item: {
      type: 'function_call_output', call_id: id, output: JSON.stringify(profile),
    } })).concat({ type: 'response.create' }));
    h.tool('a'); h.output('a'); h.done();
    assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
    assert.equal(h.events.filter(event => event.serverContent?.turnComplete).length, 0, 'a tool round is not the completed spoken turn');
    h.created('answer'); h.done('answer');
    assert.equal(h.events.filter(event => event.serverContent?.turnComplete).length, 1);
  });
}

test('terminal output inventory registers all tools before synchronous relay outputs can continue', () => {
  const h = harness({ autoTools: true }); h.ready(); h.created();
  h.tool('first');
  h.done('r1', { output: [
    { type: 'function_call', call_id: 'first', name: 'get_profile', arguments: '{}' },
    { type: 'function_call', call_id: 'second', name: 'read_page', arguments: '{}' },
    { type: 'function_call', call_id: 'third', name: 'navigate_section', arguments: '{"target":"background"}' },
  ] });
  assert.deepEqual(h.sent.slice(1).map(event => event.item?.call_id || event.type), ['first', 'second', 'third', 'response.create']);
  h.receive({ type: 'response.output_item.done', response_id: 'r1', item: { type: 'function_call', call_id: 'second', name: 'read_page', arguments: '{}' } });
  h.tool('third'); h.done();
  assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
  assert.deepEqual(h.events.flatMap(event => event.toolCall?.functionCalls || []).map(call => call.id), ['first', 'second', 'third']);
});

test('a tool output returned synchronously on terminal usage cannot bypass the final tool inventory', () => {
  const h = harness(); h.ready(); h.created(); h.tool('first');
  h.connection.on('message', raw => { if (JSON.parse(raw).usageMetadata) h.output('first'); });
  h.done('r1', { usage: { total_tokens: 12 }, output: [
    { type: 'function_call', call_id: 'first', name: 'get_profile', arguments: '{}' },
    { type: 'function_call', call_id: 'second', name: 'read_page', arguments: '{}' },
  ] });
  assert.equal(h.sent.filter(event => event.type === 'response.create').length, 0);
  h.output('second');
  assert.deepEqual(h.sent.slice(1).map(event => event.item?.call_id || event.type), ['first', 'second', 'response.create']);
});

test('tool results are scoped to their response and separate tool rounds each continue once', () => {
  const h = harness(); h.ready(); h.created('r1'); h.tool('a'); h.done('r1');
  h.created('r2'); h.tool('b', 'r2'); h.done('r2');
  h.output('a'); assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
  h.output('b'); assert.equal(h.sent.filter(event => event.type === 'response.create').length, 2);
  h.output('a'); h.output('b'); h.done('r1'); h.done('r2');
  assert.equal(h.sent.filter(event => event.type === 'response.create').length, 2);
});

for (const status of ['cancelled', 'canceled', 'incomplete']) {
  test(`response status ${status} never continues tools or completes the spoken turn`, () => {
    const h = harness(); h.ready(); h.created(); h.tool(); h.output();
    h.done('r1', { status, usage: { total_tokens: 9 }, output: [{ type: 'function_call', call_id: 'late', name: 'read_page', arguments: '{}' }] });
    h.tool('late'); h.output(); h.done();
    assert.equal(h.sent.filter(event => event.type === 'response.create').length, 0);
    assert.equal(h.events.filter(event => event.serverContent?.turnComplete).length, 0);
    assert.equal(h.events.filter(event => event.serverContent?.interrupted).length, 1);
    assert.equal(h.events.filter(event => event.toolCall).length, 1);
    assert.deepEqual(h.events.find(event => event.usageMetadata), { usageMetadata: { totalTokenCount: 9 } });
  });
}

test('cancellation before tool outputs suppresses late results and a completed done replay', () => {
  const h = harness(); h.ready(); h.created(); h.tool(); h.done('r1', { status: 'cancelled' });
  const before = h.sent.length;
  h.output(); h.done();
  assert.equal(h.sent.length, before);
  assert.equal(h.events.filter(event => event.serverContent?.turnComplete).length, 0);
});

test('barge-in discards pending continuations and all late events across multiple interrupted responses', () => {
  const h = harness(); h.ready(); h.created(); h.tool('a'); h.done();
  h.receive({ type: 'input_audio_buffer.speech_started' }); h.output('a');
  h.created('r2'); h.tool('b', 'r2'); h.output('b');
  h.receive({ type: 'input_audio_buffer.speech_started' });
  h.created('r3');
  const before = h.events.length;
  for (const id of ['r1', 'r2']) {
    h.receive({ type: 'response.audio.delta', response_id: id, delta: 'AAAA' });
    h.receive({ type: 'response.audio_transcript.delta', response_id: id, delta: 'STALE' });
    h.tool(`late-${id}`, id);
    h.done(id, { usage: { total_tokens: 7 } });
  }
  assert.ok(h.events.slice(before).every(event => event.usageMetadata));
  assert.equal(h.sent.filter(event => event.type === 'response.create').length, 0);
  assert.equal(h.sent.filter(event => event.item?.call_id === 'a').length, 0);
  h.receive({ type: 'response.audio_transcript.delta', response_id: 'r3', delta: 'New answer.' }); h.done('r3');
  assert.deepEqual(h.events.slice(-2), [{ serverContent: { outputTranscription: { text: 'New answer.' } } }, { serverContent: { turnComplete: true } }]);
});

test('duplicate response.created cannot reset tool completion or resurrect interrupted response IDs', () => {
  const h = harness({ autoTools: true }); h.ready(); h.created(); h.tool(); h.created(); h.done(); h.created(); h.done();
  assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
  h.receive({ type: 'input_audio_buffer.speech_started' }); h.created();
  h.receive({ type: 'response.audio.delta', response_id: 'r1', delta: 'AAAA' });
  assert.equal(h.events.filter(event => event.serverContent?.modelTurn).length, 0);
});

test('typed and untyped provider errors, malformed JSON and websocket errors are sanitized and terminal', () => {
  const failures = [
    h => h.receive({ type: 'error', error: { message: 'SECRET', code: 'AccessDenied.Unpurchased' } }),
    h => h.receive({ code: 'AllocationQuota.FreeTierOnly', message: 'SECRET', request_id: 'SECRET' }),
    h => h.receive({ error: { message: 'SECRET' } }),
    h => h.receive({ message: 'SECRET' }),
    h => h.provider.emit('message', Buffer.from('SECRET_INVALID_JSON')),
    h => h.provider.emit('message', Buffer.from('null')),
    h => h.provider.emit('error', new Error('SECRET_SOCKET_ERROR')),
    h => { h.created(); h.done('r1', { status: 'failed', status_details: { error: { message: 'SECRET' } } }); },
    h => h.receive({ type: 'session.updated', session: { secret: 'SECRET' } }),
  ];
  for (const failure of failures) {
    const h = harness();
    if (failure !== failures.at(-1)) h.ready();
    failure(h); h.provider.emit('error', new Error('SECRET_AFTER_CLOSE'));
    assert.deepEqual(h.events.filter(event => event.error), [{ error: {} }]);
    assert.equal(JSON.stringify(h.events).includes('SECRET'), false);
    assert.equal(h.connection.readyState, 3); assert.equal(h.terminations, 1); assert.equal(h.closes, 1); assert.equal(h.connections.length, 1);
  }
});

test('construction and send failures never expose provider exceptions or reconnect', async () => {
  let attempts = 0;
  const connection = createQwenConnection({ env, page, profile, connect: () => { attempts++; throw new Error('SECRET_CONNECT'); } });
  const events = []; connection.on('message', raw => events.push(JSON.parse(raw)));
  await new Promise(resolve => queueMicrotask(resolve));
  assert.deepEqual(events, [{ error: {} }]); assert.equal(attempts, 1); assert.equal(connection.readyState, 3);
  const h = harness({ onSend: () => { throw new Error('SECRET_SEND'); } }); h.ready();
  assert.deepEqual(h.events, [{ error: {} }]); assert.equal(h.connections.length, 1); assert.equal(h.terminations, 1);
});

test('natural close and reentrant relay termination are idempotent and never reflect a close reason', () => {
  const h = harness(); h.ready(); h.provider.readyState = 3;
  h.provider.emit('close', 1008, Buffer.from('PRIVATE_CLOSE_REASON')); h.connection.terminate();
  assert.equal(h.closes, 1); assert.equal(h.terminations, 0); assert.equal(h.connection.readyState, 3);
  const other = harness(); other.ready();
  other.connection.on('message', raw => { if (JSON.parse(raw).error) other.connection.terminate(); });
  other.receive({ type: 'error', error: { message: 'SECRET' } });
  assert.equal(other.closes, 1); assert.equal(other.terminations, 1);
});

test('invalid tools and client text fail closed while unsupported provider events are not forwarded', () => {
  const invalid = [
    h => h.receive({ type: 'response.function_call_arguments.done', response_id: 'r1', call_id: 'bad', name: 'get_profile', arguments: 'SECRET_INVALID_JSON' }),
    h => h.receive({ type: 'response.function_call_arguments.done', response_id: 'r1', call_id: 'bad', name: 'get_profile', arguments: '[]' }),
    h => h.tool('bad', 'r1', 'delete_account'),
    h => h.output('unknown'),
    h => h.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Injected arbitrary text' }] }], turnComplete: true } }),
  ];
  for (const action of invalid) {
    const h = harness(); h.ready(); h.created(); action(h);
    assert.deepEqual(h.events.at(-1), { error: {} }); assert.equal(h.connection.readyState, 3);
  }
  const h = harness(); h.ready();
  h.receive({ type: 'rate_limits.updated', private: env.QWEN_LIVE_API_KEY });
  h.receive({ type: 'conversation.item.created', item: { private: env.QWEN_LIVE_API_KEY } });
  assert.deepEqual(h.events, [{ setupComplete: {} }]);
});
