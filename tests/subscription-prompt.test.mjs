import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  isSubscriptionPromptPage, recordSubscriptionPrompt, startSubscriptionPrompt,
  SUBSCRIPTION_PROMPT_KEY, SUBSCRIPTION_PROMPT_COOLDOWN_MS,
  subscriptionPromptPreviewMode,
} from '../src/lib/subscriptionPrompt.mjs';

function setup(t, { page = '/', subscriber = false, storageBlocked = false, scrollY = 0, ignoreCooldown = false, backgroundTop = 1750 } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.yuqi.site/' });
  const win = dom.window, doc = win.document;
  win.scrollY = scrollY;
  if (backgroundTop !== null) {
    const heading = doc.createElement('h2');
    heading.id = 'tour-background';
    heading.getBoundingClientRect = () => ({ top: backgroundTop - win.scrollY, height: 60 });
    doc.body.append(heading);
  }
  let time = 1_800_000_000_000, tick, prompts = 0, lastPrompt;
  let subscribed = subscriber;
  Object.defineProperty(doc, 'hidden', { value: false, writable: true });
  Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 5000 });
  Object.defineProperty(win, 'innerHeight', { value: 1000 });
  win.setInterval = callback => { tick = callback; return 1; };
  win.clearInterval = () => { tick = null; };
  if (storageBlocked) Object.defineProperty(win, 'localStorage', { get() { throw new Error('Storage disabled'); } });
  const start = (path = page) => startSubscriptionPrompt({
    win, doc, page: path, hasSubscriber: () => subscribed, now: () => time,
    ignoreCooldown,
    onPrompt: details => { prompts++; lastPrompt = details; recordSubscriptionPrompt(win, time); },
  });
  let stop = start();
  t.after(() => { stop(); dom.window.close(); });
  return {
    win, doc, get prompts() { return prompts; }, get lastPrompt() { return lastPrompt; },
    advance(ms) { for (let left = ms; left > 0; left -= 1000) { time += Math.min(left, 1000); tick?.(); } },
    scroll(y) { win.scrollY = y; win.dispatchEvent(new win.Event('scroll')); },
    hide(hidden) { doc.hidden = hidden; doc.dispatchEvent(new win.Event('visibilitychange')); },
    subscribe() { subscribed = true; },
    record() { recordSubscriptionPrompt(win, time); },
    restart(path) { stop(); stop = start(path); },
    suspend(ms) { time += ms; tick?.(); },
    stop() { stop(); },
  };
}

test('normal development homepage permits retesting; production never bypasses cooldown', () => {
  assert.equal(subscriptionPromptPreviewMode('development', undefined), true);
  assert.equal(subscriptionPromptPreviewMode('development', '1'), true);
  assert.equal(subscriptionPromptPreviewMode('development', '0'), false);
  for (const environment of ['production', 'test', undefined]) {
    for (const query of [undefined, '0', '1']) {
      assert.equal(subscriptionPromptPreviewMode(environment, query), false);
    }
  }
});

test('default local preview retries on navigation without deleting the saved cooldown', t => {
  const h = setup(t, { ignoreCooldown: subscriptionPromptPreviewMode('development') });
  h.record();
  h.scroll(1000); h.advance(2000); assert.equal(h.prompts, 1);
  assert.ok(h.win.localStorage.getItem(SUBSCRIPTION_PROMPT_KEY));
  h.restart('/'); h.advance(2000); assert.equal(h.prompts, 2);
  h.subscribe(); h.restart('/'); h.advance(2000); assert.equal(h.prompts, 2);
});

test('15 seconds of visible reading alone triggers once, with no scrolling', t => {
  const h = setup(t);
  h.advance(14_000); assert.equal(h.prompts, 0);
  h.advance(1000); assert.equal(h.prompts, 1);
  h.advance(60_000); assert.equal(h.prompts, 1);
});

test('content pages trigger at exactly 25 percent without waiting for a timer or scroll rest', t => {
  const h = setup(t, { page: '/blog-single/example' });
  h.scroll(999); h.advance(2000); assert.equal(h.prompts, 0);
  h.scroll(1000); assert.equal(h.prompts, 1);
  assert.deepEqual(h.lastPrompt, { trigger: 'scroll-progress', elapsedMs: 2000, progressPercent: 25 });
});

