import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  isSubscriptionPromptPage, recordSubscriptionPrompt, startSubscriptionPrompt,
  SUBSCRIPTION_PROMPT_KEY, SUBSCRIPTION_PROMPT_COOLDOWN_MS,
  SUBSCRIPTION_PROMPT_VISITOR_LEAD_PX,
  subscriptionPromptPreviewMode,
} from '../src/lib/subscriptionPrompt.mjs';

const visitorTop = 4250;
const homepageThreshold = visitorTop - 1000 - SUBSCRIPTION_PROMPT_VISITOR_LEAD_PX;

function setup(t, { page = '/', subscriber = false, storageBlocked = false, scrollY = 0, ignoreCooldown = false, visitorsTop = visitorTop } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.yuqi.site/' });
  const win = dom.window, doc = win.document;
  win.scrollY = scrollY;
  doc.body.innerHTML = '<section id="Blog-section"><h2>My Blogs</h2></section><h3 id="tour-real-time-data">Real-Time Data</h3>';
  doc.querySelector('#Blog-section h2').getBoundingClientRect = () => ({ top: 2500 - win.scrollY, height: 60 });
  doc.getElementById('tour-real-time-data').getBoundingClientRect = () => ({ top: 3000 - win.scrollY, height: 60 });
  if (visitorsTop !== null) {
    const heading = doc.createElement('h3');
    heading.id = 'visitor-insights';
    heading.textContent = 'Visitor Insights';
    heading.getBoundingClientRect = () => ({ top: visitorsTop - win.scrollY, height: 40 });
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
    get timerActive() { return Boolean(tick); },
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
  const h = setup(t, { page: '/', ignoreCooldown: subscriptionPromptPreviewMode('development') });
  h.record();
  h.scroll(homepageThreshold); h.advance(2000); assert.equal(h.prompts, 1);
  assert.ok(h.win.localStorage.getItem(SUBSCRIPTION_PROMPT_KEY));
  h.restart('/'); h.advance(2000); assert.equal(h.prompts, 2);
  h.subscribe(); h.restart('/'); h.advance(2000); assert.equal(h.prompts, 2);
});

test('article and listing pages never prompt, even with preview and a matching heading', t => {
  for (const page of ['/blogs', '/works', '/works-list', '/blog-single/example', '/work-single/example']) {
    for (const ignoreCooldown of [false, true]) {
      const h = setup(t, { page, ignoreCooldown });
      assert.equal(h.timerActive, false, page);
      h.advance(60_000); h.scroll(1000); h.scroll(homepageThreshold); h.advance(60_000);
      assert.equal(h.prompts, 0, page);
    }
  }
});

test('homepage waits until just before Visitor Insights, never at Background, Blogs, Real-Time Data or 25 percent', t => {
  for (const page of ['/', '/?source=resume#about']) {
    const h = setup(t, { page });
    h.advance(60_000); assert.equal(h.prompts, 0);
    h.doc.body.insertAdjacentHTML('afterbegin', '<h2 id="tour-background">My Background</h2>');
    h.doc.getElementById('tour-background').getBoundingClientRect = () => ({ top: 200, height: 60 });
    h.scroll(1000); h.advance(20_000); assert.equal(h.prompts, 0);
    h.scroll(2000); h.advance(20_000); assert.equal(h.prompts, 0, 'My Blogs is too early');
    h.scroll(2500); h.advance(20_000); assert.equal(h.prompts, 0, 'Real-Time Data heading is too early');
    h.scroll(homepageThreshold - 1); h.advance(20_000); assert.equal(h.prompts, 0);
    h.scroll(homepageThreshold); assert.equal(h.prompts, 1);
    assert.equal(h.lastPrompt.trigger, 'visitor-insights');
    h.advance(30_000); h.scroll(3000); assert.equal(h.prompts, 1);
  }
});

test('homepage with missing or unmeasurable Visitor Insights never falls back to Blogs or a timer', t => {
  for (const visitorsTop of [null, visitorTop]) {
    const h = setup(t, { page: '/', visitorsTop });
    const heading = h.doc.getElementById('visitor-insights');
    if (heading) heading.getBoundingClientRect = () => ({ top: 0, height: 0 });
    h.scroll(4000); h.advance(60_000); assert.equal(h.prompts, 0);
  }
});

