import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { startHomeScrollReturn } from '../src/lib/homeScrollReturn.mjs';

const KEY = 'yuqi.home-return.v1';
function fixture({ url = 'https://example.com/', referrer, navigation = 'navigate', storage } = {}) {
  const dom = new JSDOM('<main class="wrapper"><section id="works-section"></section></main>', { url, ...(referrer ? { referrer } : {}) });
  const win = dom.window;
  let y = 0, sectionTop = 2000, height = 8000, next = 0;
  const handlers = new Map(), frames = new Map(), timers = new Map(), observers = new Set(), calls = [];
  Object.defineProperty(win, 'scrollY', { get: () => y });
  Object.defineProperty(win, 'innerHeight', { value: 800 });
  Object.defineProperty(win.document.documentElement, 'scrollHeight', { get: () => height });
  win.document.querySelector('section').getBoundingClientRect = () => ({ top: sectionTop - y, bottom: sectionTop + 2000 - y, height: 2000 });
  win.scrollTo = (_x, value) => { y = value; calls.push(value); };
  win.performance.getEntriesByType = () => [{ type: navigation }];
  win.requestAnimationFrame = fn => { frames.set(++next, fn); return next; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.setTimeout = fn => { timers.set(++next, fn); return next; };
  win.clearTimeout = id => timers.delete(id);
  win.ResizeObserver = class {
    constructor(fn) { this.fn = fn; observers.add(this); }
    observe() {}
    disconnect() { observers.delete(this); }
  };
  if (storage) win.sessionStorage.setItem(KEY, JSON.stringify(storage));
  let beforePopState = () => true;
  const router = { beforePopState: fn => { beforePopState = fn; }, events: {
    on: (event, fn) => handlers.set(event, fn),
    off: (event, fn) => { assert.equal(handlers.get(event), fn); handlers.delete(event); },
  } };
  const stop = startHomeScrollReturn(router, win);
  const emit = (event, path) => handlers.get(event)?.(path);
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  return {
    win, calls, emit, flush,
    setY: value => { y = value; },
    resize: (top, total = height) => { sectionTop = top; height = total; observers.forEach(o => o.fn()); flush(); },
    navigate(path, { pop = false } = {}) {
      if (pop) {
        win.history.replaceState({}, '', path);
        assert.equal(beforePopState(), true);
      }
      emit('routeChangeStart', path);
      win.history.replaceState({}, '', path);
      emit('routeChangeComplete', path);
      y = 0; // Next performs its own default scroll at route completion.
      flush();
    },
    read: () => JSON.parse(win.sessionStorage.getItem(KEY)),
    expire() { [...timers.values()].forEach(fn => fn()); },
    close() { stop(); assert.equal(beforePopState(), true); assert.equal(handlers.size, 0); assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(observers.size, 0); dom.window.close(); },
  };
}

test('home -> project -> homepage restores the position after Next resets scrolling', () => {
  const f = fixture();
  f.setY(2425);
  f.navigate('/work-single/project');
  assert.equal(f.read().y, 2425);
  f.setY(900);
  f.navigate('/');
  assert.equal(f.win.scrollY, 2425);
  f.close();
});

test('browser Back restores an exact position even when the saved home URL has a hash', () => {
  const f = fixture({ url: 'https://example.com/?utm_source=github#works-section' });
  f.setY(2500);
  f.navigate('/blog-single/article');
  f.navigate('/?utm_source=github#works-section', { pop: true });
  assert.equal(f.win.scrollY, 2500);
  f.close();
});

test('explicit section links take priority over the saved homepage position', () => {
  const f = fixture();
  f.setY(2450); f.navigate('/work-single/project');
  f.navigate('/#contact-section');
  assert.equal(f.calls.length, 0);
  f.close();
});

test('same-home navigation and unrelated routes keep normal scroll behavior', () => {
  const f = fixture();
  f.setY(2400); f.navigate('/');
  f.navigate('/blogs'); f.navigate('/blog-single/a');
  assert.equal(f.calls.length, 0);
  f.close();
});

test('personalized home routes and query strings share the same return behavior', () => {
  const f = fixture({ url: 'https://example.com/home/career?subscriptionPreview=0' });
  f.setY(2300); f.navigate('/work-single/p'); f.navigate('/?utm_source=linkedin');
  assert.equal(f.win.scrollY, 2300);
  f.close();
});

test('late layout changes preserve section-relative position and observation is bounded', () => {
  const f = fixture();
  f.setY(2400); f.navigate('/work-single/p'); f.navigate('/');
  f.resize(2200);
  assert.equal(f.win.scrollY, 2600);
  f.expire();
  f.resize(2500);
  assert.equal(f.win.scrollY, 2600);
  f.close();
});

for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
  test(`user ${event} stops restoration immediately`, () => {
    const f = fixture();
    f.setY(2400); f.navigate('/work-single/p'); f.navigate('/');
    f.win.dispatchEvent(new f.win.Event(event));
    f.setY(1000); f.resize(2300);
    assert.equal(f.win.scrollY, 1000);
    f.close();
  });
}

