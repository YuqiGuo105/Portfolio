import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeChatCapabilities, UNAVAILABLE_CHAT_CAPABILITIES } from '../src/lib/chatCapabilities.mjs';
import { hasChatWidget, hasLiveVoiceRoute, isHomePageRoute } from '../src/lib/chatPagePolicy.mjs';
import { normalizeChatOffset, clampChatOffset, createChatPosition } from '../src/lib/chatPosition.mjs';
import { VARIANTS, chooseHome } from '../src/lib/discovery/core.mjs';

test('chat remains on the homepage with discovery enabled for every entry source', () => {
  assert.equal(hasChatWidget('/'), true);
  for (const source of ['direct', 'linkedin', 'github']) {
    assert.ok(VARIANTS.includes(chooseHome(source, {}, () => .5)));
    // The URL remains / while Next exposes /home/[variant] to _app after the rewrite.
    assert.equal(isHomePageRoute('/home/[variant]'), true);
    assert.equal(hasChatWidget('/home/[variant]'), true);
    assert.equal(hasLiveVoiceRoute('/home/[variant]'), true);
  }
});

test('voice and subscription use the same home route without widening private-page access', () => {
  for (const path of ['/', '/home/[variant]', '/blogs', '/work-single/[id]']) assert.equal(hasLiveVoiceRoute(path), true);
  for (const path of ['/admin', '/admin/visitors', '/auth/callback', '/talk']) assert.equal(hasLiveVoiceRoute(path), false);
  const widget = readFileSync(new URL('../src/components/ChatWidget.js', import.meta.url), 'utf8');
  const header = readFileSync(new URL('../src/layout/Header.js', import.meta.url), 'utf8');
  const prompt = readFileSync(new URL('../src/components/SubscriptionPrompt.jsx', import.meta.url), 'utf8');
  assert.ok(widget.includes('&& hasLiveVoiceRoute(routerPathname)'));
  assert.ok(widget.includes('process.env.NEXT_PUBLIC_VOICE_ENABLED === "true"'));
  assert.ok(header.includes('isHomePageRoute(router.pathname) && <SubscriptionPrompt'));
  assert.ok(prompt.includes('isHomePageRoute(router.pathname) ? "/"'));
  // Removing openChat is a same-page transition; the invitation must resume afterward.
  assert.ok(prompt.includes('[page, router.asPath, router.events, preview]'));
});

test('chat offsets reject malformed storage and keep every edge in the viewport', () => {
  for (const value of [null, false, 'bad', [], { x: '10px', y: Infinity }, { x: NaN }, { x: Number.MAX_VALUE, y: -Number.MAX_VALUE }]) {
    assert.deepEqual(normalizeChatOffset(value), { x: 0, y: 0 });
  }
  const rect = { left: 752, top: 367, width: 440, height: 400 };
  const view = { width: 1200, height: 800 };
  assert.deepEqual(clampChatOffset({ x: 9000, y: 9000 }, rect, { x: 0, y: 0 }, view), { x: 0, y: 25 });
  assert.deepEqual(clampChatOffset({ x: -9000, y: -9000 }, rect, { x: 0, y: 0 }, view), { x: -744, y: -359 });
  assert.deepEqual(clampChatOffset({ x: -100, y: -20 }, rect, { x: 0, y: 0 }, view), { x: -100, y: -20 });
  const mobile = { left: -80, top: -200, width: 320, height: 200 };
  assert.deepEqual(clampChatOffset({ x: -80, y: -400 }, mobile, { x: -80, y: -400 }, { width: 320, height: 300 }), { x: 0, y: -192 });
  assert.deepEqual(clampChatOffset({ x: 0, y: 0 }, { left: 0, top: 0, width: 500, height: 500 }, {}, { width: 320, height: 300 }), { x: 0, y: 0 });
});

function positionFixture(saved = null, blockedStorage = false) {
  const win = new EventTarget();
  const frames = new Map();
  const values = new Map(saved == null ? [] : [['chatWidgetOffset', saved]]);
  let sequence = 0;
  let observerCallback;
  let disconnects = 0;
  let size = { width: 190, height: 64 };
  Object.assign(win, {
    innerWidth: 1200, innerHeight: 800,
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage blocked'); return values.get(key) || null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage blocked'); values.set(key, value); },
    },
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {
      constructor(fn) { observerCallback = fn; }
      observe() {}
      disconnect() { disconnects++; }
    },
    visualViewport: Object.assign(new EventTarget(), { width: 1200, height: 800, offsetLeft: 0, offsetTop: 0 }),
  });
  const root = { style: { transform: '', setProperty() {} }, querySelector: () => panel };
  const panel = {
    getBoundingClientRect() {
      const [x, y] = [...root.style.transform.matchAll(/(-?[\d.]+)px/g)].map(match => Number(match[1]));
      return { left: win.innerWidth - size.width - 8 + (x || 0), top: win.innerHeight - size.height - 33 + (y || 0), ...size };
    },
  };
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  return { win, root, panel, frames, values, flush, resizePanel(value) { size = value; observerCallback(); }, get disconnects() { return disconnects; } };
}

test('restored and dragged position survives resizing, opening and mobile keyboard changes', () => {
  const f = positionFixture('{"x":-5000,"y":-5000}');
  const position = createChatPosition(f.root, f.win);
  assert.equal(f.panel.getBoundingClientRect().left, 8);
  assert.equal(f.panel.getBoundingClientRect().top, 8);
  position.moveTo({ x: -700, y: -300 });
  position.persist();
  assert.deepEqual(JSON.parse(f.values.get('chatWidgetOffset')), position.getOffset());
  f.win.innerWidth = f.win.visualViewport.width = 390;
  f.win.innerHeight = f.win.visualViewport.height = 640;
  for (let i = 0; i < 20; i++) f.win.dispatchEvent(new Event('resize'));
  assert.equal(f.frames.size, 1);
  f.flush();
  let rect = f.panel.getBoundingClientRect();
  assert.ok(rect.left >= 8 && rect.left + rect.width <= 382);
  f.resizePanel({ width: 366, height: 400 });
  f.flush();
  rect = f.panel.getBoundingClientRect();
  assert.ok(rect.left >= 8 && rect.left + rect.width <= 382);
  assert.ok(rect.top >= 8 && rect.top + rect.height <= 632);
  f.resizePanel({ width: 366, height: 264 });
  f.win.visualViewport.height = 280;
  f.win.visualViewport.offsetTop = 100;
  f.win.visualViewport.dispatchEvent(new Event('resize'));
  f.flush();
  rect = f.panel.getBoundingClientRect();
  assert.ok(rect.top >= 108 && rect.top + rect.height <= 372);
  position.dispose();
  assert.ok(f.disconnects > 0);
  f.win.dispatchEvent(new Event('resize'));
  f.win.visualViewport.dispatchEvent(new Event('scroll'));
  assert.equal(f.frames.size, 0);
});

test('position recovery tolerates invalid JSON and unavailable storage, and cancels pending work', () => {
  for (const saved of ['null', '{broken', '{"x":"bad","y":null}']) {
    const f = positionFixture(saved);
    const position = createChatPosition(f.root, f.win);
    assert.deepEqual(position.getOffset(), { x: 0, y: 0 });
    position.dispose();
  }
  const f = positionFixture(null, true);
  const position = createChatPosition(f.root, f.win);
  assert.doesNotThrow(() => { position.moveTo({ x: -40, y: -20 }); position.persist(); });
  f.win.dispatchEvent(new Event('resize'));
  position.dispose();
  assert.equal(f.frames.size, 0);
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
