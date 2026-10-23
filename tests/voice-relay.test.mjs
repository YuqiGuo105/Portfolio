import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createVoiceRelay, signTicket, verifyTicket, createBudgetStore } from '../services/voice/relay.mjs';
import { createVoiceProxy } from '../src/lib/voice/productionProxy.mjs';
import { QWEN_MODEL } from '../src/lib/voice/qwenProtocol.mjs';

const secret = 'test-only-voice-secret-'.repeat(3);
const origin = 'https://www.yuqi.site';
const page = { path: '/', text: 'Public page' };
const profile = { status: 'EVIDENCE_FOUND', facts: ['Syracuse University; University of Liverpool.'] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const qwenEnv = { VOICE_PROVIDER: 'qwen', QWEN_LIVE_API_KEY: 'qwen-test-only-private', QWEN_LIVE_WORKSPACE_ID: 'test-workspace' };
const recordingEnv = { VOICE_RECORD_TRANSCRIPTS: 'true', SUPABASE_URL: 'https://history.test', SUPABASE_SERVICE_ROLE_KEY: 'history-test-only-private' };
const emit = (provider, event) => provider.emit('message', Buffer.from(JSON.stringify(event)));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function waitFor(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(5); }
  assert.fail('Expected condition did not become true');
}

function store() {
  let calls = 0, active = null, claimed = false;
  return async (action, ticket) => {
    if (action === 'claim') {
      if (ticket !== active || claimed) return { allowed: false, remainingCalls: 5 - calls };
      claimed = true;
    }
    if (action === 'release' && active === ticket) active = null;
    if (action === 'reserve') {
      if (calls >= 5 || active) return { allowed: false, reason: calls >= 5 ? 'daily_limit' : 'busy', remainingCalls: 5 - calls };
      active = ticket; calls++; claimed = false;
    }
    return { allowed: true, remainingCalls: 5 - calls, expiresAt: new Date(Date.now() + 120000).toISOString() };
  };
}

async function fixture(options = {}) {
  const { env: overrides, fetchImpl, autoSetup = true, ...relayOptions } = options;
  const providers = [], requests = [], connections = []; let tokens = 0;
  const env = { NODE_ENV: 'production', VOICE_ENABLED: 'true', VOICE_GATEWAY_TOKEN: secret, GEMINI_API_KEY: 'never-browser',
    VOICE_PUBLIC_URL: 'https://relay.example', VOICE_RECORD_TRANSCRIPTS: 'false', ...overrides };
  const relay = createVoiceRelay({ env, budget: store(), loadProfile: async () => profile,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url !== 'https://generativelanguage.googleapis.com/v1beta/auth_tokens') {
        assert.ok(fetchImpl, 'Unexpected network request'); return fetchImpl(url, init);
      }
      tokens++;
      const setup = JSON.parse(init.body).bidiGenerateContentSetup;
      assert.equal(setup.model, 'models/gemini-3.8-live');
      assert.equal(setup.generationConfig.maxOutputTokens, 512);
      return { ok: true, json: async () => ({ name: 'auth_tokens/private' }) };
    },
    connect: (url, options) => {
      connections.push({ url, options });
      const remote = new EventEmitter(); remote.readyState = 1; remote.bufferedAmount = 0; remote.messages = [];
      remote.send = raw => {
        const msg = JSON.parse(raw); remote.messages.push(msg);
        if (autoSetup && msg.setup) queueMicrotask(() => emit(remote, { setupComplete: {} }));
        if (autoSetup && msg.type === 'session.update') queueMicrotask(() => emit(remote, { type: 'session.updated' }));
      };
      remote.terminate = () => { if (remote.readyState === 3) return; remote.readyState = 3; remote.emit('close'); };
      providers.push(remote); queueMicrotask(() => {
        remote.emit('open');
        if (env.VOICE_PROVIDER === 'qwen') emit(remote, { type: 'session.created' });
      }); return remote;
    }, ...relayOptions });
  const server = createServer(relay.http); server.on('upgrade', relay.upgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, relay, providers, requests, connections, tokens: () => tokens,
    reserve: async () => {
      const res = await fetch(`${base}/session`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ page, origin }) });
      return { status: res.status, data: await res.json() };
    },
    close: async () => { await relay.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
    open: async (ticket, { waitReady = true } = {}) => {
      const client = new WebSocket(base.replace('http:', 'ws:') + '/voice', { origin });
      const events = []; client.on('message', raw => events.push(JSON.parse(raw.toString())));
      const closed = once(client, 'close');
      await once(client, 'open'); client.send(JSON.stringify({ type: 'connect', ticket }));
      if (waitReady) await waitFor(() => events.some(e => e.setupComplete) || client.readyState === 3);
      return { client, events, closed };
    },
  };
}

