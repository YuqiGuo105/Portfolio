// One bounded synthetic call through the actual local HTTP/WebSocket bridge.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

if (!process.argv.includes('--approved-single-call')) throw new Error('Explicit live-test approval required.');
const origin = 'http://127.0.0.1:3118';
const wav = readFileSync(process.env.VOICE_TEST_WAV || '/tmp/mr-pot-recovery-education.wav');
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
let pcm;
for (let offset = 12; offset + 8 <= wav.length;) {
  const size = wav.readUInt32LE(offset + 4);
  if (wav.toString('ascii', offset, offset + 4) === 'fmt ') {
    assert.equal(wav.readUInt16LE(offset + 8), 1);
    assert.equal(wav.readUInt16LE(offset + 10), 1);
    assert.equal(wav.readUInt32LE(offset + 12), 16000);
    assert.equal(wav.readUInt16LE(offset + 22), 16);
  }
  if (wav.toString('ascii', offset, offset + 4) === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size);
  offset += 8 + size + (size % 2);
}
assert.ok(pcm?.length > 32000 && pcm.length < 32000 * 15);
const response = await fetch(`${origin}/api/voice/qwen/session`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ page: { path: '/', title: 'Portfolio', text: 'Public homepage.' } }),
  signal: AbortSignal.timeout(12000),
});
assert.equal(response.status, 200);
const session = await response.json();
assert.equal(session.unlimitedLocal, true);
const result = { ready: false, input: '', answer: '', audioSeconds: 0, completed: false };
const socket = new WebSocket(new URL(session.socketPath, origin).href.replace('http:', 'ws:'), { origin, handshakeTimeout: 10000 });
let interval, cursor = 0, closing, hadTools = false;
const audio = Buffer.concat([pcm, Buffer.alloc(32000 * 3)]);
const send = value => socket.send(JSON.stringify(value));
const cutoff = setTimeout(() => { result.timeout = true; socket.terminate(); }, 55000);
socket.on('open', () => send({ type: 'connect', ticket: session.ticket }));
socket.on('error', () => { result.error = 'socket_error'; socket.terminate(); });
socket.on('message', raw => {
  const event = JSON.parse(raw.toString());
  if (event.type === 'error') { result.error = event.error?.code; socket.terminate(); }
  if (event.type === 'session.updated' && !result.ready) {
    result.ready = true;
    interval = setInterval(() => {
      if (socket.readyState !== 1 || cursor >= audio.length) { clearInterval(interval); return; }
      send({ type: 'input_audio_buffer.append', audio: audio.subarray(cursor, cursor + 3200).toString('base64') });
      cursor += 3200;
    }, 100);
  }
  if (event.type === 'response.function_call_arguments.done') {
    hadTools = true;
    const output = event.name === 'get_profile' ? session.profile : { status: 'UNAVAILABLE' };
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(output) } });
  }
  if (event.type === 'conversation.item.input_audio_transcription.completed') result.input = event.transcript;
  if (event.type === 'response.audio_transcript.delta') result.answer += event.delta || '';
  if (event.type === 'response.audio.delta') result.audioSeconds += Buffer.from(event.delta, 'base64').length / 48000;
  if (event.type === 'response.done' && event.response?.status === 'completed') {
    if (hadTools) { hadTools = false; send({ type: 'response.create' }); }
    else if (result.audioSeconds > 0) {
      result.completed = true;
      clearInterval(interval);
      send({ type: 'hangup' });
      closing = setTimeout(() => socket.terminate(), 7000);
    }
  }
});
await new Promise(resolve => socket.once('close', resolve));
clearTimeout(cutoff); clearTimeout(closing); clearInterval(interval);
const passed = result.ready && result.completed && /Syracuse|雪城/i.test(result.answer) && /Liverpool|利物浦/i.test(result.answer);
console.log(JSON.stringify({ passed, ...result, syntheticAudioOnly: true }));
if (!passed) process.exitCode = 1;
