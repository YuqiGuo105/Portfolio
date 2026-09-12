import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalyticsIdentity } from '../src/lib/analyticsIdentity.mjs';

const session = token => ({ data: { session: token ? { access_token: token } : null } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('anonymous visits need no remote role lookup', async () => {
  const identity = createAnalyticsIdentity({ getSession: async () => session(''), verify: () => assert.fail('No remote lookup') });
  assert.deepEqual(await identity.resolve(), { collect: true, token: '' });
});

test('admin first page waits for server verification; concurrent events share one bounded cache', async () => {
  const pending = deferred();
  let calls = 0;
  const identity = createAnalyticsIdentity({ getSession: async () => session('admin-token'), verify: () => { calls++; return pending.promise; } });
  const first = identity.resolve();
  const second = identity.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({ collect: false });
  assert.equal((await first).collect, false);
  assert.equal((await second).collect, false);
  assert.equal((await identity.resolve()).collect, false);
  assert.equal(calls, 1);
});

test('ordinary signed-in visitors remain counted; token refresh, logout and TTL recheck policy', async () => {
  let token = 'viewer';
  let time = 0;
  let calls = 0;
  const identity = createAnalyticsIdentity({
    getSession: async () => session(token), now: () => time,
    verify: async value => { calls++; return { collect: value === 'viewer' }; },
  });
  assert.equal((await identity.resolve()).collect, true);
  await identity.resolve();
  assert.equal(calls, 1);
  time = 60_001;
  await identity.resolve();
  assert.equal(calls, 2);
  token = 'refreshed-admin';
  assert.equal((await identity.resolve()).collect, false);
  assert.equal(calls, 3);
  identity.invalidate();
  token = '';
  assert.equal((await identity.resolve()).collect, true);
});

test('late answers cannot enable analytics after account switches', async () => {
  const pending = deferred();
  const identity = createAnalyticsIdentity({ getSession: async () => session('old-viewer'), verify: () => pending.promise });
  const request = identity.resolve();
  await Promise.resolve();
  identity.invalidate();
  pending.resolve({ collect: true });
  assert.equal((await request).collect, false);
});

test('auth errors, malformed replies and timeouts suppress events without blocking the UI', async () => {
  for (const getSession of [async () => { throw new Error('offline'); }, async () => ({ error: new Error('bad session') }), () => new Promise(() => {})]) {
    const identity = createAnalyticsIdentity({ getSession, verify: () => assert.fail('Not reached'), timeoutMs: 10 });
    assert.equal((await identity.resolve()).collect, false);
  }
  for (const verify of [async () => { throw new Error('503'); }, async () => ({}), () => new Promise(() => {})]) {
    const identity = createAnalyticsIdentity({ getSession: async () => session('token'), verify, timeoutMs: 10 });
    assert.equal((await identity.resolve()).collect, false);
  }
});