test('layout changes after scrolling are checked without another scroll event', t => {
  const h = setup(t, { page: '/', visitorsTop: 4000 });
  h.scroll(800); h.advance(2000); assert.equal(h.prompts, 0);
  h.doc.getElementById('visitor-insights').getBoundingClientRect = () => ({ top: 1050, height: 40 });
  h.advance(1000); assert.equal(h.prompts, 1);
});

test('mobile toolbar resizing cannot delay or duplicate an invitation', t => {
  const h = setup(t, { page: '/' });
  h.scroll(homepageThreshold);
  for (let i = 0; i < 3; i++) { h.win.dispatchEvent(new h.win.Event('resize')); h.advance(1000); }
  assert.equal(h.prompts, 1);
});

test('scrolling while blocked is rechecked after the overlay closes', t => {
  const h = setup(t, { page: '/' });
  const overlay = h.doc.createElement('div'); overlay.setAttribute('role', 'dialog'); h.doc.body.append(overlay);
  h.scroll(homepageThreshold); h.advance(20_000); assert.equal(h.prompts, 0);
  overlay.remove(); h.advance(1000); assert.equal(h.prompts, 1);
});

test('homepage does not prompt after returning above Visitor Insights while a dialog was open', t => {
  const h = setup(t, { page: '/' });
  const overlay = h.doc.createElement('div'); overlay.setAttribute('role', 'dialog'); h.doc.body.append(overlay);
  h.scroll(homepageThreshold); h.advance(20_000);
  h.scroll(1000); overlay.remove(); h.advance(20_000);
  assert.equal(h.prompts, 0);
  h.scroll(homepageThreshold); assert.equal(h.prompts, 1);
});

test('homepage still respects existing subscribers, cooldown and tab visibility at Visitor Insights', t => {
  const subscribed = setup(t, { page: '/', subscriber: true });
  subscribed.scroll(homepageThreshold); subscribed.advance(30_000); assert.equal(subscribed.prompts, 0);
  const cooldown = setup(t, { page: '/' });
  cooldown.record(); cooldown.scroll(homepageThreshold); cooldown.advance(30_000); assert.equal(cooldown.prompts, 0);
  const hidden = setup(t, { page: '/' });
  hidden.hide(true); hidden.scroll(homepageThreshold); hidden.advance(30_000); assert.equal(hidden.prompts, 0);
  hidden.hide(false); assert.equal(hidden.prompts, 1);
});

test('hidden dialogs and collapsed chat containers do not block invitations', t => {
  for (const html of [
    '<div role="dialog" hidden></div>', '<div aria-hidden="true"><div role="dialog"></div></div>',
    '<div style="display:none"><div role="dialog"></div></div>',
    '<div role="dialog" style="visibility:hidden"></div>',
    '<div id="__chat_widget_root" style="display:none"><div class="bot-container"></div></div>',
  ]) {
    const h = setup(t); h.doc.body.insertAdjacentHTML('beforeend', html);
    h.scroll(homepageThreshold); h.advance(2000); assert.equal(h.prompts, 1, html);
  }
});

test('requesting a dialog does not consume cooldown before it is actually mounted', () => {
  const dom = new JSDOM('<!doctype html><body><h3 id="visitor-insights">Visitors</h3></body>', { url: 'https://www.yuqi.site/' });
  const win = dom.window; let tick, time = 1_800_000_000_000, requested = 0;
  Object.defineProperty(win.document, 'hidden', { value: false });
  win.scrollY = 1000;
  win.document.getElementById('visitor-insights').getBoundingClientRect = () => ({ top: 100, height: 40 });
  win.setInterval = fn => { tick = fn; return 1; }; win.clearInterval = () => {};
  const stop = startSubscriptionPrompt({ win, doc: win.document, page: '/', hasSubscriber: () => false,
    now: () => time, onPrompt: () => requested++ });
  time += 1000; tick();
  assert.equal(requested, 1);
  assert.equal(win.localStorage.getItem(SUBSCRIPTION_PROMPT_KEY), null);
  stop(); dom.window.close();
});

test('restored scroll position is recognized without waiting for another scroll', t => {
  const h = setup(t, { page: '/', scrollY: homepageThreshold });
  h.advance(2000); assert.equal(h.prompts, 1);
});

test('explicit development preview can repeat while normal visitors retain cooldown', t => {
  const h = setup(t, { ignoreCooldown: true });
  h.record(); h.scroll(homepageThreshold); h.advance(2000); assert.equal(h.prompts, 1);
});

