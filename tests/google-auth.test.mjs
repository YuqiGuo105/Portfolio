import test from 'node:test';
import assert from 'node:assert/strict';
import { completeGoogleLogin, googleLoginOptions, safeLoginRedirect, startGoogleLogin, googleAuthError } from '../src/lib/googleAuth.mjs';

test('redirects only to same-origin paths and avoids callback loops', () => {
  for (const target of ['https://evil.test', '//evil.test', '/\\evil.test', '/%5cevil.test', '/%2fevil.test', '/%0aevil.test', '/\nevil.test', '/auth/callback', '/admin/callback', ['x']]) {
    assert.equal(safeLoginRedirect(target, '/admin'), '/admin');
  }
  assert.equal(safeLoginRedirect('/life-blog/2?view=full#article'), '/life-blog/2?view=full#article');
  assert.match(googleLoginOptions('https://www.yuqi.site', '/oauth/consent?id=abc', true).options.redirectTo, /^https:\/\/www.yuqi.site\/admin\/callback\?redirect=/);
});

test('Google cannot start when registration is enabled or policy is unavailable', async () => {
  let calls = 0;
  const client = { auth: { signInWithOAuth: async () => { calls++; return {}; } } };
  for (const policy of [{ googleEnabled: true, existingAccountsOnly: false }, {}, { googleEnabled: false, existingAccountsOnly: true }]) {
    await assert.rejects(startGoogleLogin(client, { origin: 'https://www.yuqi.site', fetcher: async () => ({ ok: true, json: async () => policy }) }));
  }
  await assert.rejects(startGoogleLogin(client, { origin: 'https://www.yuqi.site', fetcher: async () => ({ ok: false }) }));
  assert.equal(calls, 0);
});

test('Google starts only under an existing-account policy with no signup API call', async () => {
  let options;
  const client = { auth: { signInWithOAuth: async (value) => { options = value; return {}; } } };
  await startGoogleLogin(client, { origin: 'https://www.yuqi.site', redirect: '/life-blog/2',
    fetcher: async () => ({ ok: true, json: async () => ({ googleEnabled: true, existingAccountsOnly: true }) }) });
  assert.equal(options.provider, 'google');
  assert.equal(options.options.queryParams.prompt, 'select_account');
  assert.equal(options.options.redirectTo, 'https://www.yuqi.site/auth/callback?redirect=%2Flife-blog%2F2');
});

test('callback exchanges the one-time code once and verifies the user', async () => {
  let exchanges = 0;
  const user = { email: 'existing@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false };
  const client = { auth: {
    exchangeCodeForSession: async () => { exchanges++; return { data: { session: {} } }; },
    getUser: async () => ({ data: { user } }),
  } };
  assert.deepEqual(await completeGoogleLogin(client, 'code'), user);
  await completeGoogleLogin(client, 'code');
  assert.equal(exchanges, 1);
});

test('callback rejects expired codes, anonymous and unconfirmed identities', async () => {
  await assert.rejects(completeGoogleLogin({ auth: { exchangeCodeForSession: async () => ({ error: { code: 'signup_disabled' } }) } }, 'code'), /existing accounts/);
  for (const user of [{ email: 'existing@example.test' }, { email: 'existing@example.test', email_confirmed_at: 'now', is_anonymous: true }, {}]) {
    let signedOut = false;
    const client = { auth: {
      exchangeCodeForSession: async () => ({ data: { session: {} } }),
      getUser: async () => ({ data: { user } }),
      signOut: async ({ scope }) => { signedOut = scope === 'local'; },
    } };
    await assert.rejects(completeGoogleLogin(client, 'code'), /existing accounts/);
    assert.equal(signedOut, true);
  }
  assert.match(googleAuthError('signup_disabled'), /existing accounts/);
});
