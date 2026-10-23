import { liveConfig } from './protocol.mjs';

export const QWEN_MODEL = 'qwen3.8-omni-flash-realtime';
export const QWEN_SESSION_PATH = '/api/voice/qwen/session';
export const QWEN_SOCKET_PATH = '/api/voice/qwen/socket';

function jsonSchema(value) {
  if (Array.isArray(value)) return value.map(jsonSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === 'type' && typeof item === 'string' ? item.toLowerCase() : jsonSchema(item)]));
}

export function qwenSetup(page, profile) {
  const config = liveConfig(page, profile);
  return { type: 'session.update', session: {
    modalities: ['text', 'audio'],
    audio: {
      input: { format: { type: 'pcm', sample_rate: 16000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' } },
      output: { voice: 'Tina', format: { type: 'pcm', sample_rate: 24000 } },
    },
    input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
    instructions: config.systemInstruction.parts.map(part => part.text).join('\n'),
    turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 600 },
    enable_search: false, max_tokens: 512,
    tools: config.tools[0].functionDeclarations.map(fn => ({ type: 'function', function: jsonSchema(fn) })),
  } };
}
