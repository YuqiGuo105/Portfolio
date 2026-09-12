import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { isPrivateAnalyticsEvent } from '../src/lib/analyticsPagePolicy.mjs';

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const withoutImports = source => source.replace(/^import .+;\r?$/gm, '');
const policy = asModule(await readFile(new URL('../src/lib/analyticsPagePolicy.mjs', import.meta.url), 'utf8'));
const behavior = await readFile(new URL('../src/lib/behaviorAnalytics.js', import.meta.url), 'utf8');
const browserModule = await import(asModule(`
  import { isPrivateAnalyticsPage } from '${policy}';
  const isBrowserAnalyticsDisabled = () => false;
  let identity = async () => ({ collect: false, token: 'admin-test' });
  export const setIdentity = value => { identity = value; };
  const getAnalyticsIdentity = () => identity();
` + withoutImports(behavior)));

const settle = () => new Promise(resolve => setImmediate(resolve));

test('browser: admin refresh, homepage entry, progress, engagement and clicks emit no events or IDs', async () => {
  const dom = new JSDOM('', { url: 'https://www.yuqi.site/' });
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const requests = [];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.fetch = async (...args) => { requests.push(args); return { ok: true }; };
  try {
    browserModule.setIdentity(async () => ({ collect: false, token: 'admin-test' }));
    for (const path of ['/', '/admin', '/admin/visitors', '/admin/login', '/admin/callback', '/oauth/consent', '/']) {
      dom.reconfigure({ url: `https://www.yuqi.site${path}` });
      const cleanup = browserModule.startPageBehaviorTracking(path);
      browserModule.trackBehavior('read_progress', { page: path, properties: { progressPercent: 100 } });
      browserModule.trackBehavior('engaged_time', { page: path, properties: { engagedSeconds: 100 } });
      await browserModule.trackClick('social-link', 'https://github.com/example');
      cleanup();
      await settle();
    }
    assert.equal(requests.length, 0);
    assert.equal(dom.window.document.cookie, '');
    assert.equal(dom.window.sessionStorage.length, 0);
  } finally { Object.assign(globalThis, original); dom.window.close(); }
});

test('browser: anonymous/viewer traffic is preserved and pending homepage events are discarded on admin entry', async () => {
  const dom = new JSDOM('', { url: 'https://www.yuqi.site/' });
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const requests = [];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.fetch = async (url, options) => { requests.push({ url, ...options, body: JSON.parse(options.body) }); return { ok: true }; };
  try {
    browserModule.setIdentity(async () => ({ collect: true, token: '' }));
    const cleanup = browserModule.startPageBehaviorTracking('/');
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.event, 'page_view');
    assert.equal(requests[0].body.page, '/');
    assert.ok(requests[0].body.sessionId);
    cleanup({ discard: true });
    browserModule.setIdentity(async () => ({ collect: true, token: 'ordinary-viewer' }));
    await browserModule.trackClick('social-link', 'https://github.com/example');
    assert.equal(requests[1].headers.Authorization, 'Bearer ordinary-viewer');
    assert.equal(requests[1].body.page, '/');
    assert.equal(await browserModule.trackClick('nav-link', '/admin'), false);

    let resolve;
    browserModule.setIdentity(() => new Promise(done => { resolve = done; }));
    const discard = browserModule.startPageBehaviorTracking('/');
    discard({ discard: true });
    // The router has not changed window.location yet: cancellation still wins.
    resolve({ collect: true, token: '' });
    await settle();
    assert.equal(requests.length, 2);
    dom.reconfigure({ url: 'https://www.yuqi.site/admin/visitors' });
    browserModule.startPageBehaviorTracking('/admin/visitors')();
    await settle();
    assert.equal(requests.length, 2);
  } finally { Object.assign(globalThis, original); dom.window.close(); }
});

const requestPolicySource = await readFile(new URL('../src/lib/analyticsRequestPolicy.js', import.meta.url), 'utf8');
const serverPolicy = asModule(`
  const requireSupabaseUser = async (req, res) => {
    if (req.testAuthError) { res.status(req.testAuthError).json({ error: 'verification_failed' }); return null; }
    return { roles: req.testRoles || 'VIEWER' };
  };
` + withoutImports(requestPolicySource));
const response = () => ({ statusCode: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, end() {}, json(value) { this.body = value; } });

test('ingestion: admin mislabeled as homepage is rejected before Kafka, storage or rate limit; viewers still count', async () => {
  for (const endpoint of ['track', 'click']) {
    const source = await readFile(new URL(`../pages/api/${endpoint}.js`, import.meta.url), 'utf8');
    const module = await import(asModule(`
      import crypto from 'node:crypto';
      import { isPrivateAnalyticsEvent } from '${policy}';
      import { allowAnalyticsRequest } from '${serverPolicy}';
      const isLocalAnalyticsRequest = () => false;
      const isLocalAnalyticsEvent = () => false;
      export const calls = { rate: 0, kafka: 0 };
      const isRateLimited = async () => { calls.rate++; return false; };
      const produceRawEvent = async () => { calls.kafka++; return true; };
      const supabaseServer = { from() { throw new Error('Storage must not run'); } };
      const uuidv7 = () => 'synthetic-event';
    ` + withoutImports(source)));
    const request = { method: 'POST', headers: { origin: 'https://www.yuqi.site', 'user-agent': 'Mozilla/5.0', authorization: 'Bearer synthetic' },
      body: { page: '/', event: 'page_view', clickEvent: 'social-link', targetUrl: '/blogs' } };
    for (const testRoles of ['ADMIN', 'EDITOR,PUBLISHER,ADMIN', 'EDITOR', 'PUBLISHER']) {
      const res = response();
      await module.default({ ...request, testRoles }, res);
      assert.equal(res.statusCode, 204, `${endpoint} ${testRoles}`);
    }
    for (const testAuthError of [401, 503]) {
      const res = response();
      await module.default({ ...request, testAuthError }, res);
      assert.equal(res.statusCode, testAuthError);
    }
    assert.deepEqual(module.calls, { rate: 0, kafka: 0 });
    const res = response();
    await module.default({ ...request, testRoles: 'VIEWER' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(module.calls.kafka, 1);
  }
});

test('participation endpoint returns no PII or persisted role and never caches per-user decisions', async () => {
  const source = await readFile(new URL('../pages/api/analytics/participation.js', import.meta.url), 'utf8');
  const module = await import(asModule(`
    import { isAnalyticsOperator } from '${serverPolicy}';
    const requireSupabaseUser = async req => ({ roles: req.testRoles });
  ` + withoutImports(source)));
  for (const [authorization, testRoles, expected] of [['Bearer test', 'ADMIN', false], ['Bearer test', 'VIEWER', true], ['', '', true]]) {
    const res = response();
    await module.default({ method: 'GET', headers: { authorization }, testRoles }, res);
    assert.deepEqual(res.body, { collect: expected });
    assert.match(res.headers['Cache-Control'], /private, no-store/);
  }
});

test('app cancels tracking before private routes complete, including canceled navigations', async () => {
  const source = await readFile(new URL('../pages/_app.js', import.meta.url), 'utf8');
  assert.match(source, /router\.events\.on\("routeChangeStart", handleRouteStart\)/);
  assert.match(source, /cleanupTracking\.current\?\.\(\{ discard: true \}\)/);
  assert.match(source, /recordPageView: false/);
  assert.match(source, /router\.events\.off\("routeChangeError", handleRouteError\)/);
  assert.equal(isPrivateAnalyticsEvent({ page: '/' }, 'https://www.yuqi.site/admin'), true);
});
