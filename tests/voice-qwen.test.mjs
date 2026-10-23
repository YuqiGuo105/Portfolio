import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { QwenLiveSession } from '../src/lib/voice/qwenLive.mjs';
import { GoogleLiveSession } from '../src/lib/voice/googleLive.mjs';
import { createQwenBridge } from '../src/lib/voice/qwenBridge.mjs';
import { qwenSetup, QWEN_MODEL } from '../src/lib/voice/qwenProtocol.mjs';

const page = { path: '/', text: 'Welcome', title: 'Portfolio' };
const profile = { status: 'EVIDENCE_FOUND', facts: ['Master of Computer Science at Syracuse University.'] };
const env = { NODE_ENV: 'development', QWEN_LIVE_ENABLED: 'true', QWEN_LIVE_API_KEY: 'qwen-test-only-key', QWEN_LIVE_WORKSPACE_ID: 'test-workspace', QWEN_LIVE_TRIAL_ACK: 'true' };
const origin = 'http://127.0.0.1:3120';

async function request(bridge, { method = 'POST', headers = {}, data = { page }, address = '127.0.0.1' } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(data))]);
  Object.assign(req, { method, url: '/api/voice/qwen/session', headers: { host: '127.0.0.1:3120', origin, ...headers }, socket: { remoteAddress: address } });
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(code, headers) { this.code = code; Object.assign(this.headers, headers); }, end(raw) { this.data = JSON.parse(raw); } };
  await bridge.http(req, res);
  return res;
}

test('Qwen setup uses shared grounded facts, bounded audio, and only read-only tools', () => {
  const { session } = qwenSetup(page, profile);
  assert.equal(session.max_tokens, 512); assert.equal(session.enable_search, false);
  assert.equal(session.audio.input.format.sample_rate, 16000);
  assert.equal(session.audio.output.format.sample_rate, 24000);
  assert.match(session.instructions, /Syracuse/); assert.match(session.instructions, /郭育奇/);
  assert.deepEqual(session.turn_detection, { type: 'server_vad', threshold: 0.5, silence_duration_ms: 600 });
  assert.deepEqual(session.tools.map(t => t.function.name), ['get_profile', 'read_page', 'navigate_section']);
  assert.equal(session.tools[2].function.parameters.properties.target.type, 'string');
});

test('Qwen requires its own key, workspace and approval; Google credentials never authorize it', async () => {
  for (const missing of ['QWEN_LIVE_API_KEY', 'QWEN_LIVE_WORKSPACE_ID', 'QWEN_LIVE_TRIAL_ACK', 'QWEN_LIVE_ENABLED']) {
    const bridge = createQwenBridge({ env: { ...env, [missing]: '', GEMINI_LIVE_API_KEY: 'never-use' }, loadProfile: () => { throw new Error('No IO'); } });
    try { assert.equal((await request(bridge)).code, 503); assert.equal((await request(bridge, { method: 'GET' })).data.configured, false); }
    finally { bridge.close(); }
  }
});

test('Qwen rejects production, other origins, non-loopback, private paths and unapproved models', async () => {
  for (const extra of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', QWEN_LIVE_UNLIMITED_LOCAL: 'true' }, { QWEN_LIVE_MODEL: 'unapproved-model' }, { QWEN_LIVE_WORKSPACE_ID: 'evil.test/path' }]) {
    const bridge = createQwenBridge({ env: { ...env, ...extra } });
    try { assert.ok([404, 503].includes((await request(bridge)).code)); } finally { bridge.close(); }
  }
  const bridge = createQwenBridge({ env });
  try {
    assert.equal((await request(bridge, { headers: { origin: 'https://evil.test' } })).code, 404);
    assert.equal((await request(bridge, { address: '10.0.0.1' })).code, 404);
    assert.equal((await request(bridge, { data: { page: { path: '/admin/visitors' } } })).code, 400);
    assert.equal((await request(bridge, { data: { page, extra: 'x'.repeat(17000) } })).code, 400);
  } finally { bridge.close(); }
});

