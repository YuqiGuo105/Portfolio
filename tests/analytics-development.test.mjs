import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const hostSource = await readFile(new URL('../src/lib/analyticsHostFilter.js', import.meta.url), 'utf8');
const hostUrl = dataModule(hostSource);
const policyUrl = dataModule(await readFile(new URL('../src/lib/analyticsPagePolicy.mjs', import.meta.url), 'utf8'));
const host = await import(hostUrl);

test('local analytics hostnames and development modes are excluded', () => {
  for (const name of ['localhost', 'app.localhost', '127.0.0.1', '127.2.3.4', '[::1]', '0.0.0.0', '192.168.1.20', '10.0.0.8', '172.16.1.2', '172.31.1.2', 'portfolio.local', 'portfolio.test']) {
    assert.equal(host.isLocalAnalyticsHostname(name), true, name);
  }
  for (const name of ['www.yuqi.site', 'yuqi.site', '172.32.0.1', '192.169.1.1', '10.999.0.1', 'localhost.example.com']) {
    assert.equal(host.isLocalAnalyticsHostname(name), false, name);
  }
  assert.equal(host.isDevelopmentAnalyticsRuntime('development'), true);
  assert.equal(host.isDevelopmentAnalyticsRuntime('test'), true);
  assert.equal(host.isDevelopmentAnalyticsRuntime('production'), false);
});

test('track and click skip local events before rate limiting, Kafka or Supabase', async () => {
  const oldEnv = process.env.NODE_ENV;
  try {
    for (const endpoint of ['track', 'click']) {
      const source = await readFile(new URL(`../pages/api/${endpoint}.js`, import.meta.url), 'utf8');
      const prefix = `
        import crypto from 'node:crypto';
        import { isLocalAnalyticsRequest, isLocalAnalyticsEvent } from '${hostUrl}';
        import { isPrivateAnalyticsEvent } from '${policyUrl}';
        export const calls = { rate: 0, kafka: 0, storage: 0 };
        const isRateLimited = async () => { calls.rate++; return false; };
        const produceRawEvent = async () => { calls.kafka++; return true; };
        const supabaseServer = { from() { calls.storage++; throw new Error('Storage must not run'); } };
        const uuidv7 = () => 'fixture-event';
      `;
      const module = await import(dataModule(prefix + source.replace(/^import .+;\r?$/gm, '')));
      const productionHeaders = { host: 'www.yuqi.site', origin: 'https://www.yuqi.site', 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.1' };
      const cases = [
        ['development', {}, {}], ['test', {}, {}],
        ['production', { host: 'localhost:3064' }, {}],
        ['production', { host: '[::1]:3064' }, {}],
        ['production', { host: '192.168.1.20:3064' }, {}],
        ['production', { origin: 'http://localhost:3066' }, {}],
        ['production', { referer: 'http://10.0.0.8:3066/' }, {}],
        ['production', { 'x-forwarded-host': 'portfolio.local:3066' }, {}],
        ['production', {}, { page: 'http://localhost:3066/' }],
        ['production', {}, { pageUrl: 'http://192.168.1.20:3066/blogs' }],
      ];
      for (const [env, headers, body] of cases) {
        process.env.NODE_ENV = env;
        const res = { statusCode: null, status(code) { this.statusCode = code; return this; }, end() {}, json() {} };
        await module.default({ method: 'POST', headers: { ...productionHeaders, ...headers }, body }, res);
        assert.equal(res.statusCode, 204, `${endpoint}: ${env} ${JSON.stringify(headers)} ${JSON.stringify(body)}`);
      }
      assert.deepEqual(module.calls, { rate: 0, kafka: 0, storage: 0 });
      process.env.NODE_ENV = 'production';
      const res = { statusCode: null, status(code) { this.statusCode = code; return this; }, json() {}, end() {} };
      await module.default({ method: 'POST', headers: productionHeaders, socket: { remoteAddress: '127.0.0.1' }, body: {
        page: '/', event: 'page_view', clickEvent: 'social-link', targetUrl: 'https://github.com/',
      } }, res);
      assert.equal(res.statusCode, 200, 'real visitors behind a loopback proxy remain counted');
      assert.deepEqual(module.calls, { rate: 1, kafka: 1, storage: 0 });
    }
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
  }
});

test('browser development tracking creates no identifiers, listeners or network requests', async () => {
  const source = await readFile(new URL('../src/lib/behaviorAnalytics.js', import.meta.url), 'utf8');
  const module = await import(dataModule(source.replace('"./analyticsHostFilter"', JSON.stringify(hostUrl)).replace('"./analyticsPagePolicy.mjs"', JSON.stringify(policyUrl))));
  const oldEnv = process.env.NODE_ENV;
  const oldWindow = globalThis.window;
  try {
    for (const [env, hostname] of [['development', 'www.yuqi.site'], ['test', 'www.yuqi.site'], ['production', 'localhost'], ['production', '192.168.1.20']]) {
      process.env.NODE_ENV = env;
      globalThis.window = { location: { hostname, href: `http://${hostname}/` } };
      assert.equal(module.trackBehavior('page_view'), false);
      assert.doesNotThrow(() => module.startPageBehaviorTracking('/')());
    }
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});
