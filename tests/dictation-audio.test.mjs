import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/lib/dictationAudio.mjs';

test('encodes bounded mono 16kHz PCM with correct signed samples and WAV lengths', () => {
  const bytes = Buffer.from(encodeWav(new Float32Array([-1, 0, 1, 2])));
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt32LE(40), 8);
  assert.equal(bytes.readInt16LE(44), -32768);
  assert.equal(bytes.readInt16LE(48), 32767);
  assert.equal(bytes.readInt16LE(50), 32767);
});

test('rejects empty and over-duration audio', () => {
  assert.throws(() => encodeWav(new Float32Array(0)));
  assert.throws(() => encodeWav(new Float32Array(960001)));
});