test('Qwen tickets are opaque, expire, and calls reserve a non-renewing two-call budget', async () => {
  let time = 1700000000000;
  const bridge = createQwenBridge({ env: { ...env, QWEN_LIVE_MAX_CALLS: '999', QWEN_LIVE_MAX_SECONDS: '999' }, now: () => time, loadProfile: async () => profile });
  try {
    const first = await request(bridge);
    assert.equal(first.code, 200); assert.equal(first.data.maxSeconds, 60);
    assert.match(first.data.ticket, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(first.data).includes(env.QWEN_LIVE_API_KEY), false);
    assert.equal((await request(bridge)).code, 429);
    time += 31000;
    assert.equal((await request(bridge)).code, 200);
    time += 86400000;
    assert.equal((await request(bridge)).code, 429);
    assert.equal((await request(bridge, { method: 'GET' })).data.reason, 'trial_ended');
  } finally { bridge.close(); }
});

test('Qwen approval receipts survive restarts and corrupt receipts fail closed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-trial-test-'));
  const ledger = join(dir, 'trial.jsonl');
  const create = () => createQwenBridge({ env: { ...env, QWEN_LIVE_TRIAL_LEDGER: ledger }, loadProfile: async () => profile });
  let bridge;
  try {
    bridge = create(); assert.equal((await request(bridge)).code, 200); bridge.close();
    bridge = create(); assert.equal((await request(bridge, { method: 'GET' })).data.remainingCalls, 1);
    assert.equal((await request(bridge)).code, 200); bridge.close();
    bridge = create(); assert.equal((await request(bridge)).code, 429); bridge.close();
    writeFileSync(ledger, 'invalid', { mode: 0o600 });
    bridge = create(); assert.equal((await request(bridge)).code, 503);
    assert.equal((await request(bridge, { method: 'GET' })).data.reason, 'trial_unavailable');
  } finally { bridge?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('explicit local unlimited mode bypasses count and duration without changing old receipts or origin guards', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-unlimited-test-'));
  const ledger = join(dir, 'trial.jsonl');
  const receipts = '{"startedAt":1700000000000}\n{"startedAt":1700000000001}\n';
  writeFileSync(ledger, receipts, { mode: 0o600 });
  let time = 1700000000002;
  const bridge = createQwenBridge({ env: { ...env, QWEN_LIVE_UNLIMITED_LOCAL: 'true', QWEN_LIVE_TRIAL_LEDGER: ledger },
    now: () => time, loadProfile: async () => profile });
  try {
    const config = (await request(bridge, { method: 'GET' })).data;
    assert.equal(config.configured, true); assert.equal(config.unlimitedLocal, true);
    assert.equal(config.remainingCalls, null); assert.equal(config.maxSeconds, null);
    assert.equal((await request(bridge, { headers: { origin: 'https://evil.test' } })).code, 404);
    assert.equal((await request(bridge, { headers: { host: 'public.test' } })).code, 404);
    assert.equal((await request(bridge, { address: '10.0.0.1' })).code, 404);
    for (let i = 0; i < 5; i++) {
      const result = await request(bridge);
      assert.equal(result.code, 200); assert.equal(result.data.unlimitedLocal, true);
      assert.equal(result.data.maxSeconds, null); assert.equal(result.data.expiresAt, null);
      assert.equal((await request(bridge)).code, 429, 'pending calls still serialize');
      time += 31000;
    }
    assert.equal((await request(bridge, { method: 'GET' })).data.configured, true);
    assert.equal(readFileSync(ledger, 'utf8'), receipts, 'unlimited mode never rewrites or consumes trial receipts');
  } finally { bridge.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Qwen refuses ungrounded calls without spending the allowance and permits a grounded retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-profile-test-'));
  const diagnostics = [];
  let currentProfile = { status: 'UNAVAILABLE', facts: [] };
  let upstreamCalls = 0;
  const bridge = createQwenBridge({ env: { ...env, QWEN_LIVE_TRIAL_LEDGER: join(dir, 'trial.jsonl') },
    loadProfile: async () => currentProfile, onDiagnostic: event => diagnostics.push(event),
    connect: () => { upstreamCalls++; throw new Error('Must not connect'); } });
  try {
    assert.equal(await bridge.prepare(), false);
    for (const invalid of [null, { status: 'UNAVAILABLE', facts: ['unreviewed'] }, { status: 'EVIDENCE_FOUND', facts: [] }]) {
      currentProfile = invalid;
      const result = await request(bridge);
      assert.equal(result.code, 503); assert.equal(result.data.reason, 'profile_unavailable');
      assert.equal((await request(bridge, { method: 'GET' })).data.remainingCalls, 2);
    }
    assert.equal(upstreamCalls, 0);
    currentProfile = profile;
    assert.equal(await bridge.prepare(), true);
    assert.equal((await request(bridge, { method: 'GET' })).data.remainingCalls, 2);
    assert.equal((await request(bridge)).code, 200);
    assert.equal((await request(bridge, { method: 'GET' })).data.remainingCalls, 1);
    assert.ok(diagnostics.some(event => event.stage === 'profile_loaded' && event.ready));
    assert.equal(JSON.stringify(diagnostics).includes('Syracuse'), false);
  } finally { bridge.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Qwen profile errors release the pending lock and simultaneous preparation cannot double book', async () => {
  let finish, reads = 0;
  const bridge = createQwenBridge({ env, loadProfile: () => { reads++; return new Promise(resolve => { finish = resolve; }); } });
  try {
    const pending = request(bridge);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await request(bridge)).code, 429);
    assert.equal(reads, 1);
    finish(profile);
    assert.equal((await pending).code, 200);
    assert.equal((await request(bridge, { method: 'GET' })).data.remainingCalls, 1);
  } finally { bridge.close(); }
  let fail = true;
  const retryBridge = createQwenBridge({ env, loadProfile: async () => { if (fail) throw new Error('Private upstream error'); return profile; } });
  try {
    assert.equal((await request(retryBridge)).code, 502);
    assert.equal((await request(retryBridge, { method: 'GET' })).data.remainingCalls, 2);
    fail = false;
    assert.equal((await request(retryBridge)).code, 200);
  } finally { retryBridge.close(); }
});

