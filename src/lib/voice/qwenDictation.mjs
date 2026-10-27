import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { qwenConfiguration } from '../../../services/voice/qwenTransport.mjs';
import { qwenSetup } from './qwenProtocol.mjs';
import { createSpendGuard } from './spendGuard.mjs';

export class DictationError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}

export function readDictationWav(audio) {
  if (typeof audio !== 'string' || audio.length > 2560060 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
    throw new DictationError('invalid_audio', 400);
  }
  const wav = Buffer.from(audio, 'base64');
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
    || wav.readUInt32LE(4) !== wav.length - 8) throw new DictationError('invalid_audio', 400);
  let format, pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size;
    if (end > wav.length) throw new DictationError('invalid_audio', 400);
    if (name === 'fmt ') {
      if (format || size < 16) throw new DictationError('invalid_audio', 400);
      format = wav.subarray(start, end);
    }
    if (name === 'data') {
      if (pcm) throw new DictationError('invalid_audio', 400);
      pcm = wav.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  if (!format || !pcm || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1
    || format.readUInt32LE(4) !== 16000 || format.readUInt32LE(8) !== 32000
    || format.readUInt16LE(12) !== 2 || format.readUInt16LE(14) !== 16
    || pcm.length < 3200 || pcm.length % 2 || pcm.length > 60 * 32000) throw new DictationError('invalid_audio', 400);
  return pcm;
}

export function dictationSession() {
  const { session } = qwenSetup();
  return { type: 'session.update', session: { ...session, modalities: ['text'], tools: [],
    instructions: 'Transcribe the input faithfully in its original languages. Do not answer or translate it.',
    turn_detection: null, max_tokens: 1 } };
}

export async function transcribeQwen(audio, { env = process.env, signal,
  connect = (url, options) => new WebSocket(url, options), spend = createSpendGuard({ env }), timeoutMs = 30000 } = {}) {
  const pcm = readDictationWav(audio);
  const config = qwenConfiguration(env);
  if (!config.configured) throw new DictationError('dictation_not_configured');
  if (signal?.aborted) throw new DictationError('cancelled', 499);
  // No response.create is sent: recognition only, no spoken answer. Retain a
  // conservative reservation because this event does not include billed usage.
  const reservation = await spend.reserve('qwen', 'dictation', 10000);
  let started = false;
  try {
    if (signal?.aborted) throw new DictationError('cancelled', 499);
    return await new Promise((resolve, reject) => {
      let socket, finished = false, setupSent = false, committed = false, itemId;
      const timer = setTimeout(() => finish(new DictationError('dictation_timeout', 504)), timeoutMs);
      const abort = () => finish(new DictationError('cancelled', 499));
      function finish(error, text) {
        if (finished) return;
        finished = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
        if (error) reject(error); else resolve({ text });
      }
      function send(event) { socket.send(JSON.stringify({ ...event, event_id: `event_${randomUUID()}` })); }
      signal?.addEventListener('abort', abort, { once: true });
      try {
        started = true;
        socket = connect(config.endpoint, { headers: { Authorization: `Bearer ${env.QWEN_LIVE_API_KEY}` }, handshakeTimeout: 8000, maxPayload: 256000 });
        socket.on('error', () => finish(new DictationError('dictation_unavailable')));
        socket.on('close', () => finish(new DictationError('dictation_unavailable')));
        socket.on('message', raw => {
          if (finished) return;
          try {
            const event = JSON.parse(raw.toString());
            if (event.type === 'error' || event.error || !event.type) throw new DictationError('dictation_unavailable');
            if (event.type === 'session.created' && !setupSent) { setupSent = true; send(dictationSession()); }
            if (event.type === 'session.updated' && setupSent && !committed) {
              committed = true;
              for (let i = 0; i < pcm.length; i += 32000) send({ type: 'input_audio_buffer.append', audio: pcm.subarray(i, i + 32000).toString('base64') });
              send({ type: 'input_audio_buffer.commit' });
            }
            if (event.type === 'input_audio_buffer.committed') itemId = event.item_id;
            if (event.type === 'conversation.item.input_audio_transcription.failed') throw new DictationError('dictation_unavailable');
            if (event.type === 'conversation.item.input_audio_transcription.completed' && committed) {
              if (itemId && event.item_id !== itemId) return;
              const text = typeof event.transcript === 'string' ? event.transcript.trim() : '';
              if (!text) throw new DictationError('no_speech', 422);
              if (text.length > 12000) throw new DictationError('dictation_unavailable');
              finish(null, text);
            }
          } catch (error) { finish(error instanceof DictationError ? error : new DictationError('dictation_unavailable')); }
        });
      } catch { finish(new DictationError('dictation_unavailable')); }
    });
  } finally {
    await reservation.settle(started ? null : 0).catch(() => {});
  }
}
