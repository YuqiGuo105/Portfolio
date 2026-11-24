import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createViewportPreviewController } from '../src/lib/media/viewportPreview.mjs';

function fixture() {
  let now = 0, nextId = 0, observer, reads = 0, observerCount = 0;
  const timers = new Map();
  const touch = Object.assign(new EventTarget(), { matches: true });
  const reduced = Object.assign(new EventTarget(), { matches: false });
  const connection = Object.assign(new EventTarget(), { saveData: false });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = Object.assign(new EventTarget(), {
    innerHeight: 800,
    matchMedia: query => query.includes('reduced-motion') ? reduced : touch,
    setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const controller = createViewportPreviewController({ window: win, document: doc, navigator: { connection },
    IntersectionObserver: class {
      constructor(callback) { observerCount++; observer = this; this.callback = callback; }
      observe() {}
      unobserve() {}
      disconnect() { this.disconnected = true; }
    },
  });
  const covers = [];
  const add = (top = 250) => {
    const state = { plays: 0, stops: 0 };
    const element = { isConnected: true, getBoundingClientRect() { reads++; return { top, height: 200 }; } };
    const subscription = controller.register(element, {
      start() {
        state.plays++;
        win.dispatchEvent(Object.assign(new Event('yuqi:media-preview-start'), { detail: element }));
      },
      stop() { state.stops++; },
    });
    const cover = { ...subscription, element, state };
    covers.push(cover);
    return cover;
  };
  return {
    doc, win, touch, reduced, connection, timers, controller, covers, add,
    get reads() { return reads; }, get observerCount() { return observerCount; },
    intersect(cover, ratio) { observer.callback([{ target: cover.element, isIntersecting: ratio > 0, intersectionRatio: ratio }]); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
    scroll() { doc.dispatchEvent(new Event('scroll')); },
    pointer(type) { doc.dispatchEvent(Object.assign(new Event(type), { pointerType: 'touch' })); },
    dispose() { controller.dispose(); assert.equal(timers.size, 0); assert.ok(observer.disconnected); },
  };
}

test('100 covers share one observer/timer and do zero layout reads while scrolling', () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) f.add();
  f.intersect(f.covers[0], 1);
  for (let i = 0; i < 100; i++) { f.scroll(); f.advance(10); }
  assert.equal(f.observerCount, 1);
  assert.equal(f.timers.size, 1);
  assert.equal(f.reads, 0);
  assert.equal(f.covers[0].state.plays, 0);
  f.advance(1000);
  assert.equal(f.reads, 1);
  assert.equal(f.covers[0].state.plays, 1);
  assert.equal(f.timers.size, 0);
  f.dispose();
});

test('only the mostly visible cover nearest the screen center plays', () => {
  const f = fixture(), a = f.add(0), b = f.add(300), c = f.add(400);
  f.intersect(a, 1); f.intersect(b, 0.8); f.intersect(c, 0.6);
  f.advance(1000);
  assert.deepEqual(f.covers.map(x => x.state.plays), [0, 1, 0]);
  f.intersect(b, 0.5);
  assert.equal(b.state.stops, 1);
  f.advance(1000);
  assert.deepEqual(f.covers.map(x => x.state.plays), [1, 1, 0]);
  f.dispose();
});

test('finger held on the screen delays autoplay until release and settling', () => {
  const f = fixture(), a = f.add();
  f.intersect(a, 1); f.advance(500); f.pointer('pointerdown'); f.advance(2000);
  assert.equal(a.state.plays, 0);
  f.pointer('pointerup'); f.advance(999); assert.equal(a.state.plays, 0);
  f.advance(1); assert.equal(a.state.plays, 1);
  f.dispose();
});

for (const setting of ['reduced', 'connection', 'touch', 'hidden']) {
  test(`${setting} disables automatic playback and stops an already automatic preview`, () => {
    const f = fixture(), a = f.add();
    f.intersect(a, 1); f.advance(1000); assert.equal(a.state.plays, 1);
    if (setting === 'hidden') { f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); }
    else {
      if (setting === 'connection') f.connection.saveData = true;
      else f[setting].matches = setting === 'reduced';
      f[setting].dispatchEvent(new Event('change'));
    }
    assert.equal(a.state.stops, 1);
    f.scroll(); f.advance(2000); assert.equal(a.state.plays, 1);
    assert.equal(f.timers.size, 0);
    f.dispose();
  });
}

test('pause suppression remains until exit, and removed covers never play', () => {
  const f = fixture(), a = f.add();
  f.intersect(a, 1); a.suppress(); f.scroll(); f.advance(1000);
  assert.equal(a.state.plays, 0);
  f.intersect(a, 0); f.intersect(a, 1); f.advance(1000);
  assert.equal(a.state.plays, 1);
  a.unregister(); f.scroll(); f.advance(1000);
  assert.equal(a.state.plays, 1); assert.equal(f.controller.size, 0);
  f.dispose();
  f.scroll(); f.pointer('pointerup'); f.win.dispatchEvent(new Event('resize'));
  assert.equal(f.timers.size, 0);
});

test('an explicit preview is not stopped by reduced motion or desktop scrolling', () => {
  const f = fixture(), a = f.add();
  f.touch.matches = false; f.reduced.matches = true;
  f.win.dispatchEvent(Object.assign(new Event('yuqi:media-preview-start'), { detail: a.element }));
  f.scroll(); f.advance(2000); assert.equal(a.state.stops, 0);
  f.intersect(a, 0); assert.equal(a.state.stops, 1);
  f.dispose();
});
