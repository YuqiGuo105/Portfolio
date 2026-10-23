// Explicitly approved diagnostic: one connection, no microphone or automatic retry.
import { closeSync, openSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { qwenSetup } from '../src/lib/voice/qwenProtocol.mjs';

const approval = process.env.QWEN_PROBE_APPROVAL;
if (!/^[a-z0-9-]{8,80}$/.test(approval || '')) throw new Error('Explicit diagnostic approval ID required');
const workspace = process.env.QWEN_LIVE_WORKSPACE_ID;
if (!/^[a-zA-Z0-9-]{1,80}$/.test(workspace || '') || !process.env.QWEN_LIVE_API_KEY) throw new Error('Local credentials required');
closeSync(openSync(`/tmp/mr-pot-qwen-probe-${approval}.used`, 'wx', 0o600));
const setup = qwenSetup({ path: '/', title: 'Portfolio', text: 'Public portfolio.' }, { status: 'UNAVAILABLE', facts: [] }).session;
const steps = [
  ['minimal', { modalities: ['text', 'audio'], turn_detection: null, audio: { ...setup.audio, output: { ...setup.audio.output, voice: 'longanlingxin' } } }],
  ['transcription', { input_audio_transcription: setup.input_audio_transcription }],
  ['instructions', { instructions: setup.instructions }],
  ['vad', { turn_detection: setup.turn_detection }],
  ['limits', { enable_search: false, max_tokens: 512 }],
  ['tools', { tools: setup.tools }],
];
if (process.env.QWEN_PROBE_LEGACY === 'true') steps[0] = ['minimal_legacy', {
  modalities: ['text', 'audio'], voice: 'Tina', input_audio_format: 'pcm', output_audio_format: 'pcm', turn_detection: null,
}];
const result = { step: 'connection', accepted: [], types: [], outputSeconds: 0, inputCaption: '', outputCaption: '', completed: false };
const started = Date.now();
const ws = new WebSocket(`wss://${workspace}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime`, {
  headers: { Authorization: `Bearer ${process.env.QWEN_LIVE_API_KEY}` }, handshakeTimeout: 10000,
  perMessageDeflate: false, followRedirects: false, maxPayload: 1024 * 1024,
});
let step = 0, interval;
const timeout = setTimeout(() => { result.timeout = true; ws.terminate(); }, 60000);
const send = event => ws.send(JSON.stringify({ ...event, event_id: `event_${randomUUID()}` }));
function advance() {
  if (step < steps.length) {
    result.step = steps[step][0];
    send({ type: 'session.update', session: steps[step++][1] });
  } else {
    result.step = 'synthetic_audio';
    const wav = readFileSync('/tmp/qwen-education.wav');
    const offset = wav.indexOf(Buffer.from('data'));
    const pcm = Buffer.concat([wav.subarray(offset + 8, offset + 8 + wav.readUInt32LE(offset + 4)), Buffer.alloc(32000 * 3)]);
    let cursor = 0;
    interval = setInterval(() => {
      if (ws.readyState !== 1 || cursor >= pcm.length) { clearInterval(interval); return; }
      send({ type: 'input_audio_buffer.append', audio: pcm.subarray(cursor, cursor + 3200).toString('base64') }); cursor += 3200;
    }, 100);
  }
}
ws.on('upgrade', response => { result.httpStatus = response.statusCode; });
ws.on('unexpected-response', (req, response) => { result.httpStatus = response.statusCode; response.resume(); ws.terminate(); });
ws.on('error', error => { result.errorCode = /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'socket_error'; });
ws.on('message', raw => {
  try {
    const event = JSON.parse(raw.toString());
    if (!event.type) {
      const safe = value => String(value).replaceAll(process.env.QWEN_LIVE_API_KEY, '[redacted]').replaceAll(workspace, '[workspace]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 500);
      const fields = value => Object.fromEntries(Object.entries(value || {}).filter(([key, item]) => ['code', 'message', 'status_code', 'error_code', 'error_message', 'param', 'type'].includes(key) && ['string', 'number'].includes(typeof item)).map(([key, item]) => [key, safe(item)]));
      result.nonstandard = { keys: Object.keys(event), root: fields(event), header: fields(event.header), error: fields(event.error) };
    }
    if (!result.types.includes(event.type)) result.types.push(event.type);
    if (event.type === 'session.created') {
      result.createdModel = event.session?.model;
      result.createdSessionKeys = Object.keys(event.session || {});
      advance();
    }
    if (event.type === 'session.updated') { result.accepted.push(result.step); advance(); }
    if (event.type === 'error') {
      const code = String(event.error?.code || event.code || 'unknown');
      result.providerCode = /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : 'unknown'; ws.close();
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') result.inputCaption += String(event.transcript || '').slice(0, 1000);
    if (event.type === 'response.audio_transcript.delta') result.outputCaption += String(event.delta || '').slice(0, 3000);
    if (event.type === 'response.audio.delta') result.outputSeconds += Buffer.from(event.delta, 'base64').length / 48000;
    if (result.outputSeconds > 15) { result.budgetCutoff = true; ws.close(); }
    if (event.type === 'response.done') { result.completed = result.outputSeconds > 0 && event.response?.status === 'completed'; ws.close(); }
  } catch { result.errorCode = 'invalid_event'; ws.terminate(); }
});
ws.on('close', code => {
  clearInterval(interval); clearTimeout(timeout);
  console.log(JSON.stringify({ ...result, closeCode: code, elapsedMs: Date.now() - started }));
  process.exitCode = result.completed ? 0 : 1;
});
