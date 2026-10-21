import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createVoiceRelay, signTicket, verifyTicket, createBudgetStore } from '../services/voice/relay.mjs';
import { createVoiceProxy } from '../src/lib/voice/productionProxy.mjs';

const secret = 'test-only-voice-secret-'.repeat(3);
const origin = 'https://www.yuqi.site';
const page = { path: '/', text: 'Public page' };
const profile = { status: 'EVIDENCE_FOUND', facts: ['Syracuse University; University of Liverpool.'] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function store() {
  let calls = 0, active = null, claimed = false;
  return async (action, ticket) => {
    if (action === 'claim') {
      if (ticket !== active || claimed) return { allowed: false, remainingCalls: 3 - calls };
      claimed = true;
    }
    if (action === 'release' && active === ticket) active = null;
    if (action === 'reserve') {
      if (calls >= 3 || active) return { allowed: false, reason: calls >= 3 ? 'daily_limit' : 'busy', remainingCalls: 3 - calls };
      active = ticket; calls++; claimed = false;
    }
    return { allowed: true, remainingCalls: 3 - calls, expiresAt: new Date(Date.now() + 120000).toISOString() };
  };
}

async function fixture(options = {}) {
  const providers = []; let tokens = 0;
  const env = { NODE_ENV: 'production', VOICE_ENABLED: 'true', VOICE_GATEWAY_TOKEN: secret, GEMINI_API_KEY: 'never-browser', VOICE_PUBLIC_URL: 'https://relay.example' };
  const relay = createVoiceRelay({ env, budget: store(), loadProfile: async () => profile,
    fetchImpl: async (_url, init) => {
      tokens++;
      const setup = JSON.parse(init.body).bidiGenerateContentSetup;
      assert.equal(setup.model, 'models/gemini-3.8-live');
      assert.equal(setup.generationConfig.maxOutputTokens, 512);
      return { ok: true, json: async () => ({ name: 'auth_tokens/private' }) };
    },
    connect: () => {
      const remote = new EventEmitter(); remote.readyState = 1; remote.bufferedAmount = 0; remote.messages = [];
      remote.send = raw => { const msg = JSON.parse(raw); remote.messages.push(msg); if (msg.setup) queueMicrotask(() => remote.emit('message', Buffer.from('{"setupComplete":{}}'))); };
      remote.terminate = () => { remote.readyState = 3; };
      providers.push(remote); queueMicrotask(() => remote.emit('open')); return remote;
    }, ...options });
  const server = createServer(relay.http); server.on('upgrade', relay.upgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, relay, providers, tokens: () => tokens,
    reserve: async () => {
      const res = await fetch(`${base}/session`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ page, origin }) });
      return { status: res.status, data: await res.json() };
    },
    close: async () => { relay.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
    open: async ticket => {
      const client = new WebSocket(base.replace('http:', 'ws:') + '/voice', { origin });
      const events = []; client.on('message', raw => events.push(JSON.parse(raw.toString())));
      await once(client, 'open'); client.send(JSON.stringify({ type: 'connect', ticket }));
      for (let i = 0; i < 100 && !events.some(e => e.setupComplete) && client.readyState !== 3; i++) await pause(5);
      return { client, events };
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
    for (let i = 0; i < 2; i++) {
      const ticket = await b.reserve(); assert.equal(ticket.status, 200);
      const call = await b.open(ticket.data.ticket); call.client.close(); await once(call.client, 'close'); await pause(10);
    }
    assert.equal((await a.reserve()).status, 429);
    assert.equal((await b.reserve()).status, 429);
  } finally { await a.close(); await b.close(); }
});

test('relay relays only PCM, supplies truthful tools server-side, blocks setup injection and ticket replay', async () => {
  const f = await fixture();
  try {
    const reservation = await f.reserve(); const { client, events } = await f.open(reservation.data.ticket);
    assert.ok(events.some(x => x.setupComplete));
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