test('signed one-use ticket rejects altered payloads, foreign origins, expiry and private context', () => {
  const now = Date.now();
  const payload = { nonce: 'a'.repeat(64), origin, exp: now + 29000, page };
  const ticket = signTicket(payload, secret);
  assert.equal(verifyTicket(ticket, secret, origin, now).page.path, '/');
  for (const args of [[ticket + 'x', secret, origin, now], [ticket, secret, 'https://evil.test', now], [ticket, secret, origin, now + 30000], [signTicket({ ...payload, page: { path: '/admin/visitors' } }, secret), secret, origin, now]]) {
    assert.throws(() => verifyTicket(...args));
  }
});

test('two relay instances share an atomic allowance; status and refresh do not spend or renew it', async () => {
  const budget = store(); const a = await fixture({ budget }), b = await fixture({ budget });
  try {
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).reserve()));
    assert.equal(attempts.filter(x => x.status === 200).length, 1);
    assert.equal(a.tokens() + b.tokens(), 0);
    const first = attempts.find(x => x.status === 200);
    assert.equal(JSON.stringify(first.data).includes('never-browser'), false);
    const { client, events } = await a.open(first.data.ticket);
    assert.ok(events.some(x => x.setupComplete)); client.close(); await once(client, 'close'); await pause(10);
    for (let i = 0; i < 4; i++) {
      const ticket = await b.reserve(); assert.equal(ticket.status, 200);
      const call = await b.open(ticket.data.ticket); call.client.close(); await once(call.client, 'close'); await pause(10);
    }
    assert.equal((await a.reserve()).status, 429);
    assert.equal((await b.reserve()).status, 429);
    assert.equal(a.tokens() + b.tokens(), 5);
    const status = await (await fetch(`${a.base}/session`, { headers: { Authorization: `Bearer ${secret}` } })).json();
    assert.equal(status.dailyLimit, 5); assert.equal(status.remainingCalls, 0);
  } finally { await a.close(); await b.close(); }
});

