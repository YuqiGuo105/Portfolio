import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as catalog from '../src/lib/media/demoCatalog.mjs';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/media/ProjectHoverVideo.js', import.meta.url), 'utf8'), {
  filename: 'ProjectHoverVideo.jsx',
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' },
  module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name.endsWith('.css')) return { __esModule: true, default: { cover: 'cover', playing: 'playing' } };
  if (name.endsWith('demoCatalog.mjs')) return catalog;
  return require(name);
}, exports);
const Preview = exports.default;
const nativeTimeout = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
let root, pending, timerId, now, observer, paused, reducedMotion, fineHover, hidden;
const demo = { preview: '/preview.mp4' };
const render = (props = {}) => act(() => root.render(React.createElement(React.StrictMode, null,
  React.createElement('article', { className: 'archive-item' },
    React.createElement('h3', null, 'Blog title'),
    React.createElement(Preview, { demo, hoverBoundary: '.archive-item', ...props }, React.createElement('img', { alt: 'Blog cover' }))))));
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  pending = new Map(); timerId = 0; now = 0; paused = 0;
  reducedMotion = false; fineHover = true; hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  window.matchMedia = query => ({ matches: query.includes('reduced-motion') ? reducedMotion : fineHover });
  globalThis.setTimeout = (callback, ms) => {
    const id = ++timerId; pending.set(id, { callback, at: now + ms }); return id;
  };
  globalThis.clearTimeout = id => pending.delete(id);
  globalThis.IntersectionObserver = class {
    constructor(callback) { observer = this; this.callback = callback; this.disconnected = false; }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  window.HTMLMediaElement.prototype.pause = () => { paused++; };
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  root = createRoot(document.getElementById('root'));
  render();
});
afterEach(() => {
  act(() => root.unmount());
  assert.equal(pending.size, 0);
  assert.ok(observer.disconnected);
  globalThis.setTimeout = nativeTimeout;
  globalThis.clearTimeout = nativeClear;
});
after(() => dom.window.close());
function pointer(type, pointerType = 'mouse') {
  const event = new window.Event(type);
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  act(() => document.querySelector('.archive-item').dispatchEvent(event));
}
function advance(ms) {
  now += ms;
  act(() => {
    for (const [id, timer] of [...pending]) if (timer.at <= now) { pending.delete(id); timer.callback(); }
  });
}
const video = () => document.querySelector('video');

test('loads no video until a full 800ms hover; then plays muted inline', () => {
  assert.equal(video(), null);
  pointer('pointerenter');
  advance(799); assert.equal(video(), null);
  advance(1);
  assert.equal(video().getAttribute('src'), '/preview.mp4');
  assert.equal(video().preload, 'none');
  assert.equal(video().muted, true);
  assert.equal(video().autoplay, true);
  assert.equal(video().playsInline, true);
  assert.equal(video().loop, true);
  act(() => Simulate.playing(video()));
  assert.ok(video().classList.contains('playing'));
});

test('quick pointer movement cancels the dwell without downloading media', () => {
  pointer('pointerenter'); advance(400); pointer('pointerleave'); advance(800);
  assert.equal(video(), null);
  pointer('pointerenter'); advance(799); assert.equal(video(), null);
  advance(1); assert.ok(video());
});

for (const reason of ['pointerleave', 'pointercancel', 'hidden', 'offscreen']) {
  test(`${reason} cancels both waiting and playing previews`, () => {
    const stop = () => act(() => {
      if (reason === 'hidden') { hidden = true; document.dispatchEvent(new window.Event('visibilitychange')); }
      else if (reason === 'offscreen') observer.callback([{ isIntersecting: false }]);
      else pointer(reason);
    });
    pointer('pointerenter'); stop(); advance(800); assert.equal(video(), null);
    hidden = false;
    act(() => observer.callback([{ isIntersecting: true }]));
    pointer('pointerenter'); advance(800); assert.ok(video());
    stop(); assert.equal(video(), null); assert.ok(paused > 0);
  });
}

test('touch and reduced-motion devices keep their still cover', () => {
  pointer('pointerenter', 'touch'); advance(1000); assert.equal(video(), null);
  reducedMotion = true;
  pointer('pointerenter'); advance(1000); assert.equal(video(), null);
  reducedMotion = false; fineHover = false;
  pointer('pointerenter'); advance(1000); assert.equal(video(), null);
});