test('storage denied: client-side return still works and nothing throws', () => {
  const f = fixture();
  Object.defineProperty(f.win, 'sessionStorage', { get() { throw new Error('denied'); } });
  f.setY(2200); f.navigate('/work-single/p'); f.navigate('/');
  assert.equal(f.win.scrollY, 2200);
  f.close();
});

test('cancelled navigation never scrolls the current article or overwrites the home checkpoint', () => {
  const f = fixture();
  f.setY(2400); f.navigate('/work-single/p'); f.setY(500);
  f.emit('routeChangeStart', '/'); f.emit('routeChangeError'); f.flush();
  assert.equal(f.win.scrollY, 500);
  assert.equal(f.read().y, 2400);
  f.navigate('/'); assert.equal(f.win.scrollY, 2400);
  f.close();
});

test('pagehide persists a checkpoint for a same-tab full-document return', () => {
  const f = fixture();
  f.setY(2500); f.win.dispatchEvent(new f.win.Event('pagehide'));
  const storage = f.read(); f.close();
  const next = fixture({ referrer: 'https://example.com/work-single/p', storage });
  next.flush(); assert.equal(next.win.scrollY, 2500); next.close();
});

test('direct visits, external referrals and reloads do not override native scrolling', () => {
  for (const options of [{}, { referrer: 'https://other.com/' }, { navigation: 'reload' }]) {
    const f = fixture({ ...options, storage: { url: 'https://example.com/', y: 2400, at: Date.now() } });
    f.flush(); assert.equal(f.calls.length, 0); f.close();
  }
});

test('invalid, expired or foreign-origin checkpoints cannot trigger a scroll', () => {
  for (const override of [{ y: -3 }, { y: '2300' }, { at: 1 }, { url: 'https://other.com/' }]) {
    const f = fixture({ url: 'https://example.com/work-single/p', storage: { url: 'https://example.com/', y: 2400, at: Date.now(), ...override } });
    f.navigate('/'); assert.equal(f.calls.length, 0); f.close();
  }
});

test('missing sections fall back to absolute position, clamped to the current page height', () => {
  const f = fixture({ url: 'https://example.com/work-single/p', storage: { url: 'https://example.com/', y: 9000, anchor: 'removed', offset: 0, at: Date.now() } });
  f.navigate('/'); assert.equal(f.win.scrollY, 7200); f.close();
});

test('hash navigation and unmount cancel outstanding restoration callbacks', () => {
  const f = fixture();
  f.setY(2400); f.navigate('/work-single/p');
  f.emit('routeChangeStart', '/'); f.emit('routeChangeComplete', '/');
  f.emit('hashChangeStart', '/#contact-section');
  f.flush(); assert.equal(f.calls.length, 0);
  f.close();
});
