import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const policy = asModule(await readFile(new URL('../src/lib/analyticsPagePolicy.mjs', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/lib/behaviorAnalytics.js', import.meta.url), 'utf8');
const behavior = await import(asModule(`
  import { isPrivateAnalyticsPage, publicOutboundTarget } from '${policy}';
  const isBrowserAnalyticsDisabled = () => false;
` + source.replace(/^import .+;\r?$/gm, '')));
const key = 'yuqi_analytics_pending_v1';
const settle = () => new Promise(resolve => setImmediate(resolve));
const ack = payload => ({ ok: true, status: 200, json: async () => ({ ok: true, eventId: payload.eventId }) });

async function harness(run, { saved, online = true, url = 'https://www.yuqi.site/' } = {}) {
  const dom = new JSDOM('', { url });
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const originalNow = Date.now, originalKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  let now = originalNow(), id = 0, hidden = false;
  const timers = new Map(), requests = [];
  let responder = ack;
  delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  Date.now = () => now;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body); requests.push({ payload, options });
      return responder(payload);
    } });
  Object.defineProperty(window.navigator, 'onLine', { get: () => online });
  Object.defineProperty(document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible' });
  window.setTimeout = (fn, delay) => { timers.set(++id, { fn, due: now + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  if (saved) window.sessionStorage.setItem(key, saved);
  const h = {
    requests, timers, dom,
    respond: fn => { responder = fn; },
    pending: () => JSON.parse(window.sessionStorage.getItem(key) || '[]'),
    saved: () => window.sessionStorage.getItem(key),
    online: value => { online = value; window.dispatchEvent(new window.Event('online')); },
    hidden: value => { hidden = value; document.dispatchEvent(new window.Event('visibilitychange')); },
    advance: async ms => {
      now += ms;
      for (const [tid, timer] of [...timers]) if (timer.due <= now) { timers.delete(tid); timer.fn(); }
      await settle();
    },
    track: (event = 'read_progress', context = {}) => behavior.trackBehavior(event,
      { page: '/', properties: { progressPercent: 75 }, ...context }),
  };
  try { await run(h); } finally {
    Object.assign(globalThis, original); Date.now = originalNow;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    else process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = originalKey;
    dom.window.close();
  }
}

test('persists before send and retries a lost ACK with identical event identity and timestamp', () => harness(async h => {
  h.respond(() => { assert.equal(h.pending().length, 1); throw new Error('Lost ACK'); });
  assert.equal(h.track(), true); await settle();
  const original = h.requests[0].payload;
  assert.equal(h.pending().length, 1); assert.equal(h.timers.size, 1);
  h.respond(ack); await h.advance(3000);
  assert.deepEqual(h.requests[1].payload, original);
  assert.equal(h.saved(), null); assert.equal(h.timers.size, 0);
  await h.advance(60000); assert.equal(h.requests.length, 2);
}));

test('missing or mismatched acknowledgements are not accepted as delivery', () => harness(async h => {
  h.respond(() => ({ ok: true, status: 200, json: async () => ({ ok: true, eventId: 'wrong' }) }));
  h.track(); await settle(); assert.equal(h.pending().length, 1);
  h.respond(ack); await h.advance(3000); assert.equal(h.pending().length, 0);
}));

test('same-tab reload recovers the original session, page, event and progress', async () => {
  let saved, first;
  await harness(async h => {
    h.respond(() => ({ ok: false, status: 503 }));
    h.track('read_progress', { page: '/work-single/project-a' }); await settle();
    saved = h.saved(); first = h.requests[0].payload;
  });
  await harness(async h => {
    behavior.startPageBehaviorTracking('/blogs', { recordPageView: false })();
    await h.advance(4000);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0].payload, first);
    assert.equal(h.saved(), null);
  }, { saved, url: 'https://www.yuqi.site/blogs' });
});

test('offline and hidden tabs do not poll; online and visible resume due entries', () => harness(async h => {
  h.track(); await settle();
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0);
  h.hidden(true); h.online(true); await settle();
  assert.equal(h.requests.length, 0);
  h.hidden(false); await settle(); assert.equal(h.requests.length, 1); assert.equal(h.saved(), null);
}, { online: false }));