test('relay relays only PCM, supplies truthful tools server-side, blocks setup injection and ticket replay', async () => {
  const f = await fixture();
  try {
    const reservation = await f.reserve(); const { client, events } = await f.open(reservation.data.ticket);
    assert.ok(events.some(x => x.setupComplete));
    assert.equal(f.providers[0].messages.filter(x => x.clientContent).length, 1);
    assert.match(f.providers[0].messages.find(x => x.clientContent).clientContent.turns[0].parts[0].text, /Mr\. Pot/);
    f.providers[0].emit('message', Buffer.from('{"setupComplete":{}}'));
    assert.equal(f.providers[0].messages.filter(x => x.clientContent).length, 1, 'greeting is sent only once');
    client.send(JSON.stringify({ realtimeInput: { audio: { data: Buffer.alloc(3200).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
    await pause(10); assert.ok(f.providers[0].messages.some(x => x.realtimeInput));
    f.providers[0].emit('message', Buffer.from(JSON.stringify({ toolCall: { functionCalls: [{ id: 'p', name: 'get_profile', args: {} }] } })));
    assert.deepEqual(f.providers[0].messages.at(-1).toolResponse.functionResponses[0].response, profile);
    client.send(JSON.stringify({ setup: { model: 'expensive-other-model' } }));
    await once(client, 'close');
    assert.equal(f.providers[0].readyState, 3);
    const replay = await f.open(reservation.data.ticket);
    assert.equal(replay.client.readyState, 3);
    assert.equal(f.tokens(), 1);
  } finally { await f.close(); }
});

test('server enforces usage cutoff even when the browser ignores the client timer', async () => {
  const f = await fixture();
  try {
    const reservation = await f.reserve(); const call = await f.open(reservation.data.ticket);
    f.providers[0].emit('message', Buffer.from(JSON.stringify({ usageMetadata: { totalTokenCount: 17000 } })));
    await once(call.client, 'close');
    assert.ok(call.events.some(e => e.reason === 'usage_limit'));
    assert.equal(f.providers[0].readyState, 3);
  } finally { await f.close(); }
});

test('database outages, missing profile and unauthenticated requests never reach Google', async () => {
  for (const options of [{ budget: async () => { throw new Error('DB down'); } }, { loadProfile: async () => ({ status: 'UNAVAILABLE' }) }]) {
    const f = await fixture(options);
    try {
      assert.equal((await fetch(`${f.base}/session`)).status, 401);
      const reservation = await f.reserve();
      if (reservation.status === 200) { const c = await f.open(reservation.data.ticket); assert.equal(c.client.readyState, 3); }
      else assert.equal(reservation.status, 503);
      assert.equal(f.tokens(), 0);
    } finally { await f.close(); }
  }
});

test('the server deadline ends the provider independently of browser timers', async () => {
  const base = store();
  const budget = async (...args) => ({ ...await base(...args), expiresAt: new Date(Date.now() + 140).toISOString() });
  const f = await fixture({ budget });
  try {
    const reservation = await f.reserve(); const call = await f.open(reservation.data.ticket);
    assert.ok(call.events.some(e => e.setupComplete));
    await once(call.client, 'close');
    assert.ok(call.events.some(e => e.reason === 'time_limit'));
    assert.equal(f.providers[0].readyState, 3);
  } finally { await f.close(); }
});

test('output and message flood limits disconnect the upstream', async () => {
  for (const kind of ['output', 'flood']) {
    const f = await fixture();
    try {
      const reservation = await f.reserve(); const call = await f.open(reservation.data.ticket);
      const closed = once(call.client, 'close');
      if (kind === 'output') {
        for (let i = 0; i < 61; i++) {
          f.providers[0].emit('message', Buffer.from(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(48000).toString('base64') } }] } } })));
          await pause(2);
        }
      } else for (let i = 0; i < 30; i++) call.client.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      await closed;
      assert.equal(f.providers[0].readyState, 3);
      assert.ok(call.events.some(e => e.reason === (kind === 'output' ? 'output_limit' : 'invalid_request')));
      assert.equal(f.tokens(), 1);
    } finally { await f.close(); }
  }
});

test('budget REST client rejects bad storage responses without fallback', async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => ({}) }]) {
    const budget = createBudgetStore({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'secret' }, async () => response);
    await assert.rejects(budget('reserve', 'a'.repeat(64)));
  }
});

