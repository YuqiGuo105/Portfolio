import { randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { cleanPageContext } from './protocol.mjs';
import { createProfileLoader } from './publicProfile.mjs';
import { QWEN_MODEL, QWEN_SESSION_PATH, QWEN_SOCKET_PATH, qwenSetup } from './qwenProtocol.mjs';

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MODELS = new Set([QWEN_MODEL, 'qwen3.5-omni-flash-realtime', 'qwen3.5-omni-plus-realtime']);
const integer = (value, fallback, max) => Number.isInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;

function local(req, env, allowMissingOrigin = false) {
  if (env.NODE_ENV !== 'development' || !LOCAL.has(req.socket?.remoteAddress)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false;
    return (allowMissingOrigin && !req.headers.origin) || req.headers.origin === host.origin;
  } catch { return false; }
}

function configuration(env) {
  const model = env.QWEN_LIVE_MODEL || QWEN_MODEL;
  const workspace = env.QWEN_LIVE_WORKSPACE_ID || '';
  const endpoint = /^[a-zA-Z0-9-]{1,80}$/.test(workspace)
    ? `wss://${workspace}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=${model}` : null;
  return {
    model, endpoint, maxSeconds: integer(env.QWEN_LIVE_MAX_SECONDS, 60, 60),
    maxCalls: integer(env.QWEN_LIVE_MAX_CALLS, 2, 2),
    configured: env.QWEN_LIVE_ENABLED === 'true' && env.QWEN_LIVE_TRIAL_ACK === 'true'
      && Boolean(env.QWEN_LIVE_API_KEY) && Boolean(endpoint) && MODELS.has(model),
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('Too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Development-only relay. No key or unrestricted provider session is issued to
// the browser; timers and budgets are enforced even if the browser stops ticking.
export function createQwenBridge({ env = process.env, now = Date.now, loadProfile = createProfileLoader(),
  connect = (url, options) => new WebSocket(url, options), onDiagnostic = () => {} } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  const tickets = new Map();
  const closers = new Set();
  let starts = 0;
  let active = false;
  const sweep = () => { for (const [key, value] of tickets) if (now() > value.claimBy) tickets.delete(key); };

  async function http(req, res) {
    const path = req.url?.split('?')[0];
    if (path !== QWEN_SESSION_PATH) return false;
    if (!local(req, env, req.method === 'GET')) { json(res, 404, { error: 'Not found.' }); return true; }
    const config = configuration(env);
    sweep();
    if (req.method === 'GET') {
      const remainingCalls = Math.max(0, config.maxCalls - starts);
      json(res, 200, { provider: 'Qwen', model: config.model, region: 'Singapore', maxSeconds: config.maxSeconds,
        configured: config.configured && remainingCalls > 0, remainingCalls,
        reason: !config.configured ? 'setup_required' : remainingCalls === 0 ? 'trial_ended' : active ? 'call_active' : null });
      return true;
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); json(res, 405, { error: 'Method not allowed.' }); return true; }
    if (!config.configured) { json(res, 503, { error: 'Qwen local credentials and trial approval are required.' }); return true; }
    let page;
    try { page = cleanPageContext((await body(req)).page); } catch { json(res, 400, { error: 'Invalid request.' }); return true; }
    if (!page) { json(res, 400, { error: 'Public pages only.' }); return true; }
    if (active || tickets.size || starts >= config.maxCalls) { json(res, 429, { error: 'Local trial limit reached or a call is already pending.' }); return true; }
    starts++;
    // Reserve before awaiting profile IO so simultaneous requests cannot bypass limits.
    active = true;
    try {
      const profile = await loadProfile();
      if (req.aborted || res.destroyed) return true;
      const ticket = randomBytes(32).toString('hex');
      const claimBy = now() + 30000;
      const expiresAt = now() + config.maxSeconds * 1000;
      tickets.set(ticket, { origin: req.headers.origin, page, profile, config, claimBy, expiresAt });
      json(res, 200, { ticket, socketPath: QWEN_SOCKET_PATH, profile, maxSeconds: config.maxSeconds, expiresAt: new Date(expiresAt).toISOString() });
    } catch { json(res, 502, { error: 'Could not prepare the Qwen call.' }); }
    finally { active = false; }
    return true;
  }

  function upgrade(req, socket, head) {
    if (req.url?.split('?')[0] !== QWEN_SOCKET_PATH) return false;
    if (!local(req, env) || !configuration(env).configured) { socket.destroy(); return true; }
    wss.handleUpgrade(req, socket, head, client => {
      let upstream, call, closed = false, ready = false, setupSent = false, count = 0, bytes = 0, windowAt = now();
      let responseActive = false, continuation = false, responseHasTools = false;
      let responseId, interruptedResponse;
      const pending = new Set();
      const seen = new Set();
      const timers = [];
      const send = event => { if (!closed && client.readyState === 1) client.send(JSON.stringify(event)); };
      const diagnose = stage => { try { onDiagnostic({ stage }); } catch { /* Diagnostics must not interrupt cleanup. */ } };
      const stop = (error = false, stage = 'closed') => {
        if (closed) return;
        diagnose(stage);
        if (error) send({ type: 'error', error: { code: 'voice_unavailable' } });
        closed = true;
        for (const timer of timers) clearTimeout(timer);
        if (call) active = false;
        if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
        if (client.readyState === 1) client.close(1000);
        closers.delete(stop);
      };
      closers.add(stop);
      timers.push(setTimeout(() => { if (!ready) stop(true, 'setup_timeout'); }, 20000));
      client.on('error', () => stop(false, 'client_error'));
      client.on('close', () => stop(false, 'client_closed'));
      client.on('message', (raw, binary) => {
        if (closed) return;
        try {
          if (binary) throw new Error('JSON required');
          if (now() - windowAt >= 1000) { windowAt = now(); count = 0; bytes = 0; }
          if (++count > 40 || (bytes += raw.length) > 80000) throw new Error('Rate limit');
          const event = JSON.parse(raw.toString());
          if (!call) {
            sweep();
            const entry = tickets.get(event.ticket);
            if (event.type !== 'connect' || !entry || entry.origin !== req.headers.origin || active) throw new Error('Invalid ticket');
            tickets.delete(event.ticket);
            call = entry; active = true;
            timers.push(setTimeout(() => stop(false, 'call_deadline'), Math.max(1, call.expiresAt - now())));
            upstream = connect(call.config.endpoint, { headers: { Authorization: `Bearer ${env.QWEN_LIVE_API_KEY}` },
              handshakeTimeout: 10000, maxPayload: 1024 * 1024, perMessageDeflate: false, followRedirects: false });
            upstream.on('open', () => diagnose('upstream_open'));
            upstream.on('error', () => stop(true, 'upstream_error'));
            upstream.on('close', () => stop(!ready, 'upstream_closed'));
            upstream.on('message', data => {
              if (closed) return;
              try {
                const message = JSON.parse(data.toString());
                if (message.type === 'session.created') {
                  if (!setupSent) {
                    setupSent = true;
                    diagnose('session_created');
                    upstream.send(JSON.stringify(qwenSetup(call.page, call.profile)));
                  }
                  return;
                }
                if (message.type === 'error') { stop(true, 'provider_error'); return; }
                if (client.bufferedAmount > 256000) { stop(true, 'client_backpressure'); return; }
                if (message.type === 'session.updated') {
                  if (!setupSent) { stop(true, 'unexpected_setup'); return; }
                  ready = true; diagnose('session_ready'); send({ type: 'session.updated' }); return;
                }
                if (message.type === 'response.created') { responseActive = true; continuation = false; responseHasTools = false; responseId = message.response?.id; }
                if (message.type === 'input_audio_buffer.speech_started') { pending.clear(); continuation = false; responseHasTools = false; interruptedResponse = responseId; }
                if (message.response_id && message.response_id === interruptedResponse) return;
                if (message.type === 'response.done' && message.response?.id === interruptedResponse) return;
                if (message.type === 'response.function_call_arguments.done') {
                  if (!['get_profile', 'read_page', 'navigate_section'].includes(message.name) || seen.size >= 24) throw new Error('Tool limit');
                  if (seen.has(message.call_id)) return;
                  pending.add(message.call_id); seen.add(message.call_id); responseHasTools = true;
                }
                if (message.type === 'response.done') { responseActive = false; continuation = message.response?.status === 'completed' && responseHasTools; }
                // Session configuration and provider errors can carry sensitive data.
                if (/^(response\.|input_audio_buffer\.|conversation\.item\.input_audio_transcription\.)/.test(message.type)) send(message);
              } catch { stop(true, 'invalid_provider_event'); }
            });
            return;
          }
          if (!ready || upstream.readyState !== 1 || upstream.bufferedAmount > 128000) throw new Error('Not ready');
          if (event.type === 'input_audio_buffer.append') {
            if (typeof event.audio !== 'string' || event.audio.length > 10000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.audio)) throw new Error('Invalid PCM');
            upstream.send(JSON.stringify({ type: event.type, audio: event.audio }));
          } else if (event.type === 'input_audio_buffer.clear') upstream.send(JSON.stringify({ type: event.type }));
          else if (event.type === 'conversation.item.create' && event.item?.type === 'function_call_output') {
            if (!pending.delete(event.item.call_id) || typeof event.item.output !== 'string' || event.item.output.length > 16000) throw new Error('Unknown tool');
            upstream.send(JSON.stringify({ type: event.type, item: { type: 'function_call_output', call_id: event.item.call_id, output: event.item.output } }));
          } else if (event.type === 'response.create' && continuation && !responseActive && pending.size === 0) {
            continuation = false; responseActive = true;
            upstream.send(JSON.stringify({ type: event.type }));
          } else throw new Error('Unsupported event');
        } catch { stop(true, 'invalid_client_event'); }
      });
    });
    return true;
  }
  return { http, upgrade, close() { for (const stop of closers) stop(); tickets.clear(); for (const socket of wss.clients) socket.terminate(); wss.close(); } };
}
