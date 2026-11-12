import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

function fixture(endpoint) {
  const calls = { auth: 0, rate: 0, assessment: 0, kafka: 0, storage: 0 };
  const events = [];
  const source = readFileSync(new URL(`../pages/api/${endpoint}.js`, import.meta.url), 'utf8')
    .replace(/^import .+;\r?$/gm, '').replace(/export const config =/, 'const config =')
    .replace('export default async function handler', 'return async function handler');
  const serve = new Function('crypto', 'process', 'calls', 'events', `
    const isLocalAnalyticsRequest = () => false;
    const isLocalAnalyticsEvent = () => false;
    const isPrivateAnalyticsEvent = () => false;
    const allowAnalyticsRequest = async () => { calls.auth++; return true; };
    const isRateLimited = async () => { calls.rate++; return false; };
    const createRecaptchaAssessment = async () => { calls.assessment++; return { status: 'SKIPPED' }; };
    const assessmentProperties = () => ({});
    const produceRawEvent = async event => { calls.kafka++; events.push(event); return true; };
    const supabaseServer = { from() { calls.storage++; throw new Error('Unexpected database call'); } };
    const uuidv7 = () => 'synthetic-event';
    ${source}
  `)(crypto, { env: { NODE_ENV: 'production' } }, calls, events);
  return { serve, calls, events };
}

function request(headers) {
  return { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.4', ...headers }, socket: {},
    body: { page: '/', event: 'page_view', clickEvent: 'social-link', targetUrl: 'https://github.com/example', consentState: 'granted' } };
}
function response() {
  return { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
}

for (const endpoint of ['track', 'click']) {
  test(`${endpoint}: lookalike or malformed origins never reach ingestion`, async () => {
    const { serve, calls } = fixture(endpoint);
    const denied = [
      'https://www.yuqi.site.attacker.example', 'https://yuqi.site.attacker.example/path',
      'https://www.yuqi.site@attacker.example', 'https://attacker.example@www.yuqi.site',
      'https://www.yuqi.site:444', 'http://www.yuqi.site',
      'https://www.yuqi.site,https://attacker.example', 'blob:https://www.yuqi.site/sample',
      'https://www.yuqi.site\\@attacker.example', 'https://www.yuqi.site\n.attacker.example',
      '//www.yuqi.site', 'not a URL', 'null', '', null, ['https://www.yuqi.site'],
    ];
    for (const value of denied) for (const header of ['origin', 'referer']) {
      const res = response();
      await serve(request({ [header]: value }), res);
      assert.equal(res.statusCode, 403, `${header}: ${JSON.stringify(value)}`);
    }
    assert.deepEqual(calls, { auth: 0, rate: 0, assessment: 0, kafka: 0, storage: 0 });
  });

  test(`${endpoint}: exact production origins and referrers retain one event per accepted request`, async () => {
    const { serve, calls, events } = fixture(endpoint);
    const allowed = [
      { origin: 'https://www.yuqi.site' },
      { origin: 'https://yuqi.site' },
      { origin: 'https://WWW.YUQI.SITE:443' },
      { referer: 'https://www.yuqi.site/blogs?source=sample#section' },
      { referer: 'https://yuqi.site/' },
      { origin: 'https://www.yuqi.site', referer: 'https://external.example/' },
    ];
    for (const [index, headers] of allowed.entries()) {
      const res = response();
      await serve(request(headers), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { ok: true, via: 'kafka', ...(endpoint === 'track' ? { eventId: events[index].eventId } : {}) });
      assert.equal(events.length, index + 1);
      assert.equal(events[index].eventType, endpoint === 'track' ? 'page_view' : 'click');
    }
    assert.equal(calls.kafka, allowed.length);
    assert.equal(calls.rate, allowed.length);
    assert.equal(calls.storage, 0);
    assert.equal(calls.assessment, endpoint === 'track' ? allowed.length : 0);
  });
}