test('production proxy rejects other origins and private pages before making network calls', async () => {
  let calls = 0;
  const handler = createVoiceProxy({ env: { NODE_ENV: 'production', VOICE_ENABLED: 'true', VOICE_RELAY_URL: 'https://relay.test', VOICE_GATEWAY_TOKEN: secret }, fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  for (const [site, body, expected] of [['https://evil.test', { page }, 403], [origin, { page: { path: '/admin/visitors' } }, 400]]) {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handler({ method: 'POST', headers: { origin: site, 'content-type': 'application/json' }, body }, res);
    assert.equal(res.code, expected);
  }
  assert.equal(calls, 0);
});

test('Qwen uses the shared five-per-day allowance, normalized setup, fixed greeting and server tools', async () => {
  const budget = store();
  const options = { env: { ...qwenEnv, GEMINI_API_KEY: undefined }, budget };
  const a = await fixture(options), b = await fixture(options);
  try {
    const status = await (await fetch(`${a.base}/session`, { headers: { Authorization: `Bearer ${secret}` } })).json();
    assert.equal(status.provider, 'Qwen'); assert.equal(status.model, QWEN_MODEL);
    assert.equal(status.dailyLimit, 5); assert.equal(status.maxSeconds, 120); assert.equal(status.remainingCalls, 5);
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).reserve()));
    assert.equal(attempts.filter(result => result.status === 200).length, 1);
    for (let i = 0; i < 5; i++) {
      const f = i % 2 ? a : b;
      const reservation = i === 0 ? attempts.find(result => result.status === 200) : await f.reserve();
      assert.equal(reservation.status, 200); assert.equal(reservation.data.provider, 'Qwen'); assert.equal(reservation.data.maxSeconds, 120);
      const call = await f.open(reservation.data.ticket), provider = f.providers.at(-1);
      assert.equal(call.events.filter(event => event.setupComplete).length, 1);
      emit(provider, { type: 'session.created' }); emit(provider, { type: 'session.updated' });
      assert.equal(provider.messages.filter(event => event.type === 'session.update').length, 1);
      assert.equal(provider.messages.filter(event => event.type === 'response.create').length, 1);
      const setup = provider.messages.find(event => event.type === 'session.update');
      assert.equal(setup.session.max_tokens, 512); assert.equal(setup.session.audio.input.format.sample_rate, 16000);
      assert.match(provider.messages.find(event => event.item?.type === 'message').item.content[0].text, /Mr\. Pot/);
      if (i === 0) {
        call.client.send(JSON.stringify({ realtimeInput: { audio: { data: 'AAA=', mimeType: 'audio/pcm;rate=16000' } } }));
        call.client.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        await waitFor(() => provider.messages.some(event => event.type === 'input_audio_buffer.clear'));
        assert.equal(provider.messages.find(event => event.type === 'input_audio_buffer.append').audio, 'AAA=');
        emit(provider, { type: 'response.created', response: { id: 'tools' } });
        const tool = { type: 'response.function_call_arguments.done', response_id: 'tools', call_id: 'profile', name: 'get_profile', arguments: '{}' };
        emit(provider, tool); emit(provider, tool);
        assert.deepEqual(JSON.parse(provider.messages.find(event => event.item?.type === 'function_call_output').item.output), profile);
        emit(provider, { type: 'response.done', response: { id: 'tools', status: 'completed' } });
        assert.equal(provider.messages.filter(event => event.type === 'response.create').length, 2);
      }
      call.client.send(JSON.stringify({ type: 'hangup' })); await call.closed;
      assert.equal(provider.readyState, 3); assert.ok(call.events.some(event => event.reason === 'client_hangup'));
    }
    assert.equal((await a.reserve()).status, 429); assert.equal((await b.reserve()).status, 429);
    assert.equal(a.tokens() + b.tokens(), 0); assert.equal(a.providers.length + b.providers.length, 5);
    for (const { url, options } of [...a.connections, ...b.connections]) {
      assert.equal(url, `wss://test-workspace.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=${QWEN_MODEL}`);
      assert.equal(options.headers.Authorization, `Bearer ${qwenEnv.QWEN_LIVE_API_KEY}`);
      assert.equal(options.handshakeTimeout, 10000); assert.equal(options.maxPayload, 1024 * 1024);
      assert.equal(options.followRedirects, false); assert.equal(options.perMessageDeflate, false);
    }
  } finally { await a.close(); await b.close(); }
});