test('continuous scrolling triggers at the first threshold crossing instead of much farther down', t => {
  const h = setup(t);
  for (let y = 100; y < homepageThreshold; y += 100) {
    h.scroll(y); h.advance(50); assert.equal(h.prompts, 0);
  }
  h.scroll(homepageThreshold); assert.equal(h.prompts, 1);
  assert.equal(h.lastPrompt.trigger, 'visitor-insights');
  for (let y = homepageThreshold; y < 4000; y += 100) { h.scroll(y); h.advance(50); }
  assert.equal(h.prompts, 1);
});

test('elapsed time alone never triggers an invitation', t => {
  const h = setup(t);
  for (let i = 0; i < 14; i++) { h.scroll(i); h.advance(1000); }
  assert.equal(h.prompts, 0);
  h.scroll(20); h.advance(60_000); assert.equal(h.prompts, 0);
});

test('hidden and sleeping tabs never bypass the homepage location requirement', t => {
  const h = setup(t);
  h.advance(5000); h.hide(true); h.scroll(homepageThreshold); h.advance(60_000);
  assert.equal(h.prompts, 0);
  h.scroll(0);
  h.hide(false); h.advance(9000); assert.equal(h.prompts, 0);
  h.advance(1000); assert.equal(h.prompts, 0);
  h.scroll(homepageThreshold); assert.equal(h.prompts, 1);
  const other = setup(t);
  other.suspend(60_000); assert.equal(other.prompts, 0);
  other.advance(14_000); assert.equal(other.prompts, 0);
});

test('typing, search dialogs, chat, tour and menu pause prompts and reading time', t => {
  for (const html of [
    '<input autofocus>', '<textarea></textarea>', '<div contenteditable="true"><span tabindex="0">Editing</span></div>',
    '<div role="dialog"></div>', '<div id="__chat_widget_root"><div class="bot-container"></div></div>',
    '<div class="st-roaming-pet"></div>', '<div class="menu-full-overlay is-open"></div>',
  ]) {
    const h = setup(t);
    const blocker = h.doc.createElement('div'); blocker.innerHTML = html; h.doc.body.append(blocker);
    h.doc.querySelector('input, textarea, span')?.focus();
    h.advance(30_000); h.scroll(homepageThreshold); h.advance(2000);
    assert.equal(h.prompts, 0, html);
    blocker.remove();
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
    if (manual) h.record(); else h.scroll(homepageThreshold);
    const before = h.prompts;
    h.restart('/'); h.scroll(homepageThreshold); h.advance(30_000);
    assert.equal(h.prompts, before);
    h.advance(SUBSCRIPTION_PROMPT_COOLDOWN_MS - 30_000);
    h.restart('/'); h.advance(1000);
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
  h.scroll(homepageThreshold); assert.equal(h.prompts, 1);
  h.restart('/'); h.advance(30_000); assert.equal(h.prompts, 1);
  const other = setup(t);
  other.win.localStorage.setItem(SUBSCRIPTION_PROMPT_KEY, 'not-a-date');
  other.scroll(homepageThreshold); assert.equal(other.prompts, 1);
});

test('navigation away cleans up the homepage timer and scroll callback', t => {
  const h = setup(t);
  h.advance(14_000); h.restart('/blogs'); h.advance(1000); assert.equal(h.prompts, 0);
  assert.equal(h.timerActive, false);
  h.scroll(homepageThreshold); h.advance(60_000); assert.equal(h.prompts, 0);
  h.restart('/'); h.advance(1000); assert.equal(h.prompts, 1);
  const other = setup(t); other.advance(14_000); other.stop(); other.advance(30_000);
  assert.equal(other.prompts, 0);
});

test('only the homepage is eligible; query and hash do not change eligibility', t => {
  for (const path of ['/', '/?source=test#about', '/#visitor-insights']) {
    assert.equal(isSubscriptionPromptPage(path), true, path);
  }
  for (const path of ['', null, undefined, '/blogs', '/blog-single/post-1', '/work-single/project-1', '/works-list', '/admin', '/admin/login', '/oauth/consent', '/auth/callback', '/api/test', '/life-blog/private', '/cv', '/privacy', '/mcp/admin']) {
    assert.equal(isSubscriptionPromptPage(path), false, path);
    const h = setup(t, { page: path ?? '' }); h.advance(30_000); h.scroll(homepageThreshold); h.advance(2000);
    assert.equal(h.prompts, 0, path);
  }
});