test('leaving flushes without waiting for optional CAPTCHA, and late token cannot duplicate delivery', () => harness(async h => {
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'test-only';
  let resolve;
  window.grecaptcha = { enterprise: { ready: fn => fn(), execute: () => new Promise(done => { resolve = done; }) } };
  h.track(); assert.equal(h.requests.length, 0); assert.equal(h.pending().length, 1);
  window.dispatchEvent(new window.Event('pagehide')); await settle();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].payload.recaptchaToken, undefined);
  resolve('late-token'); await settle(); assert.equal(h.requests.length, 1); assert.equal(h.saved(), null);
}));

test('Retry-After is respected across reloads; permanent rejection is not retried', async () => {
  let saved;
  await harness(async h => {
    h.respond(() => ({ ok: false, status: 429, headers: { get: () => '120' } }));
    h.track(); await settle(); saved = h.saved();
    await h.advance(60000); assert.equal(h.requests.length, 1);
  });
  await harness(async h => {
    h.respond(() => ({ ok: false, status: 400 }));
    behavior.startPageBehaviorTracking('/', { recordPageView: false })();
    await h.advance(60000); assert.equal(h.requests.length, 0);
    await h.advance(61000); assert.equal(h.requests.length, 1); assert.equal(h.saved(), null);
  }, { saved });
});

test('privacy withdrawal clears queued events and retries, and private pages cannot replay', async () => {
  let saved;
  await harness(async h => {
    h.respond(() => ({ ok: false, status: 503 }));
    h.track(); await settle(); saved = h.saved();
    behavior.setAnalyticsConsent('denied'); assert.equal(h.saved(), null); assert.equal(h.timers.size, 0);
    await h.advance(60000); assert.equal(h.requests.length, 1); assert.equal(h.track(), false);
  });
  await harness(async h => {
    behavior.startPageBehaviorTracking('/admin/visitors')(); await h.advance(60000);
    assert.equal(h.requests.length, 0);
  }, { saved, url: 'https://www.yuqi.site/admin/visitors' });
});

test('queue bounds memory, bytes and concurrent network work during outages', () => harness(async h => {
  h.respond(() => new Promise(() => {}));
  for (let i = 0; i < 100; i++) h.track('content_open', { properties: { contentId: 'x'.repeat(1000) } });
  assert.equal(h.requests.length, 3);
  assert.ok(h.pending().length <= 32);
  assert.ok(Buffer.byteLength(h.saved()) <= 32 * 1024);
  assert.equal(h.track('content_open', { properties: { contentId: '文'.repeat(3000) } }), false);
}));

test('six-hour expiry drops old retry work and queue stores no CAPTCHA or referrer query secrets', async () => {
  let saved;
  await harness(async h => {
    h.track('page_view', { referrer: 'https://example.test/path?token=secret#private' });
    saved = h.saved(); assert.equal(h.pending()[0].payload.referrer, 'https://example.test/path');
    assert.doesNotMatch(saved, /recaptchaToken|token=secret|#private/);
  }, { online: false });
  const entries = JSON.parse(saved); entries[0].payload.localTime = new Date(Date.now() - 7 * 3600000).toISOString();
  await harness(async h => {
    behavior.startPageBehaviorTracking('/', { recordPageView: false })(); await h.advance(60000);
    assert.equal(h.requests.length, 0);
  }, { saved: JSON.stringify(entries) });
});

test('opening a project without scrolling never invents a 25 percent event', () => harness(async h => {
  const cleanup = behavior.startPageBehaviorTracking('/');
  h.track('project_open', { target: '/work-single/project-a' }); cleanup();
  await settle(); await h.advance(60000);
  assert.deepEqual(h.requests.map(r => r.payload.event), ['page_view', 'project_open']);
}));
