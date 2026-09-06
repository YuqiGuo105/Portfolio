import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../pages/api/auth/login-policy.js';

function response() {
  return { headers: {}, statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('policy only exposes booleans and does not cache configuration', async () => {
  const previous = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ disable_signup: true, external: { google: true }, unrelated: 'not-for-client' }) });
  try {
    const res = response();
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(res.body, { googleEnabled: true, existingAccountsOnly: true });
  } finally { global.fetch = previous; }
});

test('policy fails closed on upstream failure and rejects writes', async () => {
  const previous = global.fetch;
  global.fetch = async () => { throw new Error('provider failure'); };
  try {
    const res = response();
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'login_policy_unavailable' });
    const write = response();
    await handler({ method: 'POST' }, write);
    assert.equal(write.statusCode, 405);
    assert.equal(write.headers.Allow, 'GET');
  } finally { global.fetch = previous; }
});
