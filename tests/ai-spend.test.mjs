import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpendGuard, SpendDenied } from '../src/lib/voice/spendGuard.mjs';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key' };
test('budget denial fails closed without leaking provider or database details', async () => {
  for (const result of [{ ok: false }, { ok: true, json: async () => ({}) }, { ok: true, json: async () => ({ allowed: false, reason: 'monthly_limit' }) }]) {
    const guard = createSpendGuard({ env, fetchImpl: async () => result });
    await assert.rejects(guard.reserve('qwen', 'voice', 200000), SpendDenied);
  }
});
test('requires secure server configuration even in unlimited local mode', async () => {
  let calls = 0;
  const guard = createSpendGuard({ env: { NODE_ENV: 'development', QWEN_LIVE_UNLIMITED_LOCAL: 'true' }, fetchImpl: async () => { calls++; } });
  await assert.rejects(guard.reserve('qwen', 'voice', 100), SpendDenied);
  assert.equal(calls, 0);
});
test('one reservation and idempotent settlement retain original charge', async () => {
  const calls = [];
  const guard = createSpendGuard({ env, fetchImpl: async (url, init) => {
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(init.redirect, 'error');
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ allowed: true }) };
  } });
  const reservation = await guard.reserve('google', 'text', 2000);
  await reservation.settle(1000);
  await reservation.settle(0);
  assert.equal(calls[0].p_action, 'reserve');
  assert.equal(calls[1].p_id, calls[0].p_id);
  assert.equal(calls[2].p_micros, 1000);
});
test('unknown usage retains the full reservation', async () => {
  let body;
  const guard = createSpendGuard({ env, fetchImpl: async (_, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ allowed: true }) }; } });
  const reservation = await guard.reserve('qwen', 'voice', 200000);
  await reservation.settle();
  assert.equal(body.p_micros, null);
});
