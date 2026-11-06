import test from 'node:test';
import assert from 'node:assert/strict';
import { contactFields, contactIdentity, contactIp, createContactHandler, verifyContactToken } from '../src/lib/contactGuard.mjs';

const env = { NODE_ENV: 'production', CONTACT_MCP_TOKEN: 'test-service-credential-'.repeat(3), TURNSTILE_SECRET_KEY: 'test-server-secret' };
const tokenResult = extra => ({ success: true, hostname: 'www.yuqi.site', action: 'contact_submit', challenge_ts: new Date().toISOString(), ...extra });
const request = () => ({ method: 'POST', headers: { origin: 'https://www.yuqi.site', 'content-type': 'application/json' },
  socket: { remoteAddress: '203.0.113.7' }, body: { name: 'Visitor', email: 'visitor@example.com', message: 'Hello, can we discuss a role?', turnstileToken: 'valid-token' } });
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });

function fixture(options = {}) {
  const deliveries = [], logs = [], checks = [];
  const handler = createContactHandler({ env, isRateLimited: async (...args) => { checks.push(args); return false; },
    fetchImpl: async () => Response.json(tokenResult()), sendMail: async fields => { deliveries.push(fields); },
    audit: entry => logs.push(entry), ...options });
  return { handler, deliveries, logs, checks };
}

test('valid browser submission is verified before email; logs contain no PII or tokens', async () => {
  let verified = false;
  const f = fixture({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { secret: env.TURNSTILE_SECRET_KEY, response: 'valid-token' });
    verified = true; return Response.json(tokenResult());
  } });
  const res = response(); await f.handler(request(), res);
  assert.equal(verified, true); assert.equal(res.statusCode, 200); assert.equal(f.deliveries.length, 1);
  assert.deepEqual(Object.keys(f.deliveries[0]).sort(), ['email', 'message', 'name']);
  assert.equal(f.logs[0].source, 'web'); assert.equal(f.logs[0].outcome, 'sent');
  assert.equal(res.headers['Cache-Control'], 'no-store'); assert.ok(res.body.requestId);
  for (const secret of ['visitor@example.com', '203.0.113.7', 'valid-token', env.TURNSTILE_SECRET_KEY]) {
    assert.equal(JSON.stringify(f.logs).includes(secret), false);
  }
});

for (const [label, change, status] of [
  ['missing token', req => { delete req.body.turnstileToken; }, 403],
  ['source=mcp does not bypass', req => { req.body.source = 'mcp'; delete req.body.turnstileToken; }, 403],
  ['forged header', req => { req.headers['x-portfolio-contact-token'] = 'pretend-mcp'; }, 401],
  ['array header', req => { req.headers['x-portfolio-contact-token'] = [env.CONTACT_MCP_TOKEN]; }, 401],
  ['empty credential header', req => { req.headers['x-portfolio-contact-token'] = ''; }, 401],
  ['origin prefix attack', req => { req.headers.origin = 'https://www.yuqi.site.evil.example'; }, 403],
  ['missing origin', req => { delete req.headers.origin; }, 403],
  ['cross-site request', req => { req.headers['sec-fetch-site'] = 'cross-site'; }, 403],
  ['honeypot', req => { req.body.website = 'https://spam.example'; }, 403],
  ['bad email', req => { req.body.email = 'not-an-email'; }, 400],
  ['header injection name', req => { req.body.name = 'Hi\r\nBcc: other@example.com'; }, 400],
  ['too long', req => { req.body.message = 'x'.repeat(5001); }, 400],
  ['blank message', req => { req.body.message = '  '; }, 400],
  ['array body', req => { req.body = []; }, 400],
  ['unsupported encoding', req => { req.headers['content-type'] = 'text/plain'; }, 415],
  ['GET', req => { req.method = 'GET'; }, 405],
]) test(`rejects ${label} without a provider call or email`, async () => {
  let verified = false;
  const f = fixture({ fetchImpl: async () => { verified = true; return Response.json(tokenResult()); } });
  const req = request(); change(req); const res = response(); await f.handler(req, res);
  assert.equal(res.statusCode, status); assert.equal(verified, false); assert.equal(f.deliveries.length, 0);
});

test('authenticated MCP skips Turnstile, not the rate limit', async () => {
  const f = fixture({ fetchImpl: () => { throw new Error('MCP must not call Turnstile'); } });
  const req = request(); req.headers = { 'x-portfolio-contact-token': env.CONTACT_MCP_TOKEN, 'content-type': 'application/json' };
  delete req.body.turnstileToken;
  const res = response(); await f.handler(req, res);
  assert.equal(res.statusCode, 200); assert.equal(f.deliveries.length, 1);
  assert.equal(f.checks[0][0], 'trusted-gateway'); assert.equal(f.checks[0][1], 'contact-mcp');
  assert.equal(f.logs[0].source, 'mcp');
  const limited = fixture({ isRateLimited: async () => true }); const retry = response();
  await limited.handler(req, retry); assert.equal(retry.statusCode, 429); assert.equal(limited.deliveries.length, 0);
});

