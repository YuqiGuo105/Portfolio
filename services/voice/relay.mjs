import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { cleanPageContext, LIVE_MODEL, liveConfig, VOICE_TARGETS, wireSetup, voiceGreeting } from '../../src/lib/voice/protocol.mjs';
import { createProfileLoader } from '../../src/lib/voice/publicProfile.mjs';
import { createVoiceHistory } from '../../src/lib/voice/history.mjs';
import { createQwenConnection, qwenConfiguration } from './qwenTransport.mjs';

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const ORIGINS = new Set(['https://www.yuqi.site', 'https://yuqi.site']);
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };

export function signTicket(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
export function verifyTicket(ticket, secret, origin, now) {
  if (typeof ticket !== 'string' || ticket.length > 24000) throw new Error('Invalid ticket');
  const [data, signature, extra] = ticket.split('.');
  if (extra || !equal(signature, createHmac('sha256', secret).update(data).digest('base64url'))) throw new Error('Invalid signature');
  const value = JSON.parse(Buffer.from(data, 'base64url').toString());
  if (!/^[a-f0-9]{64}$/.test(value.nonce) || value.origin !== origin || !Number.isFinite(value.exp) || value.exp <= now || value.exp > now + 31000) throw new Error('Expired ticket');
  const page = cleanPageContext(value.page);
  if (!page || page.path.startsWith('/admin')) throw new Error('Private page');
  return { ...value, page };
}

export function createBudgetStore(env, fetchImpl = fetch) {
  return async (action, ticketHash = null) => {
    const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/voice_allowance`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3500),
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action: action, p_ticket_hash: ticketHash }),
    });
    if (!response.ok) throw new Error('Quota unavailable');
    const data = await response.json();
    if (typeof data.allowed !== 'boolean' || !Number.isInteger(data.remainingCalls)) throw new Error('Invalid quota response');
    return data;
  };
}

export function createVoiceRelay({ env = process.env, now = Date.now, fetchImpl = fetch,
  budget = createBudgetStore(env, fetchImpl), loadProfile = createProfileLoader(),
  connect = (url, options) => new WebSocket(url, options) } = {}) {
  const secret = env.VOICE_GATEWAY_TOKEN;
  const selection = env.VOICE_PROVIDER || 'qwen';
  const qwen = qwenConfiguration(env);
  const provider = selection === 'qwen' ? 'Qwen' : 'Google';
  const model = selection === 'qwen' ? qwen.model : LIVE_MODEL;
  const configured = env.VOICE_ENABLED === 'true' && secret?.length >= 32
    && (selection === 'qwen' ? qwen.configured : selection === 'google' && Boolean(env.GEMINI_API_KEY));
  const origins = new Set(ORIGINS);
  if (env.NODE_ENV !== 'production' && env.VOICE_LOCAL_ORIGIN) origins.add(env.VOICE_LOCAL_ORIGIN);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  const closers = new Set();
  let cachedStatus, cachedUntil = 0;

  async function http(req, res) {
    if (req.url === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (req.url !== '/session') return json(res, 404, { error: 'Not found.' });
    if (!secret || !equal(req.headers.authorization, `Bearer ${secret}`)) return json(res, 401, { error: 'Unauthorized.' });
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
    if (!configured) return json(res, 503, { configured: false, reason: 'disabled' });
    try {
      if (req.method === 'GET') {
        if (!cachedStatus || now() >= cachedUntil) { cachedStatus = await budget('status'); cachedUntil = now() + 3000; }
        return json(res, 200, { configured: cachedStatus.allowed, provider, model, maxSeconds: 120,
          remainingCalls: cachedStatus.remainingCalls, reason: cachedStatus.reason, resetAt: cachedStatus.resetAt, scope: 'platform', dailyLimit: 5 });
      }
      let bytes = 0; const chunks = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 16384) return json(res, 413, { error: 'Request too large.' }); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const page = cleanPageContext(body.page);
      if (!page || page.path.startsWith('/admin') || !origins.has(body.origin)) return json(res, 400, { error: 'Public portfolio pages only.' });
      // A cold profile read must not spend a daily call or the ticket lifetime.
      // The same loader coalesces requests and is reused during the handshake.
      const profile = await loadProfile();
      if (profile.status !== 'EVIDENCE_FOUND') return json(res, 503, {
        configured: false, reason: 'profile_unavailable', error: 'Portfolio information is temporarily unavailable. Please try again.',
      });
      if (res.destroyed) return;
      const nonce = randomBytes(32).toString('hex');
      const allowance = await budget('reserve', hash(nonce));
      cachedUntil = 0;
      if (!allowance.allowed) return json(res, 429, { error: 'Voice allowance unavailable.', reason: allowance.reason, resetAt: allowance.resetAt });
      const ticket = signTicket({ nonce, page, origin: body.origin, exp: now() + 29000 }, secret);
      return json(res, 200, { transport: 'relay', ticket, socketUrl: `${env.VOICE_PUBLIC_URL.replace(/^http/, 'ws')}/voice`,
        provider, model, maxSeconds: 120, expiresAt: new Date(now() + 120000).toISOString() });
    } catch { return json(res, 503, { configured: false, reason: 'unavailable', error: 'Voice is temporarily unavailable.' }); }
  }

  function upgrade(req, socket, head) {
    if (!configured || req.url !== '/voice' || !origins.has(req.headers.origin) || wss.clients.size >= 4) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, client => {
      let closed = false, claiming = false, ready = false, upstream, ticketHash, call;
      let history, historyStart, closePromise;
      let inputBytes = 0, outputBytes = 0, estimatedUsd = 0, turns = 0, toolCount = 0;
      let windowAt = now(), windowBytes = 0, windowMessages = 0;
      const seen = new Set(), timers = new Set();
      const controller = new AbortController();
      const send = message => { if (!closed && client.readyState === 1) client.send(JSON.stringify(message)); };
      const stop = (reason = 'ended') => {
        if (closed) return closePromise;
        closed = true; controller.abort();
        for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
        if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
        if (ticketHash) budget('release', ticketHash).catch(() => {});
        cachedUntil = 0;
        // Retain the request's socket while Cloud Run finishes the final writes.
        // A hangup during start must close the row after its insert settles.
        const flush = Promise.resolve(historyStart).catch(() => {}).then(() => history?.close(reason));
        let flushTimer;
        const deadline = new Promise(resolve => { flushTimer = setTimeout(resolve, 6000); });
        closePromise = Promise.race([flush, deadline]).catch(() => {}).finally(() => {
          clearTimeout(flushTimer);
          const conversationId = history?.conversationId;
          try {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'relay.closed', reason,
              ...(conversationId ? { conversationId } : {}) }));
          } finally {
            if (client.readyState === WebSocket.OPEN) {
              // close() drains the queued receipt; terminate() can discard it.
              client.close(1000);
              const forceClose = setTimeout(() => client.terminate(), 1000);
              forceClose.unref();
              client.once('close', () => clearTimeout(forceClose));
            } else client.terminate();
            closers.delete(stop);
            if (call) console.log(JSON.stringify({ event: 'voice_closed', reason, provider, model,
              ...(conversationId ? { conversationId } : {}), inputSeconds: Math.round(inputBytes / 32000),
              outputSeconds: Math.round(outputBytes / 48000), estimatedUsd: Number(estimatedUsd.toFixed(4)) }));
          }
        });
        return closePromise;
      };
      closers.add(stop);
      timers.add(setTimeout(() => { if (!claiming) stop('unauthorized'); }, 3000));
      timers.add(setTimeout(() => { if (!ready) stop('connection_timeout'); }, 18000));
      client.on('error', () => stop('client_error'));
      client.on('close', () => stop('client_closed'));
      client.on('message', async (raw, binary) => {
        if (closed) return;
        try {
          if (binary) throw new Error('JSON only');
          if (now() - windowAt >= 1000) { windowAt = now(); windowBytes = 0; windowMessages = 0; }
          if (++windowMessages > 25 || (windowBytes += raw.length) > 90000) throw new Error('Rate');
          const message = JSON.parse(raw.toString());
          if (!claiming) {
            if (message.type !== 'connect') throw new Error('Ticket required');
            const ticket = verifyTicket(message.ticket, secret, req.headers.origin, now());
            claiming = true;
            const candidate = hash(ticket.nonce);
            const allowance = await budget('claim', candidate);
            if (!allowance.allowed) throw new Error('Ticket already used');
            ticketHash = candidate;
            if (closed) { await budget('release', ticketHash); return; }
            call = ticket;
            const expires = Date.parse(allowance.expiresAt);
            if (!Number.isFinite(expires) || expires <= now()) throw new Error('Expired');
            timers.add(setTimeout(() => stop('time_limit'), Math.min(120000, expires - now())));
            let checking = false;
            timers.add(setInterval(async () => {
              if (checking || closed) return;
              checking = true;
              try { const state = await budget('status'); if (state.reason === 'disabled') stop('disabled'); }
              catch { stop('quota_unavailable'); } finally { checking = false; }
            }, 10000));
            const profile = await loadProfile();
            if (closed) return;
            // Do not charge for a portfolio assistant unable to load its core facts.
            if (profile.status !== 'EVIDENCE_FOUND') { stop('profile_unavailable'); return; }
            try {
              history = createVoiceHistory({ env, fetchImpl, now, provider, model, page: call.page,
                onError: () => stop('history_unavailable') });
              historyStart = history?.start();
              await historyStart;
            } catch { stop('history_unavailable'); return; }
            if (closed) return;
            const setup = wireSetup(LIVE_MODEL, liveConfig(call.page, profile));
            if (selection === 'qwen') upstream = createQwenConnection({ env, page: call.page, profile, connect });
            else {
              const tokenResponse = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
                method: 'POST', signal: controller.signal, redirect: 'error',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
                body: JSON.stringify({ uses: 1, expireTime: new Date(expires).toISOString(), newSessionExpireTime: new Date(Math.min(expires, now() + 30000)).toISOString(), bidiGenerateContentSetup: setup }),
              });
              if (!tokenResponse.ok) throw new Error('Provider unavailable');
              const token = await tokenResponse.json();
              if (closed) return;
              if (typeof token.name !== 'string' || !token.name.startsWith('auth_tokens/')) throw new Error('Invalid authorization');
              upstream = connect(`${ENDPOINT}?access_token=${encodeURIComponent(token.name)}`, { handshakeTimeout: 10000, maxPayload: 1024 * 1024, followRedirects: false, perMessageDeflate: false });
            }
            upstream.on('error', () => stop('provider_error'));
            upstream.on('close', () => stop('provider_closed'));
            upstream.on('open', () => { if (!closed) upstream.send(JSON.stringify({ setup })); });
            upstream.on('message', data => {
              if (closed) return;
              try {
                const event = JSON.parse(data.toString());
                if (event.error || event.goAway) { stop('provider_unavailable'); return; }
                if (client.bufferedAmount > 256000) { stop('slow_client'); return; }
                if (event.usageMetadata) {
                  // Highest published model rate for every token; repeated
                  // cumulative reports deliberately overcount, never undercount.
                  estimatedUsd += Math.max(0, Number(event.usageMetadata.totalTokenCount) || 0) * 12 / 1e6;
                  if (estimatedUsd >= .20) { stop('usage_limit'); return; }
                }
                if (event.setupComplete && !ready) {
                  ready = true; send({ setupComplete: {} });
                  upstream.send(JSON.stringify(voiceGreeting()));
                }
                if (event.serverContent) {
                  const content = event.serverContent;
                  for (const part of content.modelTurn?.parts || []) {
                    if (part.inlineData?.data) outputBytes += Buffer.from(part.inlineData.data, 'base64').length;
                  }
                  if (outputBytes > 48000 * 60 || (content.turnComplete && ++turns > 8)) { stop('output_limit'); return; }
                  history?.observe({ serverContent: content });
                  send({ serverContent: content });
                }
                if (event.toolCallCancellation) send({ toolCallCancellation: event.toolCallCancellation });
                const responses = [];
                for (const tool of event.toolCall?.functionCalls || []) {
                  if (seen.has(tool.id)) continue;
                  if (++toolCount > 6 || typeof tool.id !== 'string' || tool.id.length > 200) { stop('tool_limit'); return; }
                  seen.add(tool.id);
                  let result = { error: 'Tool not allowed.' };
                  if (tool.name === 'get_profile') result = profile;
                  if (tool.name === 'read_page') result = call.page;
                  if (tool.name === 'navigate_section' && Object.hasOwn(VOICE_TARGETS, tool.args?.target || '')) {
                    result = { status: 'offered_waiting_for_user', label: VOICE_TARGETS[tool.args.target].label };
                    send({ toolCall: { functionCalls: [{ id: tool.id, name: tool.name, args: { target: tool.args.target } }] } });
                  }
                  responses.push({ id: tool.id, name: tool.name, response: result });
                }
                if (responses.length) upstream.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
              } catch { stop('invalid_provider_message'); }
            });
            return;
          }
          if (message.type === 'hangup') { stop('client_hangup'); return; }
          if (!ready || upstream?.readyState !== 1 || upstream.bufferedAmount > 128000) throw new Error('Not ready');
          const input = message.realtimeInput;
          if (input?.audio) {
            const audio = input.audio;
            if (audio.mimeType !== 'audio/pcm;rate=16000' || typeof audio.data !== 'string' || audio.data.length > 8600 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.data)) throw new Error('Invalid audio');
            const size = Buffer.from(audio.data, 'base64').length;
            inputBytes += size;
            if (size % 2 || inputBytes > 32000 * 120) throw new Error('Audio limit');
            upstream.send(JSON.stringify({ realtimeInput: { audio: { data: audio.data, mimeType: 'audio/pcm;rate=16000' } } }));
          } else if (input?.audioStreamEnd === true) upstream.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
          else throw new Error('Client configuration, text and tool injection are forbidden');
        } catch { stop('invalid_request'); }
      });
    });
  }
  return { http, upgrade, close() {
    const pending = [...closers].map(stop => stop('shutdown'));
    wss.close();
    return Promise.allSettled(pending);
  } };
}
