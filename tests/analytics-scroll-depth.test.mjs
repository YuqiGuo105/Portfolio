import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const policy = asModule(await readFile(new URL('../src/lib/analyticsPagePolicy.mjs', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/lib/behaviorAnalytics.js', import.meta.url), 'utf8');
const { startPageBehaviorTracking } = await import(asModule(`
  import { isPrivateAnalyticsPage } from '${policy}';
  const isBrowserAnalyticsDisabled = () => false;
` + source.replace(/^import .+;\r?$/gm, '')));

function harness(run) {
  const dom = new JSDOM('', { url: 'https://www.yuqi.site/' });
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const requests = [], timers = new Map(), listeners = [];
  let timerId = 0, reads = 0, height = 5000, hidden = false;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true }; } });
  Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => { reads++; return height; } });
  Object.defineProperty(document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible' });
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
  const add = window.addEventListener.bind(window);
  window.addEventListener = (name, callback, options) => { listeners.push({ name, options }); add(name, callback, options); };
  window.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  const helpers = {
    requests, timers, listeners, dom, reads: () => reads,
    height: value => { height = value; }, hidden: value => { hidden = value; },
    scroll: y => { window.scrollY = y; window.dispatchEvent(new window.Event('scroll')); },
    tick: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(({ fn }) => fn()); },
    progress: () => requests.filter(r => r.event === 'read_progress').map(r => r.properties.progressPercent),
  };
  try { run(helpers); } finally { Object.assign(globalThis, original); dom.window.close(); }
}

test('no startup geometry work, no idle polling, passive scroll bursts share one delayed sample', () => harness(h => {
  const stop = startPageBehaviorTracking('/');
  assert.equal(h.reads(), 0); assert.equal(h.timers.size, 0);
  assert.deepEqual(h.requests.map(r => r.event), ['page_view']);
  for (let i = 0; i < 10000; i++) h.scroll(3000);
  assert.equal(h.reads(), 0); assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 1000);
  assert.deepEqual(h.listeners.find(l => l.name === 'scroll').options, { passive: true });
  h.tick();
  assert.equal(h.reads(), 1); assert.deepEqual(h.progress(), [75]);
  assert.equal(h.timers.size, 0);
  stop(); assert.equal(h.reads(), 1);
  assert.ok(h.requests.every(r => r.event !== 'engaged_time'));
}));

test('checkpoints are monotonic, deduplicated and capped at four; bottom removes scroll work', () => harness(h => {
  const stop = startPageBehaviorTracking('/');
  for (const y of [100, 1000, 1200, 0, 2000, 2500, 3000, 1000, 4000]) { h.scroll(y); h.tick(); }
  assert.deepEqual(h.progress(), [25, 50, 75, 100]);
  const reads = h.reads(); h.scroll(0); h.tick();
  assert.equal(h.reads(), reads); assert.equal(h.timers.size, 0);
  stop();
}));

test('fast jump to bottom reports only the highest checkpoint, even after scrolling back', () => harness(h => {
  const stop = startPageBehaviorTracking('/');
  h.scroll(4000); h.scroll(0); h.tick();
  assert.deepEqual(h.progress(), [100]); stop();
}));

test('pagehide flushes at most one pending checkpoint; cleanup cannot duplicate it', () => harness(h => {
  const stop = startPageBehaviorTracking('/');
  h.scroll(2200); h.hidden(true);
  window.dispatchEvent(new window.Event('pagehide'));
  stop(); stop(); h.tick(); h.scroll(4000);
  assert.deepEqual(h.progress(), [50]); assert.equal(h.timers.size, 0);
}));

test('fractional bottom offsets count as complete without sending intermediate checkpoints', () => harness(h => {
  const stop = startPageBehaviorTracking('/');
  h.scroll(3999.5); h.tick();
  assert.deepEqual(h.progress(), [100]);
  const reads = h.reads(); h.scroll(3999.5); h.tick();
  assert.equal(h.reads(), reads); stop();
}));

test('hiding the page flushes pending depth once without starting background work', () => harness(h => {
  const stop = startPageBehaviorTracking('/');
  h.scroll(3100); h.hidden(true);
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.deepEqual(h.progress(), [75]); assert.equal(h.timers.size, 0);
  const reads = h.reads();
  document.dispatchEvent(new window.Event('visibilitychange'));
  window.dispatchEvent(new window.Event('pagehide'));
  stop(); h.tick();
  assert.equal(h.reads(), reads); assert.deepEqual(h.progress(), [75]);
}));

test('private navigation discards pending samples and route changes never read a new page for the old path', () => harness(h => {
  const stop = startPageBehaviorTracking('/');
  h.scroll(4000); stop({ discard: true }); h.tick();
  assert.equal(h.reads(), 0); assert.deepEqual(h.progress(), []);
  const next = startPageBehaviorTracking('/', { recordPageView: false });
  h.scroll(4000); h.dom.reconfigure({ url: 'https://www.yuqi.site/blogs' }); next();
  assert.equal(h.reads(), 0); assert.deepEqual(h.progress(), []);
  assert.equal(h.requests.length, 1);
}));

test('hidden tabs do not sample layout; non-scrollable pages never claim 100 percent', () => harness(h => {
  const stop = startPageBehaviorTracking('/');
  h.hidden(true); h.scroll(1000); h.tick(); assert.equal(h.reads(), 0);
  h.hidden(false); h.height(900); h.scroll(0); h.tick();
  assert.deepEqual(h.progress(), []); stop();
}));

test('consent denial prevents listeners or cancels collection before geometry or network work', () => harness(h => {
  window.localStorage.setItem('yuqi_analytics_consent', 'denied');
  startPageBehaviorTracking('/')();
  assert.equal(h.listeners.length, 0); assert.equal(h.requests.length, 0);
  window.localStorage.setItem('yuqi_analytics_consent', 'granted');
  const stop = startPageBehaviorTracking('/'); h.scroll(4000);
  window.localStorage.setItem('yuqi_analytics_consent', 'denied'); h.tick(); stop();
  assert.equal(h.reads(), 0); assert.deepEqual(h.progress(), []);
}));
