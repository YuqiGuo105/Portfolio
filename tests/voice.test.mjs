import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionHandler as createBaseSessionHandler, isLocalVoiceRequest } from '../src/lib/voice/sessionServer.mjs';
import { createProfileLoader, fetchPublicProfile, publicProfileEvidence, PROFILE_UNAVAILABLE } from '../src/lib/voice/publicProfile.mjs';
import { cleanPageContext, wireSetup, liveConfig } from '../src/lib/voice/protocol.mjs';
import { GoogleLiveSession } from '../src/lib/voice/googleLive.mjs';

const env = { NODE_ENV: 'development', GEMINI_LIVE_ENABLED: 'true', GEMINI_LIVE_API_KEY: 'server-only-test-key', GEMINI_LIVE_BILLING_ACK: 'true' };
const profile = { status: 'EVIDENCE_FOUND', facts: ['Master of Computer Science, Syracuse University; Bachelor of Information and Computing Science, University of Liverpool.'], experience: [], url: 'https://www.yuqi.site/cv' };
const createSessionHandler = options => createBaseSessionHandler({ loadProfile: async () => profile, ...options });
const page = { path: '/', title: 'Portfolio', text: 'Public page' };
const request = (overrides = {}) => ({ method: 'POST', headers: { origin: 'http://127.0.0.1:3118', host: '127.0.0.1:3118' }, socket: { remoteAddress: '127.0.0.1' }, body: { page }, ...overrides });
function response() { return { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } }; }

test('local session endpoint fails closed for production, remote and cross-origin access', () => {
  assert.equal(isLocalVoiceRequest(request(), env), true);
  for (const config of [{ ...env, NODE_ENV: 'production' }, { ...env, GEMINI_LIVE_ENABLED: '' }]) assert.equal(isLocalVoiceRequest(request(), config), false);
  for (const req of [request({ socket: { remoteAddress: '192.168.0.3' } }), request({ headers: { host: 'evil.test', origin: 'http://evil.test' } }), request({ headers: { host: '127.0.0.1:3118', origin: 'https://evil.test' } }), request({ headers: { host: '127.0.0.1:3118' } })]) assert.equal(isLocalVoiceRequest(req, env), false);
});

test('missing dedicated key or billing acknowledgement never calls Google', async () => {
  for (const config of [{ ...env, GEMINI_LIVE_API_KEY: '', GEMINI_API_KEY: 'do-not-reuse' }, { ...env, GEMINI_LIVE_BILLING_ACK: '' }]) {
    const handler = createSessionHandler({ env: config, fetchImpl: () => { throw new Error('Must not call Google'); } });
    const res = response(); await handler(request(), res); assert.equal(res.code, 503);
  }
});

test('token is single use, short lived, model constrained; long lived key never returned', async () => {
  let body;
  const time = 1700000000000;
  const handler = createSessionHandler({ env, now: () => time, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/auth_tokens');
    assert.equal(options.headers['x-goog-api-key'], env.GEMINI_LIVE_API_KEY);
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ name: 'auth_tokens/temporary' }) };
  } });
  const res = response(); await handler(request(), res);
  assert.equal(res.code, 200); assert.equal(body.uses, 1);
  assert.equal(Date.parse(body.newSessionExpireTime) - time, 30000);
  assert.equal(Date.parse(body.expireTime) - time, 180000);
  assert.equal(body.bidiGenerateContentSetup.model, 'models/gemini-3.8-live');
  assert.deepEqual(body.bidiGenerateContentSetup.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(body.liveConnectConstraints, undefined, 'SDK field name must not leak into raw REST');
  assert.deepEqual(res.data.setup.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(JSON.stringify(res.data).includes(env.GEMINI_LIVE_API_KEY), false);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(res.data.profile, profile);
  assert.match(body.bidiGenerateContentSetup.systemInstruction.parts[0].text, /Syracuse University/);
  assert.match(body.bidiGenerateContentSetup.systemInstruction.parts[0].text, /University of Liverpool/);
});

