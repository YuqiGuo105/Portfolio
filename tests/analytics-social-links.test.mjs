import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { publicOutboundTarget } from '../src/lib/analyticsPagePolicy.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stripImports = source => source.replace(/^import .+;\r?$/gm, '');
const policy = asModule(await read('../src/lib/analyticsPagePolicy.mjs'));
const host = asModule(await read('../src/lib/analyticsHostFilter.js'));
const behavior = await import(asModule((await read('../src/lib/behaviorAnalytics.js'))
  .replace('"./analyticsHostFilter"', JSON.stringify(host))
  .replace('"./analyticsPagePolicy.mjs"', JSON.stringify(policy))));

const dom = new JSDOM('<div id="root"></div>', { url: 'https://www.yuqi.site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require('react'), { createRoot } = require('react-dom/client'), { act } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const profiles = [
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/example/?utm_source=portfolio#profile' },
  { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/example/' },
];
const { code } = await transform(await read('../src/components/SocialLinks.js'), {
  filename: 'SocialLinks.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name.endsWith('.css')) return { __esModule: true, default: {} };
  if (name.endsWith('socialProfiles.mjs')) return { socialProfiles: profiles };
  if (name.endsWith('behaviorAnalytics')) return behavior;
  return require(name);
}, exports);

let root, requests;
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.NODE_ENV = 'production';
  delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  dom.reconfigure({ url: 'https://www.yuqi.site/' });
  window.localStorage.clear(); window.sessionStorage.clear();
  document.cookie = 'yuqi_analytics_id=; Max-Age=0; Path=/; Secure';
  requests = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, ...options, body });
    return { ok: true, status: 200, json: async () => ({ ok: true, eventId: body.eventId }) };
  };
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => {
  await act(() => root.unmount());
  for (const key of ['NODE_ENV', 'NEXT_PUBLIC_RECAPTCHA_SITE_KEY', 'ANALYTICS_INGEST_HMAC_KEY']) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
  globalThis.fetch = originalFetch;
});
after(() => dom.window.close());
const render = async placement => act(() => root.render(React.createElement(exports.default, { placement })));
const click = async (selector = 'a', type = 'click', button = 0) => {
  const event = new window.MouseEvent(type, { button, bubbles: true, cancelable: true });
  await act(() => document.querySelector(selector).dispatchEvent(event));
  assert.equal(event.defaultPrevented, false, 'analytics must not delay or intercept navigation');
};

test('all three placements emit one v2 event with the page-view session and full public destination', async () => {
  behavior.trackBehavior('page_view');
  const pageView = requests[0].body;
  for (const placement of ['home-intro', 'navigation-menu', 'footer']) {
    await render(placement);
    for (const profile of profiles) {
      const before = requests.length;
      await click(`a[aria-label^="${profile.label}"]`);
      assert.equal(requests.length, before + 1);
      const request = requests.at(-1), event = request.body;
      assert.equal(request.url, '/api/track');
      assert.equal(request.keepalive, true);
      assert.equal(event.schemaVersion, 2);
      assert.equal(event.event, 'outbound_link_clicked');
      assert.equal(event.page, '/');
      assert.equal(event.sessionId, pageView.sessionId);
      assert.equal(event.anonymousId, pageView.anonymousId);
      assert.equal(event.target, publicOutboundTarget(profile.url));
      assert.deepEqual(event.properties, { component: placement, action: profile.id });
      assert.equal(request.headers.Authorization, undefined);
    }
  }
  assert.equal(requests.length, 7);
});

test('middle-click is recorded once; right-click is not recorded as a visit', async () => {
  await render('footer');
  await click('a', 'auxclick', 1);
  assert.equal(requests.length, 1);
  await click('a', 'auxclick', 2);
  assert.equal(requests.length, 1);
});

test('private routes, localhost, opt-out and browser privacy signals remain excluded', async () => {
  await render('footer');
  for (const url of ['https://www.yuqi.site/admin/visitors', 'http://localhost:3140/']) {
    dom.reconfigure({ url });
    await click();
    assert.equal(window.sessionStorage.length, 0);
  }
  dom.reconfigure({ url: 'https://www.yuqi.site/' });
  behavior.setAnalyticsConsent('denied'); await click();
  behavior.setAnalyticsConsent('granted');
  Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true }); await click();
  delete navigator.doNotTrack;
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true }); await click();
  delete navigator.globalPrivacyControl;
  assert.equal(requests.length, 0);
});

test('network failure never cancels an external link while delivery waits for retry', async () => {
  globalThis.fetch = async () => { throw new Error('Offline'); };
  await render('footer');
  await click();
  behavior.setAnalyticsConsent('denied');
});