test('provider selection fails closed and Google is only a configured rollback, never a Qwen fallback', async () => {
  for (const env of [{ ...qwenEnv, QWEN_LIVE_API_KEY: '' }, { ...qwenEnv, QWEN_LIVE_MODEL: 'unapproved' }, { VOICE_PROVIDER: 'unknown' }]) {
    const f = await fixture({ env });
    try { assert.equal((await f.reserve()).status, 503); assert.equal(f.tokens(), 0); assert.equal(f.providers.length, 0); }
    finally { await f.close(); }
  }
  const qwen = await fixture({ env: qwenEnv });
  try {
    const call = await qwen.open((await qwen.reserve()).data.ticket);
    emit(qwen.providers[0], { code: 'AccessDenied.Unpurchased', message: 'PRIVATE_PROVIDER_ERROR' }); await call.closed;
    assert.ok(call.events.some(event => event.reason === 'provider_unavailable'));
    assert.equal(qwen.tokens(), 0); assert.equal(qwen.providers.length, 1); assert.equal(JSON.stringify(call.events).includes('PRIVATE'), false);
  } finally { await qwen.close(); }
  const google = await fixture({ env: { ...qwenEnv, VOICE_PROVIDER: 'google' } });
  try {
    const reservation = await google.reserve(); assert.equal(reservation.data.provider, 'Google');
    const call = await google.open(reservation.data.ticket); assert.equal(google.tokens(), 1);
    assert.match(google.connections[0].url, /^wss:\/\/generativelanguage\.googleapis\.com\//);
    call.client.send(JSON.stringify({ type: 'hangup' })); await call.closed;
  } finally { await google.close(); }
});

test('Qwen retains the relay usage, audio output, turn, tool and client-input limits', async () => {
  for (const kind of ['usage', 'output', 'turns', 'tools', 'flood', 'invalid_audio', 'text_injection']) {
    const f = await fixture({ env: qwenEnv });
    try {
      const call = await f.open((await f.reserve()).data.ticket), provider = f.providers[0];
      emit(provider, { type: 'response.created', response: { id: 'r1' } });
      if (kind === 'usage') emit(provider, { type: 'response.done', response: { id: 'r1', status: 'completed', usage: { total_tokens: 17000 } } });
      if (kind === 'output') {
        for (let i = 0; i < 61; i++) {
          emit(provider, { type: 'response.audio.delta', response_id: 'r1', delta: Buffer.alloc(48000).toString('base64') });
          await pause(2);
        }
      }
      if (kind === 'turns') {
        for (let i = 0; i < 9; i++) emit(provider, { type: 'response.done', response: { id: `turn-${i}`, status: 'completed' } });
      }
      if (kind === 'tools') {
        for (let i = 0; i < 7; i++) emit(provider, { type: 'response.function_call_arguments.done', response_id: 'r1', call_id: `tool-${i}`, name: 'read_page', arguments: '{}' });
      }
      if (kind === 'flood') for (let i = 0; i < 30; i++) call.client.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      if (kind === 'invalid_audio') call.client.send(JSON.stringify({ realtimeInput: { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } } }));
      if (kind === 'text_injection') call.client.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Injected client text' }] }] } }));
      await call.closed;
      const reason = kind === 'usage' ? 'usage_limit' : ['output', 'turns'].includes(kind) ? 'output_limit' : kind === 'tools' ? 'tool_limit' : 'invalid_request';
      assert.ok(call.events.some(event => event.reason === reason), kind);
      assert.equal(provider.readyState, 3); assert.equal(f.tokens(), 0);
    } finally { await f.close(); }
  }
});

test('Qwen is stopped by the same independent server deadline', async () => {
  const base = store();
  const f = await fixture({ env: qwenEnv, budget: async (...args) => ({ ...await base(...args), expiresAt: new Date(Date.now() + 140).toISOString() }) });
  try {
    const call = await f.open((await f.reserve()).data.ticket); assert.ok(call.events.some(event => event.setupComplete));
    await call.closed; assert.ok(call.events.some(event => event.reason === 'time_limit'));
    assert.equal(f.providers[0].readyState, 3); assert.equal(f.tokens(), 0);
  } finally { await f.close(); }
});

