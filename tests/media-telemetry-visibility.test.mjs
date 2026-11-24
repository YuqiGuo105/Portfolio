import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryVisibility } from '../src/lib/media/telemetryVisibility.mjs';

function setup() {
  const timers = new Map(), docEvents = new Map(), events = new Map();
  let id = 0, observer, observers = 0, disconnected = 0;
  const win = { document: { hidden: false, addEventListener: (n, f) => docEvents.set(n, f), removeEventListener: n => docEvents.delete(n) },
    setTimeout: f => { timers.set(++id, f); return id; }, clearTimeout: n => timers.delete(n),
    addEventListener: (n, f) => events.set(n, f), removeEventListener: n => events.delete(n),
    IntersectionObserver: class { constructor(callback) { observers++; observer = callback; } observe() {} unobserve() {} disconnect() { disconnected++; } },
  };
  return { win, timers, docEvents, events, controller: createTelemetryVisibility(win),
    observe: changes => observer(changes), counts: () => ({ observers, disconnected }),
    flush: () => { for (const [n, f] of [...timers]) { timers.delete(n); f(); } } };
}

test('100 covers share one observer and listeners, with no idle timers or layout reads', () => {
  const s = setup(); let impressions = 0, boundaries = 0;
  const nodes = Array.from({ length: 100 }, () => ({ getBoundingClientRect() { throw new Error('Unexpected layout'); } }));
  const handles = nodes.map((node, i) => s.controller.observe(node, { key: `cover${i}`, impression: () => { impressions++; return true; }, boundary: () => boundaries++ }));
  assert.equal(s.counts().observers, 1); assert.equal(s.docEvents.size, 1); assert.equal(s.events.size, 1); assert.equal(s.timers.size, 0);
  s.observe([{ target: nodes[0], intersectionRatio: 1 }]); assert.equal(s.timers.size, 1);
  s.flush(); assert.equal(impressions, 1);
  s.observe([{ target: nodes[0], intersectionRatio: 0 }]); assert.equal(boundaries, 1);
  s.observe([{ target: nodes[0], intersectionRatio: 1 }]); s.flush(); assert.equal(impressions, 1);
  s.win.document.hidden = true; s.docEvents.get('visibilitychange')(); assert.equal(s.timers.size, 0); assert.equal(handles[0].visible(), false);
  handles.forEach(h => h.unregister()); assert.equal(s.counts().disconnected, 1); assert.equal(s.docEvents.size + s.events.size + s.timers.size, 0);
});

test('brief exposures, failed consent and hidden tabs do not count as impressions', () => {
  const s = setup(), node = {}; let impressions = 0, allowed = false;
  const h = s.controller.observe(node, { key: 'one', impression: () => { if (!allowed) return false; impressions++; return true; }, boundary() {} });
  s.observe([{ target: node, intersectionRatio: 1 }]); s.observe([{ target: node, intersectionRatio: 0 }]); s.flush(); assert.equal(impressions, 0);
  s.observe([{ target: node, intersectionRatio: 1 }]); s.flush(); assert.equal(impressions, 0);
  allowed = true; s.observe([{ target: node, intersectionRatio: 1 }]); s.flush(); assert.equal(impressions, 1);
  h.unregister();
});
