import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assessmentProperties,
  createRecaptchaAssessment,
} from '../src/lib/recaptchaAssessment.mjs';

const config = {
  RECAPTCHA_PROJECT_ID: 'portfolio-test',
  RECAPTCHA_API_KEY: 'server-secret',
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: 'public-site-key',
  RECAPTCHA_ALLOWED_HOSTS: 'yuqi.site,www.yuqi.site',
};

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('assessment is disabled without complete server configuration', async () => {
  let called = false;
  const result = await createRecaptchaAssessment({
    token: 'x'.repeat(30), expectedAction: 'page_view', env: {},
    fetchImpl: async () => { called = true; },
  });
  assert.deepEqual(result, { status: 'SKIPPED' });
  assert.equal(called, false);
});

test('valid Google response is bound to token action and hostname', async () => {
  let request;
  const result = await createRecaptchaAssessment({
    token: 'token-'.repeat(8), expectedAction: 'page_view',
    userAgent: 'Mozilla/5.0', userIpAddress: '203.0.113.9', env: config,
    fetchImpl: async (url, options) => {
      request = { url, ...options, body: JSON.parse(options.body) };
      return response({
        tokenProperties: { valid: true, action: 'page_view', hostname: 'www.yuqi.site' },
        riskAnalysis: { score: 0.9, reasons: ['LOW_CONFIDENCE_SCORE'] },
      });
    },
  });

  assert.equal(result.status, 'VALID');
  assert.equal(result.humanScore, 0.9);
  assert.match(request.url, /projects\/portfolio-test\/assessments\?key=server-secret$/);
  assert.equal(request.body.event.expectedAction, 'page_view');
  assert.equal(request.body.event.siteKey, 'public-site-key');
  assert.equal(request.body.event.userIpAddress, '203.0.113.9');
  assert.deepEqual(assessmentProperties(result), {
    botAssessmentProvider: 'GOOGLE_RECAPTCHA_ENTERPRISE',
    botAssessmentStatus: 'VALID',
    botAssessmentHumanScore: 0.9,
    botAssessmentReasons: 'LOW_CONFIDENCE_SCORE',
  });
});

test('action and hostname mismatches never produce a trusted score', async () => {
  for (const [tokenProperties, expected] of [
    [{ valid: true, action: 'login', hostname: 'www.yuqi.site' }, 'ACTION_MISMATCH'],
    [{ valid: true, action: 'page_view', hostname: 'attacker.example' }, 'HOSTNAME_MISMATCH'],
  ]) {
    const result = await createRecaptchaAssessment({
      token: 'token-'.repeat(8), expectedAction: 'page_view', env: config,
      fetchImpl: async () => response({ tokenProperties, riskAnalysis: { score: 1 } }),
    });
    assert.equal(result.status, expected);
    assert.equal('humanScore' in result, false);
  }
});

test('provider errors fail open without inventing a score', async () => {
  for (const fetchImpl of [
    async () => response({}, 503),
    async () => { throw new Error('offline'); },
  ]) {
    const result = await createRecaptchaAssessment({
      token: 'token-'.repeat(8), expectedAction: 'page_view', env: config, fetchImpl,
    });
    assert.match(result.status, /PROVIDER_ERROR|PROVIDER_UNAVAILABLE/);
    assert.equal('humanScore' in assessmentProperties(result), false);
  }
});

test('track endpoint ignores forged bot scores and adds only server assessment data', async () => {
  const source = await readFile(new URL('../pages/api/track.js', import.meta.url), 'utf8');
  const stripped = source.replace(/^import .+;\r?$/gm, '');
  const module = await import(`data:text/javascript;base64,${Buffer.from(`
    import crypto from 'node:crypto';
    export let captured;
    const supabaseServer = {};
    const uuidv7 = () => 'evt-recaptcha';
    const isLocalAnalyticsRequest = () => false;
    const isLocalAnalyticsEvent = () => false;
    const isPrivateAnalyticsEvent = () => false;
    const allowAnalyticsRequest = async () => true;
    const isRateLimited = async () => false;
    const createRecaptchaAssessment = async () => ({ status: 'VALID', humanScore: 0.92 });
    const assessmentProperties = () => ({
      botAssessmentProvider: 'GOOGLE_RECAPTCHA_ENTERPRISE',
      botAssessmentStatus: 'VALID',
      botAssessmentHumanScore: 0.92,
    });
    const produceRawEvent = async event => { captured = event; return true; };
    ${stripped}
  `).toString('base64')}`);
  const res = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end() {} };
  await module.default({
    method: 'POST',
    headers: { origin: 'https://www.yuqi.site', 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.4' },
    socket: {},
    body: {
      event: 'page_view', page: '/', consentState: 'granted',
      sessionId: 'session-1234567890', anonymousId: 'anonymous-123456',
      properties: {
        component: 'home',
        botAssessmentHumanScore: 0,
        botAssessmentVerifiedBot: true,
      },
      recaptchaToken: 'token-'.repeat(8),
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(module.captured.properties.component, 'home');
  assert.equal(module.captured.properties.botAssessmentHumanScore, 0.92);
  assert.equal(module.captured.properties.botAssessmentVerifiedBot, undefined);
});