function harness(config = {}) {
  const sent = [], turns = [], actions = [];
  let socket;
  const audio = { closes: 0, plays: 0, start: async () => {}, enable() {}, mute() {}, play() { this.plays++; this.callbacks.onPlayback(true); }, stopPlayback() {}, close() { this.closes++; } };
  const session = new QwenLiveSession({ readPage: () => page, onState() {}, onTranscript: t => turns.push(t), onNavigation: a => actions.push(a),
    audioFactory: callbacks => { audio.callbacks = callbacks; return audio; },
    fetchImpl: async url => { assert.equal(url, '/api/voice/qwen/session'); return { ok: true, json: async () => ({ ticket: 'a'.repeat(64), socketPath: '/api/voice/qwen/socket', profile, maxSeconds: 60, ...config }) }; },
    socketFactory: url => {
      assert.equal(url, 'ws://127.0.0.1/api/voice/qwen/socket');
      socket = {
        readyState: 1, bufferedAmount: 0, closeCalls: 0,
        send: raw => sent.push(JSON.parse(raw)),
        close() { this.closeCalls++; this.remoteClose(); },
        remoteClose() { this.readyState = 3; this.onclose?.(); },
      };
      return socket;
    },
  });
  return { session, audio, sent, turns, actions, get socket() { return socket; }, cleanup() { session.close(); socket?.remoteClose(); } };
}

test('browser skips the conversation timer only for explicit development Qwen on loopback', async t => {
  const nodeEnv = process.env.NODE_ENV;
  const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const config = { unlimitedLocal: true, maxSeconds: null, expiresAt: null };
  const h = harness(config);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    process.env.NODE_ENV = 'development';
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: '127.0.0.1', origin: 'http://127.0.0.1' } });
    assert.equal(h.session.callDurationMs(config), null);
    assert.ok(GoogleLiveSession.prototype.callDurationMs(config) > 0, 'Google always retains its deadline');
    assert.ok(h.session.callDurationMs({ ...config, unlimitedLocal: 'true' }) > 0);
    assert.ok(h.session.callDurationMs({ ...config, maxSeconds: 60 }) > 0);
    process.env.NODE_ENV = 'production';
    assert.ok(h.session.callDurationMs(config) > 0);
    process.env.NODE_ENV = 'development';
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'www.yuqi.site' } });
    assert.ok(h.session.callDurationMs(config) > 0);
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: '127.0.0.1', origin: 'http://127.0.0.1' } });
    await h.session.start(); h.socket.onopen(); h.session.handle({ type: 'session.updated' });
    assert.equal(h.session.callTimer == null, true);
    t.mock.timers.tick(86400000);
    assert.equal(h.session.status, 'listening'); assert.equal(h.session.closed, false);
    let audioClosed = false;
    h.audio.close = () => { audioClosed = true; };
    h.session.close();
    assert.equal(audioClosed, true); assert.equal(h.socket.readyState, 1);
    assert.deepEqual(h.sent.at(-1), { type: 'hangup' });
    t.mock.timers.tick(6499);
    assert.equal(h.socket.readyState, 1);
    t.mock.timers.tick(1);
    assert.equal(h.socket.readyState, 3); assert.equal(h.socket.closeCalls, 1);
  } finally {
    h.cleanup();
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
    if (location) Object.defineProperty(globalThis, 'location', location); else delete globalThis.location;
  }
});

