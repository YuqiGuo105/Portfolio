export const MAX_RECORDING_MS = 60_000;
const SAMPLE_RATE = 16_000;

export function encodeWav(samples) {
  if (!samples.length || samples.length > SAMPLE_RATE * MAX_RECORDING_MS / 1000) throw new Error('Invalid recording length.');
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const label = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  label(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
  });
  return new Uint8Array(buffer);
}

export async function recordingToBase64(blob, signal) {
  if (blob.size > 3 * 1024 * 1024) throw new Error('Recording is too large. Try a shorter message.');
  signal.throwIfAborted();
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  let decoded;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  finally { await context.close(); }
  signal.throwIfAborted();
  if (decoded.duration < 0.2) throw new Error('Recording is too short. Please try again.');
  const frames = Math.min(Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE * MAX_RECORDING_MS / 1000);
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  source.disconnect();
  source.buffer = null;
  signal.throwIfAborted();
  const pcm = rendered.getChannelData(0);
  if (!pcm.some(sample => Math.abs(sample) > 0.001)) throw new Error('No speech detected. Please try again.');
  const bytes = encodeWav(pcm);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
