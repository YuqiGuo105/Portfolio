import test from 'node:test';
import assert from 'node:assert/strict';
import { consentError, canDecideConsent } from '../src/lib/oauthConsent.mjs';

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
