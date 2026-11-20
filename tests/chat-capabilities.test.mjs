import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeChatCapabilities, UNAVAILABLE_CHAT_CAPABILITIES } from '../src/lib/chatCapabilities.mjs';
import { hasChatWidget, isHomePageRoute } from '../src/lib/chatPagePolicy.mjs';
import { VARIANTS, chooseHome } from '../src/lib/discovery/core.mjs';

test('chat remains on the homepage with discovery enabled for every entry source', () => {
  assert.equal(hasChatWidget('/'), true);
  for (const source of ['direct', 'linkedin', 'github']) {
    assert.ok(VARIANTS.includes(chooseHome(source, {}, () => .5)));
    // The URL remains / while Next exposes /home/[variant] to _app after the rewrite.
    assert.equal(isHomePageRoute('/home/[variant]'), true);
    assert.equal(hasChatWidget('/home/[variant]'), true);
  }
});

test('chat preserves article navigation and existing private-page boundaries', () => {
  for (const path of ['/work-single/[id]', '/blog-single/[id]', '/life-blog/[id]', '/cv', '/blogs', '/architecture']) {
    assert.equal(hasChatWidget(path), true, path);
    assert.equal(isHomePageRoute(path), false, path);
  }
  for (const path of ['/admin', '/admin/login', '/admin/visitors', '/auth/callback', '/oauth/consent']) {
    assert.equal(hasChatWidget(path), false, path);
  }
});

test('app mounting and openChat links share rewritten-home classification', () => {
  const app = readFileSync(new URL('../pages/_app.js', import.meta.url), 'utf8');
  const widget = readFileSync(new URL('../src/components/ChatWidget.js', import.meta.url), 'utf8');
  assert.ok(app.includes('hasChatWidget(router.pathname) && <ChatWidget />'));
  assert.ok(app.includes('const isHomePage = isHomePageRoute(router.pathname)'));
  assert.ok(widget.includes('if (!isHomePageRoute(router.pathname))'));
  assert.ok(widget.includes('if (router.pathname === "/home/[variant]") delete rest.variant'));
  assert.ok(widget.includes('router.replace({ pathname: "/", query: rest }'));
});

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