test('homepage triggers at the earlier of Background entry and 25 percent', t => {
  for (const backgroundTop of [1250, 4000]) {
    const h = setup(t, { backgroundTop });
    const threshold = Math.min(backgroundTop - 750, 1000);
    h.scroll(threshold - 1); h.advance(2000); assert.equal(h.prompts, 0);
    h.scroll(threshold); assert.equal(h.prompts, 1);
  }
});

test('missing homepage heading still permits the 25 percent trigger', t => {
  const h = setup(t, { backgroundTop: null });
  h.scroll(1000); h.advance(2000); assert.equal(h.prompts, 1);
});

test('layout changes after scrolling are checked without another scroll event', t => {
  const h = setup(t, { backgroundTop: 4000 });
  h.scroll(800); h.advance(2000); assert.equal(h.prompts, 0);
  h.doc.getElementById('tour-background').getBoundingClientRect = () => ({ top: 650, height: 60 });
  h.advance(1000); assert.equal(h.prompts, 1);
});

test('mobile toolbar resizing cannot delay or duplicate an invitation', t => {
  const h = setup(t);
  h.scroll(1000);
  for (let i = 0; i < 3; i++) { h.win.dispatchEvent(new h.win.Event('resize')); h.advance(1000); }
  assert.equal(h.prompts, 1);
});

test('scrolling while blocked is rechecked after the overlay closes', t => {
  const h = setup(t);
  const overlay = h.doc.createElement('div'); overlay.setAttribute('role', 'dialog'); h.doc.body.append(overlay);
  h.scroll(1000); h.advance(2000); assert.equal(h.prompts, 0);
  overlay.remove(); h.advance(1000); assert.equal(h.prompts, 1);
});

test('hidden dialogs and collapsed chat containers do not block invitations', t => {
  for (const html of [
    '<div role="dialog" hidden></div>', '<div aria-hidden="true"><div role="dialog"></div></div>',
    '<div style="display:none"><div role="dialog"></div></div>',
    '<div role="dialog" style="visibility:hidden"></div>',
    '<div id="__chat_widget_root" style="display:none"><div class="bot-container"></div></div>',
  ]) {
    const h = setup(t); h.doc.body.insertAdjacentHTML('beforeend', html);
    h.scroll(1000); h.advance(2000); assert.equal(h.prompts, 1, html);
  }
});

test('requesting a dialog does not consume cooldown before it is actually mounted', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.yuqi.site/' });
  const win = dom.window; let tick, time = 1_800_000_000_000, requested = 0;
  Object.defineProperty(win.document, 'hidden', { value: false });
  win.setInterval = fn => { tick = fn; return 1; }; win.clearInterval = () => {};
  const stop = startSubscriptionPrompt({ win, doc: win.document, page: '/', hasSubscriber: () => false,
    now: () => time, onPrompt: () => requested++ });
  for (let i = 0; i < 15; i++) { time += 1000; tick(); }
  assert.equal(requested, 1);
  assert.equal(win.localStorage.getItem(SUBSCRIPTION_PROMPT_KEY), null);
  stop(); dom.window.close();
});

test('restored scroll position is recognized without waiting for another scroll', t => {
  const h = setup(t, { scrollY: 1000 });
  h.advance(2000); assert.equal(h.prompts, 1);
});

test('explicit development preview can repeat while normal visitors retain cooldown', t => {
  const h = setup(t, { ignoreCooldown: true });
  h.record(); h.scroll(1000); h.advance(2000); assert.equal(h.prompts, 1);
});

test('continuous scrolling triggers at the first threshold crossing instead of much farther down', t => {
  const h = setup(t, { backgroundTop: null });
  for (let y = 100; y < 1000; y += 100) {
    h.scroll(y); h.advance(50); assert.equal(h.prompts, 0);
  }
  h.scroll(1000); assert.equal(h.prompts, 1);
  assert.equal(h.lastPrompt.progressPercent, 25);
  assert.ok(h.lastPrompt.elapsedMs < 1000);
  for (let y = 1100; y < 3000; y += 100) { h.scroll(y); h.advance(50); }
  assert.equal(h.prompts, 1);
});

test('15 second fallback is not delayed by scrolling below the progress threshold', t => {
  const h = setup(t, { backgroundTop: null });
  for (let i = 0; i < 14; i++) { h.scroll(i); h.advance(1000); }
  assert.equal(h.prompts, 0);
  h.scroll(20); h.advance(1000); assert.equal(h.prompts, 1);
  assert.equal(h.lastPrompt.trigger, 'reading-time');
});

