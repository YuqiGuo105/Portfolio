import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { supabaseReferralStore } from '../src/lib/referral/store.mjs';

test('badge updates send both concurrency conditions to the database', async () => {
  const requests = [];
  let result = [{ id: 'request-1', state: 'ready', screening: { passed: true } }];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      requests.push({ url: new URL(url), method: options.method, body: JSON.parse(options.body) });
      return Response.json(result);
    } },
  });
  const store = supabaseReferralStore(client);
  const conditions = { expectedUpdatedAt: '2026-11-16T12:00:00+00:00', expectedState: 'ready' };
  assert.equal((await store.update('request-1', { screening: { passed: true } }, conditions)).id, 'request-1');
  const request = requests[0];
  assert.equal(request.method, 'PATCH');
  assert.equal(request.url.pathname, '/rest/v1/referral_requests');
  assert.equal(request.url.searchParams.get('id'), 'eq.request-1');
  assert.equal(request.url.searchParams.get('updated_at'), `eq.${conditions.expectedUpdatedAt}`);
  assert.equal(request.url.searchParams.get('state'), 'eq.ready');
  assert.deepEqual(request.body.screening, { passed: true });
  assert.ok(Number.isFinite(Date.parse(request.body.updated_at)));
  result = [];
  assert.equal(await store.update('request-1', { screening: { passed: true } }, conditions), null);
  assert.equal(requests.length, 2, 'a stale update is not retried without its conditions');
});
