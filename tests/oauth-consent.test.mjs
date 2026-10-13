import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationHandoff, consentError, canDecideConsent, oauthClientName } from '../src/lib/oauthConsent.mjs';

test('missing, consumed or expired requests require a new client flow, not another login', () => {
  for (const error of [{ status: 404 }, { message: 'authorization not found' }, { message: 'Authorization request expired' }, { code: 'authorization_expired' }, { code: 'invalid_authorization_id' }]) {
    const result = consentError(error);
    assert.equal(result.restartRequired, true);
    assert.match(result.message, /AI client/);
    assert.match(result.message, /will not renew/);
  }
});

test('temporary failures are retryable and do not expose raw server responses', () => {
  const result = consentError({ status: 503, message: 'internal secret upstream detail' });
  assert.equal(result.restartRequired, false);
  assert.ok(!result.message.includes('secret'));
});

test('decisions require current verified request details and no failure or in-flight action', () => {
  const ready = { details: { authorization_id: 'current' }, authorizationId: 'current', status: '', error: '', decision: '' };
  assert.equal(canDecideConsent(ready), true);
  for (const change of [{ details: null }, { details: {} }, { authorizationId: 'different' }, { status: 'Loading' }, { error: 'expired' }, { decision: 'approve' }, { decision: 'deny' }]) {
    assert.equal(canDecideConsent({ ...ready, ...change }), false);
  }
});

test('approval handoff preserves callback state without implying successful token exchange', () => {
  for (const base of ['http://127.0.0.1:61631', 'http://localhost:8080', 'http://[::1]:8080', 'https://client.example.test']) {
    const redirect_url = `${base}/callback/test?code=test-only-code&state=test-only-state`;
    const result = authorizationHandoff({ redirect_url }, 'Codex');
    assert.equal(result.redirectUrl, redirect_url);
    assert.equal(result.clientName, 'Codex');
    assert.ok(!result.destination.includes('code'));
    assert.equal(result.connected, undefined);
  }
});

test('handoff rejects missing, unsafe and failed callbacks', () => {
  for (const redirect_url of [undefined, '', 'javascript:alert(1)', 'data:text/html,test',
    'http://external.test/callback?code=x', 'https://user:password@client.test/callback?code=x',
    'https://client.test/callback', 'https://client.test/callback?code=x&error=denied']) {
    assert.throws(() => authorizationHandoff({ redirect_url }));
  }
});

test('client names are supplied by OAuth metadata, with a neutral fallback', () => {
  for (const name of ['Codex', 'Claude', 'Cursor', 'A custom MCP client']) {
    const handoff = authorizationHandoff({ redirect_url: 'https://client.test/callback?code=test' }, ` ${name} `);
    assert.equal(handoff.clientName, name);
    assert.equal(oauthClientName(name), name);
  }
  for (const name of [undefined, null, '', '   ', {}, 42]) {
    assert.equal(oauthClientName(name), 'your AI client');
  }
});
