import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import WebSocket from 'ws';
import { QwenLiveSession } from '../src/lib/voice/qwenLive.mjs';
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
  for (const extra of [{ NODE_ENV: 'production' }, { QWEN_LIVE_MODEL: 'unapproved-model' }, { QWEN_LIVE_WORKSPACE_ID: 'evil.test/path' }]) {
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

function harness() {
  const sent = [], turns = [], actions = [];
  let socket;
  const audio = { start: async () => {}, enable() {}, mute() {}, play() { this.callbacks.onPlayback(true); }, stopPlayback() {}, close() {} };
  const session = new QwenLiveSession({ readPage: () => page, onState() {}, onTranscript: t => turns.push(t), onNavigation: a => actions.push(a),
    audioFactory: callbacks => { audio.callbacks = callbacks; return audio; },
    fetchImpl: async url => { assert.equal(url, '/api/voice/qwen/session'); return { ok: true, json: async () => ({ ticket: 'a'.repeat(64), socketPath: '/api/voice/qwen/socket', profile, maxSeconds: 60 }) }; },
    socketFactory: url => { assert.equal(url, 'ws://127.0.0.1/api/voice/qwen/socket'); socket = { readyState: 1, bufferedAmount: 0, send: raw => sent.push(JSON.parse(raw)), close() { this.readyState = 3; } }; return socket; },
  });
  return { session, audio, sent, turns, actions, get socket() { return socket; } };
}

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
  } finally { h.session.close(); }
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
  } finally { h.session.close(); }
});

test('real local websocket relay guards key, model, single use, event allowlist and server-side time cap', async () => {
  let provider, providerOptions, providerUrl;
  const outgoing = [];
  const bridge = createQwenBridge({ env: { ...env, QWEN_LIVE_MAX_SECONDS: '1' }, loadProfile: async () => profile,
    connect: (url, options) => {
      providerUrl = url; providerOptions = options;
      provider = new EventEmitter(); provider.readyState = 1; provider.bufferedAmount = 0;
      provider.send = raw => { outgoing.push(JSON.parse(raw)); if (outgoing.at(-1).type === 'session.update') queueMicrotask(() => provider.emit('message', Buffer.from('{"type":"session.updated"}'))); };
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