test('hidden tabs do not count time or scroll, and sleeping timers cannot skip the delay', t => {
  const h = setup(t);
  h.advance(5000); h.hide(true); h.scroll(2000); h.advance(60_000);
  assert.equal(h.prompts, 0);
  h.scroll(0);
  h.hide(false); h.advance(9000); assert.equal(h.prompts, 0);
  h.advance(1000); assert.equal(h.prompts, 1);
  const other = setup(t);
  other.suspend(60_000); assert.equal(other.prompts, 0);
  other.advance(14_000); assert.equal(other.prompts, 1);
});

test('typing, search dialogs, chat, tour and menu pause prompts and reading time', t => {
  for (const html of [
    '<input autofocus>', '<textarea></textarea>', '<div contenteditable="true"><span tabindex="0">Editing</span></div>',
    '<div role="dialog"></div>', '<div id="__chat_widget_root"><div class="bot-container"></div></div>',
    '<div class="st-roaming-pet"></div>', '<div class="menu-full-overlay is-open"></div>',
  ]) {
    const h = setup(t);
    h.doc.body.innerHTML = html;
    h.doc.querySelector('input, textarea, span')?.focus();
    h.advance(30_000); h.scroll(2000); h.advance(2000);
    assert.equal(h.prompts, 0, html);
    h.doc.body.innerHTML = '';
    h.advance(16_000); assert.equal(h.prompts, 1, html);
  }
});

test('existing and newly subscribed visitors never receive an automatic prompt', t => {
  const existing = setup(t, { subscriber: true });
  existing.advance(30_000); existing.scroll(2000); existing.advance(2000);
  assert.equal(existing.prompts, 0);
  const current = setup(t); current.advance(14_000); current.subscribe(); current.advance(2000);
  assert.equal(current.prompts, 0);
});

test('manual opening and automatic opening both suppress prompts across pages for seven days', t => {
  for (const manual of [false, true]) {
    const h = setup(t);
    if (manual) h.record(); else h.advance(15_000);
    const before = h.prompts;
    h.restart('/blogs'); h.scroll(2000); h.advance(30_000);
    assert.equal(h.prompts, before);
    h.advance(SUBSCRIPTION_PROMPT_COOLDOWN_MS - 30_000);
    h.restart('/'); h.advance(15_000);
    assert.equal(h.prompts, before + 1);
  }
});

test('another tab recording an invitation cancels a pending prompt', t => {
  const h = setup(t);
  h.advance(14_000);
  h.win.localStorage.setItem(SUBSCRIPTION_PROMPT_KEY, String(1_800_000_014_000));
  h.advance(5000); assert.equal(h.prompts, 0);
});

test('storage failures retain the in-memory cooldown and malformed stored data is harmless', t => {
  const h = setup(t, { storageBlocked: true });
  h.advance(15_000); assert.equal(h.prompts, 1);
  h.restart('/blogs'); h.advance(30_000); assert.equal(h.prompts, 1);
  const other = setup(t);
  other.win.localStorage.setItem(SUBSCRIPTION_PROMPT_KEY, 'not-a-date');
  other.advance(15_000); assert.equal(other.prompts, 1);
});

test('navigation cleanup cancels pending callbacks and a new page starts a fresh delay', t => {
  const h = setup(t);
  h.advance(14_000); h.restart('/blogs'); h.advance(1000); assert.equal(h.prompts, 0);
  h.advance(14_000); assert.equal(h.prompts, 1);
  const other = setup(t); other.advance(14_000); other.stop(); other.advance(30_000);
  assert.equal(other.prompts, 0);
});

test('only public reading pages are eligible, never admin, auth, private life posts or APIs', t => {
  for (const path of ['/', '/?source=test#about', '/blogs', '/blog-single/post-1', '/work-single/project-1', '/works-list']) {
    assert.equal(isSubscriptionPromptPage(path), true, path);
  }
  for (const path of ['/admin', '/admin/login', '/oauth/consent', '/auth/callback', '/api/test', '/life-blog/private', '/cv', '/privacy', '/mcp/admin']) {
    assert.equal(isSubscriptionPromptPage(path), false, path);
    const h = setup(t, { page: path }); h.advance(30_000); h.scroll(2000); h.advance(2000);
    assert.equal(h.prompts, 0, path);
  }
});