test('Qwen hangup stops audio before notifying the bridge, ignores late bytes and awaits remote socket close', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  try {
    await h.session.start(); h.socket.onopen(); h.session.handle({ type: 'session.updated' });
    const receive = h.socket.onmessage;
    const send = h.socket.send;
    h.socket.send = raw => {
      if (JSON.parse(raw).type === 'hangup') assert.equal(h.audio.closes, 1, 'audio closes before hangup');
      send(raw);
    };
    h.session.close();
    assert.equal(h.audio.closes, 1); assert.equal(h.session.closed, true); assert.equal(h.session.ready, false);
    assert.equal(h.session.socket, null); assert.equal(h.socket.readyState, 1);
    assert.deepEqual(h.sent.at(-1), { type: 'hangup' });
    for (const name of ['onopen', 'onmessage', 'onerror']) assert.equal(h.socket[name], null);
    const sent = h.sent.length, turns = h.turns.length;
    h.audio.callbacks.onPcm(new Int16Array([100]).buffer);
    h.audio.callbacks.onPlayback(true);
    h.session.raw({ type: 'input_audio_buffer.append', audio: 'AAAA' });
    h.session.send({ realtimeInput: { audio: { data: 'AAAA' } } });
    h.session.handle({ type: 'response.audio_transcript.delta', delta: 'late transcript' });
    h.session.handle({ type: 'response.audio.delta', delta: 'AAAA' });
    receive({ data: '{"type":"response.audio.delta","delta":"AAAA"}' });
    await Promise.resolve();
    assert.equal(h.sent.length, sent, 'no provider-bound bytes follow hangup');
    assert.equal(h.turns.length, turns); assert.equal(h.audio.plays, 0);
    assert.equal(h.session.status, 'ended');
    h.session.close();
    assert.equal(h.audio.closes, 1); assert.equal(h.sent.filter(event => event.type === 'hangup').length, 1);
    h.socket.remoteClose();
    assert.equal(h.socket.readyState, 3);
    t.mock.timers.tick(6500);
    assert.equal(h.socket.closeCalls, 0, 'remote close cancels the fallback timer');
  } finally { h.cleanup(); }
});

test('Qwen duplex playback, captions, barge-in and late response suppression reuse the same lifecycle', async () => {
  const h = harness();
  try {
    await h.session.start(); h.socket.onopen(); assert.equal(h.sent[0].type, 'connect');
    h.session.handle({ type: 'session.updated' }); assert.equal(h.session.status, 'listening');
    h.audio.callbacks.onPcm(new Int16Array([50, -50]).buffer); assert.equal(h.sent.at(-1).type, 'input_audio_buffer.append');
    h.session.handle({ type: 'response.created', response: { id: 'r1' } });
    h.session.handle({ type: 'conversation.item.input_audio_transcription.completed', transcript: '学历？' });
    h.session.handle({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'Syracuse University.' });
    h.session.handle({ type: 'response.audio.delta', response_id: 'r1', delta: 'AAAA' });
    h.session.handle({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    assert.equal(h.session.status, 'speaking'); assert.equal(h.turns.at(-1).final, false);
    h.audio.callbacks.onPlayback(false); assert.equal(h.turns.at(-1).completion, 'complete');
    h.session.handle({ type: 'response.created', response: { id: 'r2' } });
    h.session.handle({ type: 'response.audio_transcript.delta', response_id: 'r2', delta: 'Old answer' });
    h.session.handle({ type: 'input_audio_buffer.speech_started' });
    assert.equal(h.turns.at(-1).completion, 'interrupted');
    h.session.handle({ type: 'response.audio_transcript.delta', response_id: 'r2', delta: 'stale' });
    assert.equal(h.session.transcript.assistant, '');
    h.session.mute(true); assert.equal(h.sent.at(-1).type, 'input_audio_buffer.clear');
    h.session.pageChanged(); assert.equal(h.session.closed, true);
  } finally { h.cleanup(); }
});

test('Qwen unavailable profile ends the microphone session without connecting a websocket', async () => {
  const h = harness();
  let closed = false;
  h.audio.close = () => { closed = true; };
  h.session.fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ reason: 'profile_unavailable' }) });
  try {
    await h.session.start();
    assert.equal(h.socket, undefined); assert.equal(closed, true);
    assert.equal(h.session.closed, true);
    assert.match(h.session.stateError, /No call was started/);
  } finally { h.cleanup(); }
});