test('rechecks reduced motion before the delayed download', () => {
  pointer('pointerenter'); reducedMotion = true; advance(800);
  assert.equal(video(), null);
});

test('absent previews, playback errors, and changed sources safely restore the cover', () => {
  render({ demo: null }); pointer('pointerenter'); advance(1000); assert.equal(video(), null);
  render(); pointer('pointerenter'); advance(800); assert.ok(video());
  act(() => Simulate.error(video())); assert.equal(video(), null);
  pointer('pointerenter'); advance(800); assert.ok(video());
  render({ demo: { preview: '/replacement.mp4' } }); assert.equal(video(), null);
  pointer('pointerenter'); advance(800);
  assert.equal(video().getAttribute('src'), '/replacement.mp4');
});

test('unmount cancels pending dwell and removes card listeners', () => {
  const card = document.querySelector('.archive-item');
  pointer('pointerenter');
  act(() => root.render(null));
  assert.equal(pending.size, 0);
  act(() => card.dispatchEvent(new window.Event('pointerenter')));
  assert.equal(pending.size, 0);
});

test('one tap plays on touch, survives finger-up, and a second tap restores the cover', () => {
  fineHover = false; reducedMotion = true;
  pointer('pointerenter', 'touch'); advance(1000);
  assert.equal(video(), null);
  const button = document.querySelector('button');
  assert.equal(button.getAttribute('aria-label'), 'Play video preview');
  act(() => button.click());
  assert.ok(video());
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  pointer('pointerleave', 'touch'); pointer('pointercancel', 'touch');
  assert.ok(video());
  act(() => button.click());
  assert.equal(video(), null);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  advance(1000); assert.equal(video(), null);
});

test('manual previews still stop when offscreen or the page is hidden', () => {
  for (const reason of ['hidden', 'offscreen']) {
    hidden = false;
    act(() => observer.callback([{ isIntersecting: true }]));
    act(() => document.querySelector('button').click());
    assert.ok(video());
    act(() => {
      if (reason === 'hidden') { hidden = true; document.dispatchEvent(new window.Event('visibilitychange')); }
      else observer.callback([{ isIntersecting: false }]);
    });
    assert.equal(video(), null);
  }
});

test('preview control is separate from the article link and does not trigger navigation', () => {
  let cardClicks = 0, articleClicks = 0;
  act(() => root.render(React.createElement('article', { onClick: () => cardClicks++ },
    React.createElement(Preview, { demo }, React.createElement('a', { href: '/article', onClick: event => {
      event.preventDefault(); articleClicks++;
    } }, 'Read article')))));
  const button = document.querySelector('button');
  assert.equal(button.closest('a'), null);
  act(() => button.click());
  assert.equal(cardClicks, 0); assert.equal(articleClicks, 0);
  assert.ok(video());
  act(() => document.querySelector('a').click());
  assert.equal(articleClicks, 1);
});

test('starting another preview stops the previous one, including an automatic preview', () => {
  act(() => root.render(React.createElement('section', null,
    React.createElement(Preview, { demo }),
    React.createElement(Preview, { demo: { preview: '/second.mp4' } }))));
  const buttons = document.querySelectorAll('button');
  act(() => buttons[0].click());
  assert.equal(video().getAttribute('src'), '/preview.mp4');
  act(() => buttons[1].click());
  assert.equal(document.querySelectorAll('video').length, 1);
  assert.equal(video().getAttribute('src'), '/second.mp4');
  act(() => Simulate.pointerEnter(document.querySelector('.cover'), { pointerType: 'mouse' }));
  advance(800);
  assert.equal(document.querySelectorAll('video').length, 1);
  assert.equal(video().getAttribute('src'), '/preview.mp4');
});

test('rejected play restores an operable play button without an unhandled promise', async () => {
  window.HTMLMediaElement.prototype.play = () => Promise.reject(new Error('Playback blocked'));
  await act(async () => document.querySelector('button').click());
  assert.equal(video(), null);
  assert.equal(document.querySelector('button').getAttribute('aria-pressed'), 'false');
});

test('both blog surfaces use the whole card, without changing Life blogs', () => {
  for (const file of ['pages/index.js', 'pages/blogs.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /<ProjectHoverVideo[^>]*hoverBoundary="\.archive-item"/);
  }
  const listing = readFileSync(new URL('../pages/blogs.js', import.meta.url), 'utf8');
  assert.match(listing, /blog.blogType === 'technical' \? <ProjectHoverVideo/);
});