test('real-test limits constrain token lifetime, generation and number of calls', async () => {
  let body;
  const time = 1700000000000;
  const handler = createSessionHandler({ env: { ...env, GEMINI_LIVE_MAX_SECONDS: '60', GEMINI_LIVE_MAX_CALLS: '1', GEMINI_LIVE_MAX_OUTPUT_TOKENS: '256' }, now: () => time,
    fetchImpl: async (url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ name: 'auth_tokens/test' }) }; } });
  const first = response(); await handler(request(), first);
  assert.equal(first.data.maxSeconds, 60);
  assert.equal(Date.parse(body.expireTime) - time, 60000);
  assert.equal(body.bidiGenerateContentSetup.generationConfig.maxOutputTokens, 256);
  const second = response(); await handler(request(), second); assert.equal(second.code, 429);
});

test('quota and provider failures are bounded and redact upstream details', async () => {
  const handler = createSessionHandler({ env, fetchImpl: async () => { throw new Error(env.GEMINI_LIVE_API_KEY); } });
  for (let i = 0; i < 4; i++) {
    const res = response(); await handler(request(), res);
    assert.equal(res.code, i < 3 ? 502 : 429);
    assert.equal(JSON.stringify(res.data).includes(env.GEMINI_LIVE_API_KEY), false);
  }
});

test('approved trial survives handler reloads, reports exhaustion and fails closed on corrupt receipts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'voice-allowance-'));
  const ledger = join(directory, 'calls.jsonl');
  const options = { env: { ...env, GEMINI_LIVE_TRIAL_LEDGER: ledger, GEMINI_LIVE_MAX_CALLS: '1' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ name: 'auth_tokens/test' }) }) };
  try {
    const first = createSessionHandler(options);
    const status = response(); await first(request({ method: 'GET' }), status);
    assert.equal(status.data.remainingCalls, 1);
    const call = response(); await first(request(), call); assert.equal(call.code, 200);
    const reloaded = createSessionHandler(options);
    const exhausted = response(); await reloaded(request({ method: 'GET' }), exhausted);
    assert.equal(exhausted.data.configured, false);
    assert.equal(exhausted.data.remainingCalls, 0);
    assert.equal(exhausted.data.reason, 'trial_ended');
    const blocked = response(); await reloaded(request(), blocked); assert.equal(blocked.code, 429);
    writeFileSync(ledger, 'invalid');
    const corrupt = response(); await reloaded(request(), corrupt); assert.equal(corrupt.code, 503);
  } finally { rmSync(directory, { recursive: true }); }
});

test('rejects private and malformed context, limits public text', () => {
  for (const path of ['/admin/visitors', '/oauth/consent', '/life-blog/private', '//evil.test', '/api/token', '/work-single/abc?secret=x']) assert.equal(cleanPageContext({ path }), null);
  assert.equal(cleanPageContext({ ...page, text: 'a'.repeat(20000) }).text.length, 6000);
  const setup = wireSetup('gemini-3.8-live', liveConfig(page));
  assert.deepEqual(setup.tools[0].functionDeclarations.map(t => t.name), ['get_profile', 'read_page', 'navigate_section']);
});

function harness(overrides = {}) {
  const events = [], sent = [], turns = [], actions = [];
  let socket;
  const audio = { starts: 0, stops: 0, closes: 0, plays: 0, start: async () => { audio.starts++; }, enable() {}, mute(v) { audio.muted = v; }, play() { audio.plays++; }, stopPlayback() { audio.stops++; }, close() { audio.closes++; } };
  const session = new GoogleLiveSession({
    readPage: () => page, onState: s => events.push(s), onTranscript: t => turns.push(t), onNavigation: a => actions.push(a),
    audioFactory: callbacks => { audio.callbacks = callbacks; return audio; },
    socketFactory: url => { assert.match(url, /Constrained\?access_token=auth_tokens%2Ftemporary$/); socket = { readyState: 1, bufferedAmount: 0, send: x => sent.push(JSON.parse(x)), close() { this.readyState = 3; } }; return socket; },
    fetchImpl: async () => ({ ok: true, json: async () => ({ token: 'auth_tokens/temporary', profile, setup: wireSetup('gemini-3.8-live', liveConfig(page, profile)), maxSeconds: 180 }) }),
    ...overrides,
  });
  return { session, audio, events, sent, turns, actions, get socket() { return socket; } };
}

