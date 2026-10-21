import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = await readFile(new URL('../public/voice/pcm-capture.worklet.js', import.meta.url), 'utf8');

function processor(sampleRate) {
  let Worklet;
  const packets = [];
  runInNewContext(source, { sampleRate, AudioWorkletProcessor: class {
    constructor() { this.port = { postMessage: buffer => packets.push(new Int16Array(buffer)) }; }
  }, registerProcessor(name, value) { assert.equal(name, 'voice-pcm-capture'); Worklet = value; } });
  return { capture: new Worklet(), packets };
}

test('capture remains silent until enabled, and mute discards any partial packet', () => {
  const { capture, packets } = processor(16000);
  capture.process([[new Float32Array(1600).fill(.5)]]);
  assert.equal(packets.length, 0);
  capture.port.onmessage({ data: { enabled: true } });
  capture.process([[new Float32Array(800).fill(.5)]]);
  capture.port.onmessage({ data: { enabled: false } });
  capture.port.onmessage({ data: { enabled: true } });
  capture.process([[new Float32Array(1600).fill(0)]]);
  assert.equal(packets.length, 1); assert.ok(packets[0].every(v => v === 0));
});

for (const rate of [16000, 44100, 48000]) test(`PCM capture resamples ${rate} Hz into 100 ms 16 kHz packets`, () => {
  const { capture, packets } = processor(rate);
  capture.port.onmessage({ data: { enabled: true } });
  capture.process([[new Float32Array(rate / 10).fill(.5)]]);
  assert.equal(packets.length, 1); assert.equal(packets[0].length, 1600);
  assert.ok(packets[0].every(v => v === 16384));
});

test('PCM conversion clamps out-of-range samples', () => {
  const { capture, packets } = processor(16000);
  capture.port.onmessage({ data: { enabled: true } });
  capture.process([[new Float32Array(1600).fill(2)]]);
  capture.process([[new Float32Array(1600).fill(-2)]]);
  assert.ok(packets[0].every(v => v === 32767));
  assert.ok(packets[1].every(v => v === -32768));
});