test('Qwen tools require a user click for navigation and continue only after tool response completion', async () => {
  const h = harness();
  try {
    await h.session.start(); h.socket.onopen(); h.session.handle({ type: 'session.updated' });
    h.session.handle({ type: 'response.created', response: { id: 'tools' } });
    h.session.handle({ type: 'response.function_call_arguments.done', call_id: 'profile', name: 'get_profile', arguments: '{}' });
    assert.match(h.sent.at(-1).item.output, /Syracuse/);
    h.session.handle({ type: 'response.function_call_arguments.done', call_id: 'nav', name: 'navigate_section', arguments: '{"target":"background"}' });
    assert.equal(h.actions.at(-1).href, '/#tour-background');
    assert.equal(h.sent.some(m => m.type === 'response.create'), false);
    h.session.handle({ type: 'response.done', response: { id: 'tools', status: 'completed' } });
    assert.equal(h.sent.at(-1).type, 'response.create');
    h.session.handle({ type: 'input_audio_buffer.speech_started' }); assert.equal(h.actions.at(-1), null);
    h.session.handle({ type: 'error', error: { message: 'secret-key-upstream' } });
    assert.equal(h.session.stateError.includes('secret-key'), false);
  } finally { h.cleanup(); }
});

test('Qwen reports model activation errors without reflecting provider messages', async () => {
  const h = harness();
  try {
    await h.session.start();
    h.session.handle({ type: 'error', error: { code: 'model_not_activated', message: 'secret-key-upstream' } });
    assert.equal(h.session.closed, true);
    assert.match(h.session.stateError, /not activated/);
    assert.equal(h.session.stateError.includes('secret-key'), false);
  } finally { h.cleanup(); }
});