for (const selection of ['google', 'qwen']) {
  test(`${selection} records normalized transcripts and flushes hangup before relay.closed`, async t => {
    const writes = [], gate = deferred(), logs = [];
    t.mock.method(console, 'log', value => logs.push(JSON.parse(value)));
    const f = await fixture({ env: { ...qwenEnv, VOICE_PROVIDER: selection, ...recordingEnv }, fetchImpl: async (url, init) => {
      writes.push({ url, method: init.method, body: JSON.parse(init.body) });
      if (url.includes('/message?')) await gate.promise;
      return { ok: true };
    } });
    try {
      const call = await f.open((await f.reserve()).data.ticket), provider = f.providers[0];
      assert.match(f.requests[0].url, /\/conversation\?on_conflict=id$/);
      assert.equal(writes[0].body.channel, 'voice'); assert.equal(writes[0].body.status, 'active');
      if (selection === 'qwen') {
        emit(provider, { type: 'response.created', response: { id: 'r1' } });
        emit(provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'input', transcript: 'PRIVATE_VISITOR_WORDS' });
        emit(provider, { type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'PRIVATE_ASSISTANT_WORDS' });
        emit(provider, { type: 'response.audio.delta', response_id: 'r1', delta: 'AAAA' });
      } else emit(provider, { serverContent: { inputTranscription: { text: 'PRIVATE_VISITOR_WORDS' },
        outputTranscription: { text: 'PRIVATE_ASSISTANT_WORDS' }, modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] } } });
      call.client.send(JSON.stringify({ type: 'hangup' }));
      await waitFor(() => writes.some(write => write.url.includes('/message?')));
      assert.equal(provider.readyState, 3, 'provider stops before storage finishes');
      assert.equal(call.client.readyState, WebSocket.OPEN, 'request stays open while storage flushes');
      assert.equal(call.events.some(event => event.type === 'relay.closed'), false);
      const sent = provider.messages.length;
      call.client.send(JSON.stringify({ realtimeInput: { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } } }));
      call.client.send(JSON.stringify({ type: 'hangup' }));
      emit(provider, selection === 'qwen' ? { type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'LATE_WORDS' }
        : { serverContent: { outputTranscription: { text: 'LATE_WORDS' } } });
      await pause(20); assert.equal(provider.messages.length, sent);
      gate.resolve(); await call.closed;
      const end = call.events.find(event => event.type === 'relay.closed');
      assert.equal(end.reason, 'client_hangup'); assert.equal(end.conversationId, writes[0].body.id);
      assert.equal(call.events.filter(event => event.type === 'relay.closed').length, 1);
      const rows = writes.filter(write => write.url.includes('/message?')).flatMap(write => write.body);
      assert.deepEqual(rows.map(row => [row.role, row.content]), [['user', 'PRIVATE_VISITOR_WORDS'], ['assistant', 'PRIVATE_ASSISTANT_WORDS']]);
      assert.ok(rows.every(row => row.conversation_id === end.conversationId && row.metadata_json.provider === (selection === 'qwen' ? 'Qwen' : 'Google')));
      assert.ok(rows.every(row => row.metadata_json.model === (selection === 'qwen' ? QWEN_MODEL : 'gemini-3.8-live')));
      assert.equal(JSON.stringify(writes).includes('AAAA'), false); assert.equal(JSON.stringify(writes).includes('LATE_WORDS'), false);
      assert.equal(writes.at(-1).method, 'PATCH'); assert.equal(writes.at(-1).body.status, 'completed');
      assert.equal(logs.length, 1); assert.equal(logs[0].conversationId, end.conversationId);
      assert.equal(JSON.stringify(logs).includes('PRIVATE_'), false);
      assert.equal(JSON.stringify(call.events).includes(recordingEnv.SUPABASE_SERVICE_ROLE_KEY), false);
    } finally { gate.resolve(); await f.close(); }
  });
}

test('recording starts before a paid connection and a hangup during start closes the inserted row', async () => {
  const gate = deferred(), writes = [];
  const f = await fixture({ env: { ...qwenEnv, ...recordingEnv }, fetchImpl: async (url, init) => {
    writes.push({ url, method: init.method, body: JSON.parse(init.body) });
    if (init.method === 'POST') await gate.promise;
    return { ok: true };
  } });
  try {
    const call = await f.open((await f.reserve()).data.ticket, { waitReady: false });
    await waitFor(() => writes.length === 1); assert.equal(f.providers.length, 0); assert.equal(f.tokens(), 0);
    call.client.send(JSON.stringify({ type: 'hangup' })); await pause(20);
    assert.equal(call.client.readyState, WebSocket.OPEN); assert.equal(call.events.some(event => event.type === 'relay.closed'), false);
    gate.resolve(); await call.closed;
    assert.equal(f.providers.length, 0); assert.equal(writes.at(-1).method, 'PATCH'); assert.equal(writes.at(-1).body.status, 'completed');
    assert.ok(call.events.some(event => event.reason === 'client_hangup' && event.conversationId === writes[0].body.id));
  } finally { gate.resolve(); await f.close(); }
});

test('recording setup failures stop both providers before any paid request', async () => {
  for (const selection of ['google', 'qwen']) {
    for (const missingKey of [false, true]) {
      const f = await fixture({ env: { ...qwenEnv, VOICE_PROVIDER: selection, ...recordingEnv, ...(missingKey ? { SUPABASE_SERVICE_ROLE_KEY: '' } : {}) },
        fetchImpl: async () => ({ ok: false, status: 403, body: { cancel: async () => {} }, private: 'PRIVATE_DATABASE_ERROR' }) });
      try {
        const call = await f.open((await f.reserve()).data.ticket);
        assert.equal(call.client.readyState, 3); assert.ok(call.events.some(event => event.reason === 'history_unavailable'));
        assert.equal(f.tokens(), 0); assert.equal(f.providers.length, 0); assert.equal(JSON.stringify(call.events).includes('PRIVATE'), false);
      } finally { await f.close(); }
    }
  }
});

