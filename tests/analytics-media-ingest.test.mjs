import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MEDIA_EVENTS, MEDIA_PROPERTIES } from '../src/lib/media/telemetry.mjs';

const source = await readFile(new URL('../pages/api/track.js', import.meta.url), 'utf8');
const module = await import(`data:text/javascript;base64,${Buffer.from(`
  import crypto from 'node:crypto';
  export let captured, rate;
  const supabaseServer = {};
  const uuidv7 = () => 'event-fallback';
  const isLocalAnalyticsRequest = () => false, isLocalAnalyticsEvent = () => false, isPrivateAnalyticsEvent = () => false;
  const allowAnalyticsRequest = async () => true;
  const isRateLimited = async (key, scope, options) => { rate = { key, scope, options }; return false; };
  const createRecaptchaAssessment = async () => { throw new Error('Paid assessment was called'); };
  const assessmentProperties = () => { throw new Error('Should not invent an assessment'); };
  const produceRawEvent = async event => { captured = event; return true; };
  ${source.replace(/^import .+;\r?$/gm, '')}
`).toString('base64')}`);

test('media/widget events skip paid assessment and preserve retry IDs without trusting bot fields', async () => {
  for (const name of [...MEDIA_EVENTS, 'widget_opened', 'widget_action']) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; }, end() {} };
    const request = { method: 'POST', headers: { origin: 'https://www.yuqi.site', 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '192.0.2.1' },
      body: { event: name, eventId: 'stable-event-123456', page: '/', consentState: 'granted', anonymousId: 'anonymous-12345', sessionId: 'session-123456',
        recaptchaToken: 'forged-token', properties: { mediaId: 'asset', watchedSeconds: 12, caption: 'secret', signedUrl: 'secret', botAssessmentHumanScore: 1, stallMs: Infinity } } };
    await module.default(request, res);
    assert.equal(res.code, 200); assert.equal(module.captured.properties.mediaId, 'asset');
    assert.equal(module.captured.properties.botAssessmentStatus, 'NOT_REQUESTED_COST_POLICY');
    for (const field of ['caption', 'signedUrl', 'botAssessmentHumanScore', 'stallMs']) assert.equal(module.captured.properties[field], undefined);
    const identity = module.captured.eventId; await module.default(request, res);
    assert.equal(identity, module.captured.eventId); assert.equal(module.rate.options.limit, 30);
    assert.equal(module.rate.scope, 'ui-telemetry'); assert.equal(module.rate.key, '192.0.2.1');
  }
});
test('browser and server accept media schema without per-click CAPTCHA', async () => {
  const browser = await readFile(new URL('../src/lib/behaviorAnalytics.js', import.meta.url), 'utf8');
  for (const name of MEDIA_EVENTS) { assert.ok(source.includes(`'${name}'`)); assert.ok(browser.includes(`"${name}"`)); }
  for (const property of MEDIA_PROPERTIES) assert.ok(source.includes(`'${property}'`));
  assert.match(browser, /media_\|widget_/);
});