test('full protocol: setup, duplex audio, transcripts, mute, interruption and cleanup', async () => {
  const h = harness();
  try {
    await h.session.start(); h.socket.onopen();
    assert.ok(h.sent[0].setup); h.session.handle({ setupComplete: {} });
    assert.equal(h.events.at(-1).status, 'listening');
    assert.equal(h.sent.filter(m => m.clientContent).length, 1);
    h.session.handle({ setupComplete: {} });
    assert.equal(h.sent.filter(m => m.clientContent).length, 1, 'repeated setup cannot repeat the greeting');
    h.audio.callbacks.onPcm(new Int16Array([100, -100]).buffer);
    assert.equal(h.sent.at(-1).realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
    h.session.handle({ serverContent: { inputTranscription: { text: '你好' }, outputTranscription: { text: '你好，我是 Mr. Pot。' }, modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    h.audio.callbacks.onPlayback(true); assert.equal(h.events.at(-1).status, 'speaking');
    h.session.mute(true); assert.equal(h.audio.muted, true); assert.ok(h.sent.at(-1).realtimeInput.audioStreamEnd);
    const count = h.sent.length; h.audio.callbacks.onPcm(new Int16Array([100]).buffer); assert.equal(h.sent.length, count);
    h.session.handle({ serverContent: { interrupted: true } });
    assert.equal(h.audio.stops, 1); assert.equal(h.events.at(-1).status, 'listening');
    assert.equal(h.turns.at(-1).final, true); assert.match(h.turns.at(-1).assistant, /Mr. Pot/);
    h.session.close(); assert.equal(h.audio.closes, 1); assert.equal(h.socket.readyState, 3); assert.equal(h.session.ready, false);
  } finally { h.session.close(); }
});

test('microphone denial or closing during permission does not reserve a call', async () => {
  for (const denied of [true, false]) {
    let requests = 0, complete;
    const h = harness({
      fetchImpl: async () => { requests++; throw new Error('Must not reserve'); },
      audioFactory: () => ({ close() {}, start: () => denied
        ? Promise.reject(new DOMException('Denied', 'NotAllowedError'))
        : new Promise(resolve => { complete = resolve; }) }),
    });
    const pending = h.session.start();
    if (!denied) { h.session.close(); complete(); }
    await pending;
    assert.equal(requests, 0);
    if (denied) assert.match(h.events.at(-1).error, /permission was denied/);
    h.session.close();
  }
});

function relayHarness() {
  let socket; const sent = [];
  const h = harness({
    fetchImpl: async () => ({ ok: true, json: async () => ({ transport: 'relay', ticket: 'signed-one-use-ticket', socketUrl: 'wss://relay.example/voice', maxSeconds: 120 }) }),
    socketFactory: url => {
      assert.equal(url, 'wss://relay.example/voice');
      socket = {
        readyState: 1, bufferedAmount: 0, closeCalls: 0,
        send: raw => sent.push(JSON.parse(raw)),
        close() { this.closeCalls++; this.remoteClose(); },
        remoteClose() { this.readyState = 3; this.onclose?.(); },
      };
      return socket;
    },
  });
  return { ...h, sent, get socket() { return socket; } };
}

test('production relay handshake sends only its ticket; remote closure stops audio before waiting for the socket', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = relayHarness();
  try {
    await h.session.start(); h.socket.onopen();
    assert.deepEqual(h.sent, [{ type: 'connect', ticket: 'signed-one-use-ticket' }]);
    h.session.handle({ setupComplete: {} });
    h.session.handle({ toolCall: { functionCalls: [{ id: 'nav', name: 'navigate_section', args: { target: 'projects' } }] } });
    assert.equal(h.sent.length, 1); assert.equal(h.actions.at(-1).href, '/#tour-projects');
    h.audio.callbacks.onPcm(new Int16Array([100]).buffer);
    assert.ok(h.sent.at(-1).realtimeInput.audio);
    h.session.handle({ type: 'relay.closed', reason: 'time_limit' });
    assert.equal(h.audio.closes, 1);
    assert.deepEqual(h.sent.at(-1), { type: 'hangup' });
    assert.equal(h.socket.readyState, 1, 'audio is stopped while the relay flushes');
    assert.equal(h.session.ready, false); assert.equal(h.session.socket, null);
    h.socket.remoteClose();
    assert.equal(h.socket.readyState, 3);
    t.mock.timers.tick(6500);
    assert.equal(h.socket.closeCalls, 0, 'remote close cancels the fallback timer');
  } finally { h.session.close(); h.socket?.remoteClose(); }
});

for (const finish of ['remote', 'timeout']) {
  test(`relay hangup stops audio immediately, suppresses late traffic and closes via ${finish}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = relayHarness();
    try {
      await h.session.start(); h.socket.onopen(); h.session.handle({ setupComplete: {} });
      const receive = h.socket.onmessage;
      const send = h.socket.send;
      h.socket.send = raw => {
        if (JSON.parse(raw).type === 'hangup') assert.equal(h.audio.closes, 1, 'audio closes before sending hangup');
        send(raw);
      };
      h.session.close();
      assert.equal(h.audio.closes, 1); assert.equal(h.session.closed, true);
      assert.equal(h.session.ready, false); assert.equal(h.session.socket, null);
      assert.equal(h.socket.readyState, 1);
      assert.deepEqual(h.sent.at(-1), { type: 'hangup' });
      for (const name of ['onopen', 'onmessage', 'onerror']) assert.equal(h.socket[name], null);
      const sent = h.sent.length, turns = h.turns.length, states = h.events.length;
      h.audio.callbacks.onPcm(new Int16Array([100]).buffer);
      h.audio.callbacks.onPlayback(true);
      h.session.send({ realtimeInput: { audio: { data: 'AAAA' } } });
      const late = { serverContent: { outputTranscription: { text: 'late' }, modelTurn: { parts: [{ inlineData: { data: 'AAAA' } }] } } };
      h.session.handle(late);
      receive({ data: JSON.stringify(late) });
      await Promise.resolve();
      assert.equal(h.sent.length, sent, 'no provider-bound bytes follow hangup');
      assert.equal(h.audio.plays, 0); assert.equal(h.turns.length, turns); assert.equal(h.events.length, states);
      h.session.close();
      assert.equal(h.sent.filter(event => event.type === 'hangup').length, 1);
      assert.equal(h.audio.closes, 1);
      t.mock.timers.tick(6499);
      assert.equal(h.socket.readyState, 1); assert.equal(h.socket.closeCalls, 0);
      if (finish === 'remote') h.socket.remoteClose();
      t.mock.timers.tick(1);
      assert.equal(h.socket.readyState, 3);
      assert.equal(h.socket.closeCalls, finish === 'remote' ? 0 : 1);
    } finally { h.session.close(); h.socket?.remoteClose(); }
  });
}

test('public MCP profile completion aborts the transport stream even with a caller deadline', async () => {
  const original = globalThis.fetch;
  let opened = false, aborted = false;
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'GET') {
      opened = true;
      return new Promise((_resolve, reject) => {
        const abort = () => { aborted = true; reject(new DOMException('closed', 'AbortError')); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
      });
    }
    const message = JSON.parse(init.body);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const data = { status: 'EVIDENCE_FOUND', coverage: { profile: 'owner_reviewed_public_evidence' }, profileEvidence: [{ review: 'approved', sourceType: 'PROFILE', text: 'Approved education.' }] };
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : { content: [{ type: 'text', text: JSON.stringify(data) }] };
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  };
  try {
    const result = await fetchPublicProfile({ signal: new AbortController().signal });
    assert.equal(result.status, 'EVIDENCE_FOUND'); assert.ok(opened); assert.ok(aborted);
  } finally { globalThis.fetch = original; }
});

test('navigation is allowlisted, canceled on interruption, and cannot be replayed', async () => {
  const h = harness();
  try {
    await h.session.start(); h.session.handle({ setupComplete: {} });
    const call = { id: 'go-1', name: 'navigate_section', args: { target: 'projects' } };
    h.session.handle({ toolCall: { functionCalls: [call] } });
    const action = h.actions.at(-1);
    assert.equal(action.href, '/#tour-projects'); assert.equal(h.session.isNavigationCurrent(action), true);
    h.session.handle({ serverContent: { interrupted: true } });
    assert.equal(h.session.isNavigationCurrent(action), false);
    const count = h.sent.length; h.session.handle({ toolCall: { functionCalls: [call] } }); assert.equal(h.sent.length, count);
    h.session.handle({ toolCall: { functionCalls: [{ id: 'bad', name: 'admin.delete', args: {} }] } });
    assert.match(h.sent.at(-1).toolResponse.functionResponses[0].response.error, /not allowed/);
    h.session.handle({ toolCallCancellation: { ids: ['cancel-first'] } });
    h.session.handle({ toolCall: { functionCalls: [{ ...call, id: 'cancel-first' }] } });
    assert.equal(h.actions.at(-1), null);
  } finally { h.session.close(); }
});

test('late token response after hangup cannot open a socket or restart the microphone', async () => {
  let resolve;
  const h = harness({ fetchImpl: () => new Promise(r => { resolve = r; }) });
  const pending = h.session.start();
  await Promise.resolve();
  h.session.close();
  resolve({ ok: true, json: async () => ({ token: 'auth_tokens/late' }) });
  await pending;
  assert.equal(h.audio.starts, 1); assert.equal(h.audio.closes, 1); assert.equal(h.socket, undefined);
});

test('page change and disconnection discard pending navigation', async () => {
  const h = harness();
  try {
    await h.session.start(); h.session.handle({ setupComplete: {} });
    h.session.handle({ toolCall: { functionCalls: [{ id: 'nav', name: 'navigate_section', args: { target: 'articles' } }] } });
    const action = h.actions.at(-1); h.session.pageChanged();
    assert.equal(h.session.isNavigationCurrent(action), false);
    assert.equal(h.sent.at(-1).clientContent.turnComplete, false);
    h.socket.onclose(); assert.equal(h.events.at(-1).status, 'error'); assert.equal(h.audio.closes, 1);
  } finally { h.session.close(); }
});

test('microphone denial is readable and releases the audio context', async () => {
  const h = harness();
  h.audio.start = async () => { throw new DOMException('denied', 'NotAllowedError'); };
  await h.session.start();
  assert.equal(h.events.at(-1).status, 'error'); assert.match(h.events.at(-1).error, /permission/);
  assert.equal(h.audio.closes, 1); assert.equal(h.socket, undefined);
});

test('repeated playback packets do not trigger repeated React state updates', async () => {
  const h = harness();
  try {
    await h.session.start(); h.session.handle({ setupComplete: {} });
    h.audio.callbacks.onPlayback(true);
    const count = h.events.length;
    for (let i = 0; i < 50; i++) h.audio.callbacks.onPlayback(true);
    assert.equal(h.events.length, count);
  } finally { h.session.close(); }
});

test('connection timeout closes capture and socket', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  try {
    await h.session.start();
    context.mock.timers.tick(20000);
    assert.equal(h.events.at(-1).status, 'error');
    assert.match(h.events.at(-1).error, /timed out/);
    assert.equal(h.audio.closes, 1); assert.equal(h.socket.readyState, 3);
  } finally { h.session.close(); }
});

test('approved estimated usage cutoff closes audio without retrying', async () => {
  const h = harness();
  try {
    await h.session.start(); h.session.handle({ setupComplete: {} });
    h.session.maxEstimatedUsd = .25;
    h.session.handle({ usageMetadata: { totalTokenCount: 21000 } });
    assert.equal(h.socket.readyState, 3);
    assert.equal(h.audio.closes, 1);
    assert.match(h.events.at(-1).error, /usage limit/);
  } finally { h.session.close(); }
});

test('education is available even if the current page omits all education text', async () => {
  const h = harness();
  try {
    await h.session.start(); h.session.handle({ setupComplete: {} });
    h.session.tool({ id: 'education', name: 'get_profile', args: {} });
    assert.deepEqual(h.sent.at(-1).toolResponse.functionResponses[0].response, profile);
    h.session.close(); assert.equal(h.session.profile, null);
  } finally { h.session.close(); }
});

test('public profile filtering accepts only approved public profile summaries', () => {
  const data = { status: 'EVIDENCE_FOUND', coverage: { profile: 'owner_reviewed_public_evidence' }, profileEvidence: [
    { review: 'approved', sourceType: 'PROFILE', sourceRequiresLogin: true, text: profile.facts[0] },
    { review: 'draft', sourceType: 'PROFILE', text: 'PRIVATE' },
    { review: 'approved', sourceType: 'ARTICLE', text: 'FULL RESTRICTED ARTICLE' },
  ], secret: 'SECRET' };
  assert.deepEqual(publicProfileEvidence(data).facts, profile.facts);
  assert.equal(JSON.stringify(publicProfileEvidence(data)).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(publicProfileEvidence(data)).includes('SECRET'), false);
  assert.deepEqual(publicProfileEvidence({ ...data, coverage: {} }), PROFILE_UNAVAILABLE);
});

test('profile cache coalesces calls, expires and does not serve stale facts after failure', async () => {
  let calls = 0, now = 0;
  const load = createProfileLoader({ now: () => now, read: async () => { calls++; if (calls > 1) throw new Error('down'); return profile; } });
  assert.deepEqual(await Promise.all([load(), load(), load()]), [profile, profile, profile]);
  assert.equal(calls, 1);
  now = 60001;
  assert.deepEqual(await load(), PROFILE_UNAVAILABLE);
  assert.equal(calls, 2);
  assert.deepEqual(await load(), PROFILE_UNAVAILABLE); assert.equal(calls, 2);
});

test('missing profile is reported as a retrieval failure, not missing education', () => {
  assert.match(liveConfig(page, PROFILE_UNAVAILABLE).systemInstruction.parts[0].text, /profile could not be loaded/);
});

test('profile fetch deadline aborts and reports unavailable', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const load = createProfileLoader({ read: options => { signal = options.signal; return new Promise(() => {}); } });
  const pending = load();
  context.mock.timers.tick(6500);
  assert.deepEqual(await pending, PROFILE_UNAVAILABLE);
  assert.equal(signal.aborted, true);
});

test('profile retrieval does not consume the single-use token connection window', async () => {
  let time = 1700000000000, body;
  const handler = createSessionHandler({ env, now: () => time,
    loadProfile: async () => { time += 5000; return profile; },
    fetchImpl: async (_, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ name: 'auth_tokens/test' }) }; } });
  const res = response(); await handler(request(), res);
  assert.equal(Date.parse(body.newSessionExpireTime) - time, 30000);
});

test('voice instructions preserve canonical names and short, attributed introductions', () => {
  const text = liveConfig(page, profile).systemInstruction.parts[0].text;
  assert.match(text, /郭育奇 \(Guo1 Yu4 Qi2\)/);
  assert.match(text, /assistant is Mr\. Pot, never Potter/);
  assert.match(text, /under 12 seconds/);
  assert.match(text, /not an unsolicited employment biography/);
  assert.match(text, /Current alone is not a fresh verification/);
  assert.equal(liveConfig(page).maxOutputTokens, 512, 'does not enlarge the approved trial budget');
});

test('provider turn completion does not cut queued speech or mark it heard prematurely', async () => {
  const h = harness();
  try {
    await h.session.start(); h.session.handle({ setupComplete: {} });
    h.audio.callbacks.onPlayback(true);
    h.session.handle({ serverContent: { outputTranscription: { text: '你好，我是 Mr. Pot。' }, generationComplete: true, turnComplete: true } });
    assert.equal(h.events.at(-1).status, 'speaking');
    assert.equal(h.turns.at(-1).final, false);
    assert.equal(h.audio.stops, 0);
    h.audio.callbacks.onPlayback(false);
    assert.equal(h.turns.at(-1).completion, 'complete');
    assert.equal(h.events.at(-1).status, 'listening');
  } finally { h.session.close(); }
});

test('interruptions and hard call limits label incomplete replies without retrying', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  try {
    await h.session.start(); h.session.handle({ setupComplete: {} });
    h.session.handle({ serverContent: { outputTranscription: { text: '你可以通过这' } } });
    h.session.handle({ serverContent: { interrupted: true } });
    assert.equal(h.turns.at(-1).completion, 'interrupted');
    h.session.handle({ serverContent: { outputTranscription: { text: '接下来我们' } } });
    h.audio.callbacks.onPlayback(true);
    h.session.handle({ serverContent: { turnComplete: true } });
    context.mock.timers.tick(180000);
    assert.equal(h.turns.at(-1).completion, 'call-ended');
    assert.match(h.events.at(-1).error, /limit reached/);
    assert.equal(h.audio.closes, 1);
    assert.equal(h.audio.starts, 1);
    assert.equal(h.socket.readyState, 3);
  } finally { h.session.close(); }
});
