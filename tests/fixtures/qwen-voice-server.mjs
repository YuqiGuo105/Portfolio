// Isolated fake-provider process. No credentials or upstream network calls.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { createQwenBridge } from '../../src/lib/voice/qwenBridge.mjs';
const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'development';
process.env.NEXT_PUBLIC_GEMINI_LIVE_PREVIEW = 'true';
process.env.GEMINI_LIVE_ENABLED = 'true';
process.env.GEMINI_LIVE_API_KEY = '';
process.env.GEMINI_LIVE_BILLING_ACK = '';
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(String(url))) return originalFetch(url, options);
  throw new Error('External IO is disabled in this test.');
};
const port = Number(process.env.VOICE_E2E_PORT || 3121);
const metrics = { connections: 0, pcm: 0, tools: [], terminated: 0, grounded: false };
const audio = Buffer.alloc(24000 * 2 * 4);
for (let i = 0; i < audio.length / 2; i++) audio.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 240 / 24000) * 1600), i * 2);
let provider;
const emit = message => provider.emit('message', Buffer.from(JSON.stringify(message)));
const qwen = createQwenBridge({ env: { NODE_ENV: 'development', QWEN_LIVE_ENABLED: 'true', QWEN_LIVE_TRIAL_ACK: 'true',
  QWEN_LIVE_API_KEY: 'fake-qwen-only', QWEN_LIVE_WORKSPACE_ID: 'fixture', QWEN_LIVE_MAX_SECONDS: '60' },
  loadProfile: async () => ({ status: 'EVIDENCE_FOUND', facts: ['Master of Computer Science from Syracuse University and Bachelor from University of Liverpool.'] }),
  connect: (url, options) => {
    if (options.headers.Authorization !== 'Bearer fake-qwen-only') throw new Error('Fake key required');
    metrics.connections++;
    provider = new EventEmitter(); provider.readyState = 1; provider.bufferedAmount = 0;
    provider.terminate = () => { if (provider.readyState === 3) return; metrics.terminated++; provider.readyState = 3; provider.emit('close'); };
    let requested = false;
    provider.send = raw => {
      const message = JSON.parse(raw);
      if (message.type === 'session.update') {
        metrics.grounded = message.session.instructions.includes('Syracuse') && message.session.max_tokens === 512;
        queueMicrotask(() => emit({ type: 'session.updated' }));
      }
      if (message.type === 'input_audio_buffer.append') {
        metrics.pcm++;
        if (!requested && metrics.connections === 1) {
          requested = true;
          queueMicrotask(() => {
            emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Tell me his education and show me the background.' });
            emit({ type: 'response.created', response: { id: 'tools-1' } });
            emit({ type: 'response.function_call_arguments.done', response_id: 'tools-1', call_id: 'profile-1', name: 'get_profile', arguments: '{}' });
            emit({ type: 'response.function_call_arguments.done', response_id: 'tools-1', call_id: 'nav-1', name: 'navigate_section', arguments: '{"target":"background"}' });
            emit({ type: 'response.done', response: { id: 'tools-1', status: 'completed' } });
          });
        }
      }
      if (message.type === 'conversation.item.create') metrics.tools.push(message.item);
      if (message.type === 'response.create') queueMicrotask(() => {
        emit({ type: 'response.created', response: { id: 'answer-1' } });
        emit({ type: 'response.audio_transcript.delta', response_id: 'answer-1', delta: 'Yuqi earned a master degree at Syracuse University.' });
        emit({ type: 'response.audio.delta', response_id: 'answer-1', delta: audio.toString('base64') });
        emit({ type: 'response.done', response: { id: 'answer-1', status: 'completed' } });
      });
    };
    queueMicrotask(() => { provider.emit('open'); emit({ type: 'session.created' }); });
    return provider;
  } });
const next = require('next');
const app = next({ dev: true, dir: process.cwd(), hostname: '127.0.0.1', port,
  conf: { ...require('../../next.config.js'), distDir: `.next-voice-local-${port}` } });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(async (req, res) => {
  if (req.url === '/__test/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(metrics)); return; }
  if (req.url === '/__test/interrupt') {
    emit({ type: 'input_audio_buffer.speech_started' });
    emit({ type: 'response.audio_transcript.delta', response_id: 'answer-1', delta: 'MUST NOT APPEAR' });
    res.end('ok'); return;
  }
  if (!await qwen.http(req, res)) handle(req, res);
});
server.on('upgrade', (req, socket, head) => { if (!qwen.upgrade(req, socket, head)) app.getUpgradeHandler()(req, socket, head); });
server.listen(port, '127.0.0.1', () => console.log('Qwen fixture ready'));
process.on('SIGTERM', () => { qwen.close(); server.close(); app.close().finally(() => process.exit()); });