test('Qwen handles both realtime errors and untyped gateway failures safely', async () => {
  for (const type of [undefined, 'error']) {
    const diagnostics = [];
    const bridge = createQwenBridge({ env, loadProfile: async () => profile, onDiagnostic: event => diagnostics.push(event),
      connect: () => {
        const provider = new EventEmitter(); provider.readyState = 1;
        provider.terminate = () => { provider.readyState = 3; provider.emit('close', 1000); };
        queueMicrotask(() => provider.emit('message', Buffer.from(JSON.stringify(type
          ? { type, error: { code: 'AccessDenied.Unpurchased', message: 'SECRET_PROVIDER_MESSAGE' } }
          : { code: 'AccessDenied.Unpurchased', message: 'SECRET_PROVIDER_MESSAGE', request_id: 'private-id' }))));
        return provider;
      } });
    const server = createServer((req, res) => bridge.http(req, res));
    server.on('upgrade', bridge.upgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    let client;
    try {
      const token = await (await fetch(`${base}/api/voice/qwen/session`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) })).json();
      client = new WebSocket(`${base.replace('http:', 'ws:')}/api/voice/qwen/socket`, { headers: { Origin: base } });
      await once(client, 'open'); client.send(JSON.stringify({ type: 'connect', ticket: token.ticket }));
      const [raw] = await once(client, 'message');
      assert.deepEqual(JSON.parse(raw), { type: 'error', error: { code: 'model_not_activated' } });
      await once(client, 'close');
      assert.ok(diagnostics.some(event => event.stage === 'provider_rejected' && event.code === 'AccessDenied.Unpurchased'));
      assert.equal(JSON.stringify(diagnostics).includes('SECRET_PROVIDER_MESSAGE'), false);
    } finally { client?.terminate(); bridge.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

test('local Qwen bridge persists normalized transcripts and flushes hangup before closing the socket', async () => {
  let provider, client, releasePatch, patchStarted, finalized = false;
  let time = Date.parse('2026-10-22T12:00:00Z');
  const patchGate = new Promise(resolve => { releasePatch = resolve; });
  const patchReached = new Promise(resolve => { patchStarted = resolve; });
  const writes = [], rows = new Map(), outgoing = [], received = [];
  const bridge = createQwenBridge({
    env: { ...env, VOICE_RECORD_TRANSCRIPTS: 'true', SUPABASE_URL: 'https://voice-history.fixture.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role' },
    now: () => time, loadProfile: async () => profile,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url), body = JSON.parse(options.body);
      assert.equal(parsed.origin, 'https://voice-history.fixture.test');
      assert.equal(options.headers.Authorization, 'Bearer fixture-service-role');
      assert.equal(options.redirect, 'error');
      writes.push({ path: parsed.pathname, method: options.method, body });
      if (parsed.pathname === '/rest/v1/message') for (const row of body) rows.set(row.id, row);
      if (options.method === 'PATCH') { patchStarted(); await patchGate; finalized = true; }
      return { ok: true };
    },
    connect: () => {
      assert.equal(writes[0].body.status, 'active', 'the call record exists before the provider connects');
      provider = new EventEmitter(); provider.readyState = 1; provider.bufferedAmount = 0;
      provider.send = raw => {
        const event = JSON.parse(raw); outgoing.push(event);
        if (event.type === 'session.update') queueMicrotask(() => provider.emit('message', Buffer.from('{"type":"session.updated"}')));
      };
      provider.terminate = () => { provider.readyState = 3; provider.emit('close', 1000); };
      queueMicrotask(() => provider.emit('message', Buffer.from('{"type":"session.created"}')));
      return provider;
    },
  });
  const server = createServer((req, res) => bridge.http(req, res));
  server.on('upgrade', bridge.upgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const emit = event => provider.emit('message', Buffer.from(JSON.stringify(event)));
  try {
    const token = await (await fetch(`${base}/api/voice/qwen/session`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) })).json();
    client = new WebSocket(`${base.replace('http:', 'ws:')}/api/voice/qwen/socket`, { headers: { Origin: base } });
    client.on('message', raw => received.push(JSON.parse(raw)));
    await once(client, 'open');
    const ready = once(client, 'message');
    client.send(JSON.stringify({ type: 'connect', ticket: token.ticket }));
    assert.equal(JSON.parse((await ready)[0]).type, 'session.updated');
    emit({ type: 'response.created', response: { id: 'first' } });
    emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'First question' });
    emit({ type: 'response.audio_transcript.delta', response_id: 'first', delta: 'Generated ' });
    emit({ type: 'response.audio_transcript.delta', response_id: 'first', delta: 'answer' });
    emit({ type: 'response.audio.delta', response_id: 'first', delta: 'fixture-audio-not-for-storage' });
    emit({ type: 'response.done', response: { id: 'first', status: 'completed' } });
    time += 1000;
    emit({ type: 'response.created', response: { id: 'interrupted' } });
    emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Second question' });
    emit({ type: 'response.audio_transcript.delta', response_id: 'interrupted', delta: 'Interrupted answer' });
    emit({ type: 'input_audio_buffer.speech_started' });
    emit({ type: 'response.audio_transcript.delta', response_id: 'interrupted', delta: 'STALE_TRANSCRIPT' });
    emit({ type: 'response.done', response: { id: 'interrupted', status: 'completed' } });
    time += 1000;
    emit({ type: 'response.created', response: { id: 'partial' } });
    emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Third question' });
    emit({ type: 'response.audio_transcript.delta', response_id: 'partial', delta: 'Hangup partial' });
    time += 1000;
    const endedAt = new Date(time).toISOString();
    const closed = once(client, 'close');
    client.send(JSON.stringify({ type: 'hangup' }));
    await patchReached;
    assert.equal(provider.readyState, 3, 'provider audio stops before database finalization');
    assert.equal(client.readyState, WebSocket.OPEN, 'the browser socket remains open for the final database write');
    assert.equal(finalized, false);
    const sent = outgoing.length;
    client.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AAAA' }));
    emit({ type: 'response.audio_transcript.delta', response_id: 'partial', delta: 'AFTER_HANGUP' });
    emit({ type: 'response.audio.delta', response_id: 'partial', delta: 'AFTER_HANGUP_AUDIO' });
    time += 5000;
    releasePatch(); await closed;
    assert.equal(finalized, true); assert.equal(client.readyState, WebSocket.CLOSED);
    assert.equal(outgoing.length, sent, 'hangup and subsequent browser bytes never reach the provider');
    assert.equal(writes.filter(write => write.path === '/rest/v1/conversation' && write.method === 'POST').length, 1);
    assert.equal(writes.filter(write => write.method === 'PATCH').length, 1);
    assert.equal(writes[0].body.channel, 'voice-local');
    assert.equal(writes.at(-1).body.status, 'completed');
    assert.equal(writes.at(-1).body.updated_at, endedAt, 'database latency is not added to call duration');
    const transcript = [...rows.values()].sort((a, b) => a.metadata_json.sequence - b.metadata_json.sequence);
    assert.deepEqual(transcript.map(row => [row.role, row.content, row.metadata_json.completion, row.metadata_json.sequence]), [
      ['user', 'First question', 'transcribed', 1], ['assistant', 'Generated answer', 'generated', 2],
      ['user', 'Second question', 'transcribed', 3], ['assistant', 'Interrupted answer', 'interrupted', 4],
      ['user', 'Third question', 'transcribed', 5], ['assistant', 'Hangup partial', 'call-ended', 6],
    ]);
    for (const row of transcript) {
      assert.match(row.id, /^[a-f0-9-]{36}$/);
      assert.equal(row.conversation_id, writes[0].body.id);
      assert.equal(row.metadata_json.provider, 'Qwen'); assert.equal(row.metadata_json.model, QWEN_MODEL);
      assert.equal(row.metadata_json.source, 'voice'); assert.equal(row.metadata_json.environment, 'development');
      assert.equal(row.metadata_json.pagePath, '/'); assert.ok(Number.isFinite(Date.parse(row.created_at)));
    }
    assert.doesNotMatch(JSON.stringify(writes), /fixture-audio-not-for-storage|STALE_TRANSCRIPT|AFTER_HANGUP|fixture-service-role/);
    assert.doesNotMatch(JSON.stringify(received), /STALE_TRANSCRIPT|AFTER_HANGUP/);
  } finally {
    releasePatch(); client?.terminate(); bridge.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('real local websocket relay guards key, model, single use, event allowlist and server-side time cap', async () => {
  let provider, providerOptions, providerUrl;
  const outgoing = [];
  const bridge = createQwenBridge({ env: { ...env, QWEN_LIVE_MAX_SECONDS: '1' }, loadProfile: async () => profile,
    connect: (url, options) => {
      providerUrl = url; providerOptions = options;
      provider = new EventEmitter(); provider.readyState = 1; provider.bufferedAmount = 0;
      provider.send = raw => {
        const event = JSON.parse(raw);
        assert.match(event.event_id, /^event_[a-f0-9-]{36}$/);
        assert.equal(outgoing.some(previous => previous.event_id === event.event_id), false);
        outgoing.push(event);
        if (event.type === 'session.update') queueMicrotask(() => provider.emit('message', Buffer.from('{"type":"session.updated"}')));
        if (event.type === 'input_audio_buffer.append') queueMicrotask(() => provider.emit('message', Buffer.from('{"type":"input_audio_buffer.speech_started"}')));
      };
      provider.terminate = () => { provider.readyState = 3; provider.emit('close'); };
      queueMicrotask(() => {
        provider.emit('open');
        const before = outgoing.length;
        provider.emit('message', Buffer.from('{"type":"session.created"}'));
        provider.emit('message', Buffer.from('{"type":"session.created"}'));
        assert.equal(outgoing.length, before + 1, 'duplicate creation must not repeat setup');
      });
      return provider;
    } });
  const server = createServer((req, res) => bridge.http(req, res));
  server.on('upgrade', bridge.upgrade);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const auth = async () => (await fetch(`${base}/api/voice/qwen/session`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) })).json();
  async function socket(ticket) {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/voice/qwen/socket`, { headers: { Origin: base } });
    clients.push(ws); await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'connect', ticket })); return ws;
  }
  try {
    const token = await auth();
    const ws = await socket(token.ticket);
    const [raw] = await once(ws, 'message'); assert.deepEqual(JSON.parse(raw), { type: 'session.updated' });
    assert.equal(providerOptions.headers.Authorization, `Bearer ${env.QWEN_LIVE_API_KEY}`);
    assert.equal(providerOptions.followRedirects, false);
    assert.equal(providerUrl, `wss://test-workspace.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=${QWEN_MODEL}`);
    assert.equal(outgoing[0].session.enable_search, false);
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AAAA' }));
    await once(ws, 'message');
    assert.equal(outgoing.at(-1).type, 'input_audio_buffer.append');
    await once(ws, 'close'); assert.equal(provider.readyState, 3, 'server enforces deadline independently');
    const reused = await socket(token.ticket); const [denied] = await once(reused, 'message'); assert.equal(JSON.parse(denied).type, 'error');
    await once(reused, 'close');
    const second = await auth(); const bad = await socket(second.ticket); await once(bad, 'message');
    bad.send(JSON.stringify({ type: 'session.update', session: { max_tokens: 999999 } }));
    await once(bad, 'close'); assert.equal(provider.readyState, 3);
    assert.equal((await fetch(`${base}/api/voice/qwen/session`)).status, 200);
    assert.equal((await auth()).error.includes('limit'), true);
  } finally {
    for (const client of clients) client.terminate(); bridge.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('unlimited local websocket has no call deadline but keeps ticket expiry, single use and disconnect cleanup', async () => {
  let provider, connections = 0, time = Date.now();
  const diagnostics = [];
  const bridge = createQwenBridge({ env: { ...env, QWEN_LIVE_UNLIMITED_LOCAL: 'true', QWEN_LIVE_MAX_SECONDS: '1', QWEN_LIVE_MAX_CALLS: '1' },
    now: () => time, loadProfile: async () => profile, onDiagnostic: event => diagnostics.push(event),
    connect: () => {
      connections++;
      provider = new EventEmitter(); provider.readyState = 1; provider.bufferedAmount = 0;
      provider.send = raw => {
        if (JSON.parse(raw).type === 'session.update') queueMicrotask(() => provider.emit('message', Buffer.from('{"type":"session.updated"}')));
      };
      provider.terminate = () => { provider.readyState = 3; provider.emit('close'); };
      queueMicrotask(() => provider.emit('message', Buffer.from('{"type":"session.created"}')));
      return provider;
    } });
  const server = createServer((req, res) => bridge.http(req, res));
  server.on('upgrade', bridge.upgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const auth = () => fetch(`${base}/api/voice/qwen/session`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) });
  const socket = async ticket => {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/voice/qwen/socket`, { headers: { Origin: base } });
    clients.push(ws); await once(ws, 'open'); ws.send(JSON.stringify({ type: 'connect', ticket })); return ws;
  };
  try {
    const expired = await (await auth()).json(); time += 31000;
    const stale = await socket(expired.ticket);
    assert.equal(JSON.parse((await once(stale, 'message'))[0]).type, 'error');
    await once(stale, 'close'); assert.equal(connections, 0);
    for (let i = 0; i < 3; i++) {
      const token = await (await auth()).json();
      assert.equal(token.expiresAt, null);
      const ws = await socket(token.ticket);
      assert.equal(JSON.parse((await once(ws, 'message'))[0]).type, 'session.updated');
      assert.equal((await auth()).status, 429, 'active call remains exclusive');
      const replay = await socket(token.ticket);
      assert.equal(JSON.parse((await once(replay, 'message'))[0]).type, 'error');
      await once(replay, 'close');
      if (i === 0) await new Promise(resolve => setTimeout(resolve, 1200));
      assert.equal(ws.readyState, WebSocket.OPEN); assert.equal(provider.readyState, 1);
      const stopped = once(provider, 'close');
      ws.close(); await stopped;
      assert.equal(provider.readyState, 3);
    }
    assert.equal(connections, 3);
    assert.equal(diagnostics.some(event => event.stage === 'call_deadline'), false);
  } finally {
    for (const client of clients) client.terminate(); bridge.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
