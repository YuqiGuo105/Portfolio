// Opt-in, single-use real-provider test. Never imported by application code.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { closeSync, openSync } from 'node:fs';
import WebSocket from 'ws';
import { createQwenBridge } from '../../src/lib/voice/qwenBridge.mjs';

const approval = process.env.QWEN_APPROVED_SINGLE_TEST;
if (!/^[a-z0-9-]{8,80}$/.test(approval || '')) throw new Error('Single-test approval ID required');
const require = createRequire(import.meta.url);
Object.assign(process.env, {
  NODE_ENV: 'development', NEXT_PUBLIC_GEMINI_LIVE_PREVIEW: 'true', GEMINI_LIVE_ENABLED: 'true',
  GEMINI_LIVE_API_KEY: '', GEMINI_LIVE_BILLING_ACK: 'false', VOICE_ENABLED: 'false',
  NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only-public-key',
  WATCHPACK_POLLING: '2000',
  NEXT_PUBLIC_VOICE_DEFAULT_PROVIDER: 'qwen',
});
const port = Number(process.env.VOICE_E2E_PORT || 3123);
const metrics = { connections: 0, ready: false, inputSeconds: 0, outputSeconds: 0, inputCaption: '', outputCaption: '', complete: false, closed: false, providerCode: '', totalTokens: 0, stages: [], eventTypes: [] };
const safeCode = value => /^[A-Za-z0-9_.-]{1,100}$/.test(String(value)) ? String(value) : 'provider_error';
const qwen = createQwenBridge({
  env: { ...process.env, QWEN_LIVE_ENABLED: 'true', QWEN_LIVE_TRIAL_ACK: 'true', QWEN_LIVE_MAX_SECONDS: '60', QWEN_LIVE_MAX_CALLS: '1' },
  onDiagnostic: event => metrics.stages.push(event),
  connect: (url, options) => {
    if (metrics.connections++) throw new Error('One upstream connection only');
    closeSync(openSync(`/tmp/mr-pot-qwen-real-test-${approval}.used`, 'wx', 0o600));
    const startedAt = Date.now();
    const ws = new WebSocket(url, options);
    const send = ws.send.bind(ws);
    ws.send = raw => {
      const event = JSON.parse(raw);
      if (event.type === 'session.update') {
        metrics.profileSent = /Syracuse/.test(event.session?.instructions || '') && /Liverpool/.test(event.session?.instructions || '');
        if (!metrics.profileSent) throw new Error('Verified education facts required before provider setup');
      }
      if (event.type === 'input_audio_buffer.append') metrics.inputSeconds += Buffer.from(event.audio, 'base64').length / 32000;
      return send(raw);
    };
    ws.on('upgrade', response => { metrics.httpStatus = response.statusCode; });
    ws.on('unexpected-response', (req, response) => { metrics.httpStatus = response.statusCode; metrics.providerCode = `HTTP_${response.statusCode}`; response.resume(); ws.terminate(); });
    ws.on('error', error => { metrics.providerCode ||= safeCode(error.code || 'websocket_error'); });
    ws.on('close', (code, reason) => {
      metrics.closed = true; metrics.closeCode = code; metrics.elapsedMs = Date.now() - startedAt;
      const text = reason.toString().toLowerCase();
      metrics.closeCategory = /quota|balance|billing|payment/.test(text) ? 'quota_or_billing'
        : /auth|token|key|permission/.test(text) ? 'access' : /param|session|request/.test(text) ? 'configuration' : text ? 'other' : 'no_reason';
    });
    ws.on('message', raw => {
      try {
        const event = JSON.parse(raw.toString());
        if (/^(session\.(created|updated)|error|response\.(created|done|audio\.delta|audio_transcript\.delta)|input_audio_buffer\.(speech_started|speech_stopped))$/.test(event.type) && !metrics.eventTypes.includes(event.type)) metrics.eventTypes.push(event.type);
        if (event.type === 'session.updated') metrics.ready = true;
        if (event.type === 'error' || (!event.type && event.code)) metrics.providerCode = safeCode(event.error?.code || event.code);
        if (event.type === 'conversation.item.input_audio_transcription.completed') metrics.inputCaption += String(event.transcript || '').slice(0, 1000);
        if (event.type === 'response.audio_transcript.delta') metrics.outputCaption += String(event.delta || '').slice(0, 3000);
        if (event.type === 'response.audio.delta') metrics.outputSeconds += Buffer.from(event.delta, 'base64').length / 48000;
        if (event.type === 'response.done') {
          metrics.totalTokens += Number(event.response?.usage?.total_tokens || 0);
          metrics.complete = metrics.outputSeconds > 0 && event.response?.status === 'completed';
        }
        if (metrics.outputSeconds > 20 || metrics.totalTokens > 20000) { metrics.providerCode = 'TEST_BUDGET_CUTOFF'; ws.terminate(); }
      } catch { metrics.providerCode = 'INVALID_PROVIDER_EVENT'; ws.terminate(); }
    });
    return ws;
  },
});
const app = require('next')({ dev: true, dir: process.cwd(), hostname: '127.0.0.1', port,
  conf: { ...require('../../next.config.js'), distDir: `.next-voice-local-${port}` } });
await app.prepare();
if (!await qwen.prepare()) { qwen.close(); await app.close(); throw new Error('Public profile preflight failed; no provider call started'); }
const handle = app.getRequestHandler();
const server = createServer(async (req, res) => {
  if (req.url === '/__qwen-live-status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(metrics)); return; }
  if (!await qwen.http(req, res)) handle(req, res);
});
server.on('upgrade', (req, socket, head) => { if (!qwen.upgrade(req, socket, head)) app.getUpgradeHandler()(req, socket, head); });
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => { qwen.close(); server.close(); app.close().finally(() => process.exit()); });