test('outbound URLs keep host/path but reject credentials, unsafe schemes and invalid targets', () => {
  assert.equal(publicOutboundTarget('https://www.linkedin.com/in/example/?token=private#section'), 'https://www.linkedin.com/in/example/');
  for (const target of [null, {}, '', '/blogs', 'javascript:alert(1)', 'data:text/plain,test', 'https://user:secret@example.com/', 'https://example.com/' + 'a'.repeat(2048)]) {
    assert.equal(publicOutboundTarget(target), null);
    assert.equal(behavior.trackBehavior('outbound_link_clicked', { target }), false);
  }
  assert.equal(requests.length, 0);
});

const ingestion = await import(asModule(`
  import crypto from 'node:crypto';
  import { isPrivateAnalyticsEvent, publicOutboundTarget } from '${policy}';
  export const events = [];
  export let available = true;
  export const setAvailable = value => { available = value; };
  const produceRawEvent = async event => { if (!available) return false; events.push(event); return true; };
  const isLocalAnalyticsRequest = () => false;
  const isLocalAnalyticsEvent = () => false;
  const allowAnalyticsRequest = async () => true;
  const isRateLimited = async () => false;
  const createRecaptchaAssessment = async () => ({ status: 'SKIPPED' });
  const assessmentProperties = () => ({});
  const supabaseServer = { from() { throw new Error('Outbound clicks must not go to the legacy fallback'); } };
  const uuidv7 = () => crypto.randomUUID();
  ${stripImports(await read('../pages/api/track.js'))}
`));
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; }, end() {} });
async function ingest(body) {
  const res = response();
  await ingestion.default({ method: 'POST', headers: { origin: 'https://www.yuqi.site', 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.1' }, socket: {}, body }, res);
  return res;
}

test('browser-to-ingestion contract preserves session identity and destination for the admin timeline', async () => {
  process.env.ANALYTICS_INGEST_HMAC_KEY = 'test-only-hmac-key';
  behavior.trackBehavior('page_view');
  await render('footer'); await click('a[aria-label^="LinkedIn"]');
  for (const request of requests) assert.equal((await ingest(request.body)).statusCode, 200);
  const [view, clickEvent] = ingestion.events.slice(-2);
  assert.equal(clickEvent.eventType, 'outbound_link_clicked');
  assert.equal(clickEvent.schemaVersion, 2);
  assert.equal(clickEvent.sessionId, view.sessionId);
  assert.notEqual(clickEvent.sessionId, requests[0].body.sessionId, 'server-side pseudonymization is retained');
  assert.equal(clickEvent.anonId, view.anonId);
  assert.equal(clickEvent.targetUrl, 'https://www.linkedin.com/in/example/');
  assert.deepEqual(clickEvent.properties, { component: 'footer', action: 'linkedin' });
});

test('ingestion independently strips query tokens and rejects malformed outbound events', async () => {
  const event = { event: 'outbound_link_clicked', page: '/', target: 'https://www.instagram.com/example/?token=private#profile' };
  assert.equal((await ingest(event)).statusCode, 200);
  assert.equal(ingestion.events.at(-1).targetUrl, 'https://www.instagram.com/example/');
  const before = ingestion.events.length;
  for (const target of ['', 'javascript:alert(1)', 'https://user:secret@example.com/']) {
    assert.equal((await ingest({ ...event, target })).statusCode, 400);
  }
  assert.equal(ingestion.events.length, before);
});

test('Kafka outage is not falsely acknowledged through a legacy table invisible to the admin panel', async () => {
  ingestion.setAvailable(false);
  try {
    const res = await ingest({ event: 'outbound_link_clicked', page: '/', target: profiles[1].url });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.ok, false);
  } finally { ingestion.setAvailable(true); }
});

test('homepage, menu and footer use the shared collector without legacy duplicate callbacks', async () => {
  for (const [file, placement] of [['../pages/index.js', 'home-intro'], ['../src/layout/Header.js', 'navigation-menu'], ['../src/layout/Footer.js', 'footer']]) {
    const source = await read(file);
    assert.match(source, new RegExp(`<SocialLinks[^>]*placement="${placement}"`));
    assert.doesNotMatch(source, /<SocialLinks[^>]*onVisit=/);
  }
});

test('the open full-screen menu keeps its social links clear of the chat portal', async () => {
  const css = await read('../src/layout/Header.module.css');
  assert.match(css, /:has\(\.header :global\(\.menu-full-overlay\.visible\)\) :global\(#__chat_widget_root\)\s*\{\s*visibility: hidden;/);
});
