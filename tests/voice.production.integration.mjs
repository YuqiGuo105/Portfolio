import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { readDictationWav } from '../src/lib/voice/qwenDictation.mjs';

if (!process.argv.includes('--approved-single-call')) {
  throw new Error('Explicit approval required for one production call. No automatic retry.');
}
const origin = 'https://www.yuqi.site';
const wavPath = process.env.VOICE_TEST_WAV;
const markerPath = process.env.VOICE_APPROVAL_MARKER;
assert.ok(wavPath && markerPath, 'Provide a synthetic WAV and a unique approval marker path.');
const pcm = readDictationWav((await readFile(wavPath)).toString('base64'));
assert.ok(pcm.length <= 12 * 32000, 'Keep the synthetic prompt under 12 seconds.');
const status = await (await fetch(`${origin}/api/voice/session`, { signal: AbortSignal.timeout(15000) })).json();
assert.ok(status.configured && status.remainingCalls > 0, 'Production must have a call available.');
const marker = await open(markerPath, 'wx', 0o600);
await marker.close();

let socket, timer, hangupTimer, sent = false, ended = false;
let setup = false, greeting = '', userText = '', answer = '', outputSeconds = 0, conversationId = '', reason = '';
const controller = new AbortController();
const send = value => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
const hangup = () => {
  if (ended) return;
  ended = true;
  controller.abort();
  send({ type: 'hangup' });
  hangupTimer = setTimeout(() => socket?.terminate(), 6500);
};
try {
  timer = setTimeout(hangup, 48000);
  const response = await fetch(`${origin}/api/voice/session`, {
    method: 'POST', redirect: 'error', signal: controller.signal,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: { path: '/', title: 'Yuqi Guo | Portfolio', text: '', selection: '' } }),
  });
  assert.equal(response.status, 200, 'Production must issue a short-lived voice ticket.');
  const session = await response.json();
  assert.equal(session.provider, 'Qwen');
  const endpoint = new URL(session.socketUrl);
  assert.equal(endpoint.protocol, 'wss:');
  assert.ok(new Set([
    'portfolio-voice-relay-702193211434.us-central1.run.app',
    'portfolio-voice-relay-y45c2mnbja-uc.a.run.app',
  ]).has(endpoint.hostname), 'Use the existing production relay only.');
  assert.equal(endpoint.pathname, '/voice');
  socket = new WebSocket(endpoint, { origin, handshakeTimeout: 12000, maxPayload: 1024 * 1024 });
  const finished = new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('close', resolve);
    socket.on('open', () => send({ type: 'connect', ticket: session.ticket }));
    socket.on('message', raw => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.setupComplete) setup = true;
        if (event.type === 'relay.closed') { reason = event.reason; conversationId = event.conversationId || ''; }
        const content = event.serverContent;
        userText += content?.inputTranscription?.text || '';
        if (sent) answer += content?.outputTranscription?.text || '';
        else greeting += content?.outputTranscription?.text || '';
        for (const part of content?.modelTurn?.parts || []) {
          if (part.inlineData?.data) outputSeconds += Buffer.from(part.inlineData.data, 'base64').length / 48000;
        }
        if (outputSeconds > 28) hangup();
        if (content?.turnComplete && !sent && !ended) {
          sent = true;
          // Send at real-time speed after the greeting, followed by VAD silence.
          void (async () => {
            const audio = Buffer.concat([Buffer.alloc(3200), pcm, Buffer.alloc(32000)]);
            for (let offset = 0; offset < audio.length && !ended; offset += 3200) {
              send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: audio.subarray(offset, offset + 3200).toString('base64') } } });
              await delay(100);
            }
          })().catch(reject);
        } else if (content?.turnComplete && sent && userText && answer) hangup();
      } catch (error) { reject(error); }
    });
  });
  await finished;
  assert.ok(setup, 'Provider must become ready.');
  assert.match(greeting, /Mr\.?\s*Pot/i);
  assert.ok(userText.trim(), 'Synthetic speech must be recognized.');
  assert.match(answer, /Syracuse/i);
  assert.match(answer, /Liverpool/i);
  assert.ok(outputSeconds > 0, 'Provider must return real PCM audio.');
  assert.equal(reason, 'client_hangup');
  assert.match(conversationId, /^[a-f0-9-]{36}$/);
  console.log(JSON.stringify({ passed: true, setup, greeting, userText, answer, outputSeconds, conversationId, reason }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: error.message, setup, reason, greeting, userText, answer, outputSeconds }));
  process.exitCode = 1;
} finally {
  clearTimeout(timer); clearTimeout(hangupTimer); controller.abort(); socket?.terminate();
}
