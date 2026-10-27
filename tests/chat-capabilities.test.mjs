import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeChatCapabilities, UNAVAILABLE_CHAT_CAPABILITIES } from '../src/lib/chatCapabilities.mjs';

test('optional paid features fail closed unless explicitly enabled by the backend', () => {
  for (const value of [null, {}, { deep: 'true', attachments: 1 }, { error: 'unavailable' }]) {
    assert.deepEqual(normalizeChatCapabilities(value), UNAVAILABLE_CHAT_CAPABILITIES);
  }
  assert.deepEqual(normalizeChatCapabilities({ deep: true, attachments: false }), { deep: true, attachments: false });
});

test('widget gates persisted Deep mode, picker and dropped files without changing voice or chat size', () => {
  const source = readFileSync(new URL('../src/components/ChatWidget.js', import.meta.url), 'utf8');
  assert.ok(source.includes('if (next.deep && storageSafeGet(MODE_KEY)'));
  assert.ok(source.includes('disabled={!capabilities.deep}'));
  assert.ok(source.includes('if (!capabilities.attachments) { setErrorToast(ATTACHMENTS_UNAVAILABLE); return }'));
  assert.ok(source.includes('capabilities.attachments ? fileInputRef.current?.click()'));
  assert.ok(source.includes('const DEFAULT_WIDGET_SIZE = { w: 440, h: 500 }'));
});