test('missing/weak MCP server credential cannot enable bypass', () => {
  for (const secret of ['', 'short']) {
    const req = request(); req.headers['x-portfolio-contact-token'] = secret || 'anything';
    assert.throws(() => contactIdentity(req, { ...env, CONTACT_MCP_TOKEN: secret }), { code: 'invalid_service_credential' });
  }
});

for (const [label, patch] of [
  ['failure', { success: false }], ['replay', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
  ['wrong action', { action: 'page_view' }], ['wrong hostname', { hostname: 'evil.example' }],
  ['no timestamp', { challenge_ts: undefined }], ['expired', { challenge_ts: '2020-01-01T00:00:00Z' }],
  ['future timestamp', { challenge_ts: '2099-01-01T00:00:00Z' }],
]) test(`rejects Turnstile ${label}`, async () => {
  const f = fixture({ fetchImpl: async () => Response.json(tokenResult(patch)) });
  const res = response(); await f.handler(request(), res);
  assert.equal(res.statusCode, 403); assert.equal(f.deliveries.length, 0);
});

test('provider outage, malformed response and configuration errors fail closed', async () => {
  for (const options of [
    { env: { ...env, TURNSTILE_SECRET_KEY: '' } },
    { env: { ...env, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' } },
    { fetchImpl: async () => { throw new Error('secret provider details'); } },
    { fetchImpl: async () => new Response('', { status: 503 }) },
    { fetchImpl: async () => new Response('not-json') },
    { fetchImpl: async () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }) },
  ]) {
    const f = fixture(options); const res = response(); await f.handler(request(), res);
    assert.equal(res.statusCode, 503); assert.equal(f.deliveries.length, 0);
    assert.equal(res.body.code, 'verification_unavailable');
    assert.equal(JSON.stringify(f.logs).includes('secret provider details'), false);
  }
});

test('provider timeout aborts instead of leaving a sending request open', async () => {
  await assert.rejects(verifyContactToken('token', { env, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) }), { code: 'verification_unavailable' });
});

test('browser rate limit is checked before verification with a retry hint', async () => {
  const f = fixture({ isRateLimited: async () => true, fetchImpl: () => { throw new Error('not reached'); } });
  const res = response(); await f.handler(request(), res);
  assert.equal(res.statusCode, 429); assert.equal(res.headers['Retry-After'], '600'); assert.equal(f.deliveries.length, 0);
});

test('SMTP failures never leak error text or trigger automatic retries', async () => {
  let sends = 0;
  const f = fixture({ sendMail: async () => { sends++; throw new Error('SMTP secret and recipient details'); } });
  const res = response(); await f.handler(request(), res);
  assert.equal(res.statusCode, 503); assert.equal(sends, 1);
  assert.equal(JSON.stringify({ body: res.body, logs: f.logs }).includes('SMTP secret'), false);
});

test('audit failures cannot turn a delivered email into a retryable failure', async () => {
  const f = fixture({ audit: () => { throw new Error('log sink unavailable'); } });
  const res = response(); await f.handler(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(f.deliveries.length, 1);
});

test('short multilingual messages and dotted Gmail addresses are not spam rules', () => {
  for (const message of ['Hi!', '你好，想聊一下岗位。', 'Bonjour']) {
    assert.equal(contactFields({ email: 'a.b.c@gmail.com', message }).message, message);
  }
});

test('development origins are loopback-only and cannot affect production', () => {
  const req = request(); req.headers.origin = 'http://localhost:3132'; req.headers.host = 'localhost:3132';
  assert.equal(contactIdentity(req, { NODE_ENV: 'development' }), 'web');
  assert.throws(() => contactIdentity(req, env), { code: 'invalid_origin' });
});

test('IP source is normalized and untrusted proxy headers are ignored off Vercel', () => {
  const req = request(); req.headers['x-forwarded-for'] = '1.1.1.1';
  assert.equal(contactIp(req, {}), '203.0.113.7');
  req.headers['x-vercel-forwarded-for'] = '203.0.113.8';
  assert.equal(contactIp(req, { VERCEL: '1' }), '203.0.113.8');
  req.headers['x-vercel-forwarded-for'] = 'bad'; assert.equal(contactIp(req, { VERCEL: '1' }), 'unknown');
});