test('hangup is accepted while a claim, profile load or provider setup is still pending', async () => {
  for (const stage of ['claim', 'profile', 'provider']) {
    const gate = deferred(), base = store(); let entered = false, releases = 0;
    const f = await fixture({ env: qwenEnv, autoSetup: stage !== 'provider',
      budget: async (...args) => {
        if (args[0] === 'claim' && stage === 'claim') { entered = true; await gate.promise; }
        if (args[0] === 'release') releases++;
        return base(...args);
      },
      loadProfile: async () => { if (stage === 'profile') { entered = true; await gate.promise; } return profile; },
    });
    try {
      const call = await f.open((await f.reserve()).data.ticket, { waitReady: false });
      await waitFor(() => stage === 'provider' ? f.providers.length === 1 : entered);
      call.client.send(JSON.stringify({ type: 'hangup' })); await call.closed;
      assert.ok(call.events.some(event => event.reason === 'client_hangup')); assert.equal(call.events.some(event => event.setupComplete), false);
      gate.resolve(); await waitFor(() => releases === 1);
      assert.equal(f.providers.length, stage === 'provider' ? 1 : 0);
      if (stage === 'provider') assert.equal(f.providers[0].readyState, 3);
      assert.equal(f.tokens(), 0);
    } finally { gate.resolve(); await f.close(); }
  }
});

test('a disconnected client still finalizes checkpointed history best effort', async () => {
  const writes = [];
  const f = await fixture({ env: recordingEnv, fetchImpl: async (url, init) => {
    writes.push({ url, method: init.method, body: JSON.parse(init.body) }); return { ok: true };
  } });
  try {
    const call = await f.open((await f.reserve()).data.ticket);
    emit(f.providers[0], { serverContent: { inputTranscription: { text: 'Visitor checkpoint' }, outputTranscription: { text: 'Assistant checkpoint' }, turnComplete: true } });
    await waitFor(() => writes.some(write => write.url.includes('/message?')));
    call.client.terminate(); await call.closed;
    await waitFor(() => writes.some(write => write.method === 'PATCH'));
    assert.equal(writes.at(-1).body.status, 'interrupted'); assert.equal(f.providers[0].readyState, 3);
    assert.equal(writes.filter(write => write.url.includes('/message?')).flatMap(write => write.body).length, 2);
  } finally { await f.close(); }
});

test('history write failures stop a live provider without recursive close or raw errors', async () => {
  const f = await fixture({ env: { ...qwenEnv, ...recordingEnv }, fetchImpl: async url =>
    url.includes('/message?') ? { ok: false, status: 403, body: { cancel: async () => {} } } : { ok: true } });
  try {
    const call = await f.open((await f.reserve()).data.ticket), provider = f.providers[0];
    emit(provider, { type: 'response.created', response: { id: 'r1' } });
    emit(provider, { type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'A reply' });
    emit(provider, { type: 'response.done', response: { id: 'r1', status: 'completed' } });
    await call.closed;
    assert.equal(provider.readyState, 3); assert.equal(call.events.filter(event => event.type === 'relay.closed').length, 1);
    assert.ok(call.events.some(event => event.reason === 'history_unavailable')); assert.equal(f.tokens(), 0);
  } finally { await f.close(); }
});

test('history flush can hold the request socket for no more than six seconds', { timeout: 10000 }, async () => {
  const gate = deferred(); let patchStarted = false;
  const f = await fixture({ env: recordingEnv, fetchImpl: async (_url, init) => {
    if (init.method === 'PATCH') { patchStarted = true; await gate.promise; }
    return { ok: true };
  } });
  try {
    const call = await f.open((await f.reserve()).data.ticket), startedAt = Date.now();
    call.client.send(JSON.stringify({ type: 'hangup' }));
    await waitFor(() => patchStarted); assert.equal(f.providers[0].readyState, 3); assert.equal(call.client.readyState, WebSocket.OPEN);
    await call.closed;
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 5900 && elapsed < 7500, `flush deadline took ${elapsed}ms`);
    assert.ok(call.events.some(event => event.reason === 'client_hangup' && event.conversationId));
  } finally { gate.resolve(); await f.close(); }
});
