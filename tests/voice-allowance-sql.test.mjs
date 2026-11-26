// The voice allowance as PostgreSQL runs it (db/voice-budget.sql), in an in-memory database.
// Skipped unless VOICE_PGLITE_MODULE (or DISCOVERY_PGLITE_MODULE) points at PGlite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modulePath = process.env.VOICE_PGLITE_MODULE || process.env.DISCOVERY_PGLITE_MODULE;
const ticket = letter => letter.repeat(64);

test('voice allowance: the newest caller has the line, an attempt that never connected is not counted twice, the limits hold', { skip: !modulePath }, async () => {
  const { PGlite } = await import(modulePath);
  const db = new PGlite();
  const call = async (action, hash = null) => (await db.query('select public.voice_allowance($1, $2) as r', [action, hash])).rows[0].r;
  const row = async () => (await db.query('select daily_calls, monthly_calls, ticket_hash, claimed from public.voice_budget')).rows[0];
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../db/voice-budget.sql', import.meta.url), 'utf8'));
    assert.equal((await call('status')).reason, 'disabled');
    assert.equal((await call('reserve', ticket('a'))).allowed, false, 'nothing is reserved while voice is switched off');
    await db.exec('update public.voice_budget set enabled = true');
    let state = await call('status');
    assert.deepEqual([state.allowed, state.reason, state.remainingCalls, state.holds], [true, null, 5, null]);

    // An attempt that never connects does not keep the next one out, and the two count as one call.
    state = await call('reserve', ticket('a'));
    assert.deepEqual([state.allowed, state.remainingCalls, state.holds], [true, 4, true]);
    state = await call('reserve', ticket('b'));
    assert.deepEqual([state.allowed, state.reason, state.remainingCalls, state.holds], [true, null, 4, true]);
    assert.equal((await call('status', ticket('a'))).holds, false);
    assert.deepEqual(await call('claim', ticket('a')), { allowed: false, reason: 'invalid_ticket' }, 'a ticket that lost the line cannot start a call');
    state = await call('claim', ticket('b'));
    assert.equal(state.allowed, true); assert.ok(Date.parse(state.expiresAt) > Date.now() + 100000);
    assert.deepEqual(await call('claim', ticket('b')), { allowed: false, reason: 'invalid_ticket' }, 'one use');

    // A newer caller takes the line from a call in progress; that is a call of its own.
    state = await call('status');
    assert.deepEqual([state.allowed, state.reason], [true, null], 'the line is never reported busy');
    state = await call('reserve', ticket('c'));
    assert.deepEqual([state.allowed, state.remainingCalls], [true, 3]);
    assert.equal((await call('status', ticket('b'))).holds, false, 'the earlier call learns that it lost the line');
    await call('release', ticket('b'));
    assert.equal((await call('status', ticket('c'))).holds, true, 'an ended call does not release a line that is no longer its own');
    assert.equal((await call('claim', ticket('c'))).allowed, true);
    await call('release', ticket('c'));
    assert.deepEqual([(await row()).ticket_hash, (await call('status', ticket('c'))).holds], [null, false]);

    // Five calls a day.
    for (const letter of ['d', 'e', 'f']) {
      assert.equal((await call('reserve', ticket(letter))).allowed, true);
      assert.equal((await call('claim', ticket(letter))).allowed, true);
      await call('release', ticket(letter));
    }
    assert.equal((await row()).daily_calls, 5);
    state = await call('reserve', ticket('0'));
    assert.deepEqual([state.allowed, state.reason, state.remainingCalls], [false, 'daily_limit', 0]);
    assert.equal((await call('status')).reason, 'daily_limit');
    assert.equal((await row()).ticket_hash, null, 'a refused reservation takes nothing');

    // The last call of the day may be retried when it did not connect, and still is one call.
    await db.exec('update public.voice_budget set daily_calls = 4, monthly_calls = 4');
    assert.equal((await call('reserve', ticket('1'))).remainingCalls, 0);
    assert.equal((await call('status')).allowed, true);
    state = await call('reserve', ticket('2'));
    assert.deepEqual([state.allowed, state.remainingCalls], [true, 0]);
    assert.equal((await call('claim', ticket('2'))).allowed, true);
    assert.equal((await call('reserve', ticket('3'))).reason, 'daily_limit', 'once it connected, the day is used up');
    await call('release', ticket('2'));
    assert.deepEqual([(await row()).daily_calls, (await row()).monthly_calls], [5, 5]);

    // An attempt left behind long ago is not a retry: the next call is counted.
    await db.query("update public.voice_budget set daily_calls = 1, monthly_calls = 1, ticket_hash = $1, claimed = false, claim_by = now() - interval '3 minutes', active_until = now() - interval '3 minutes'", [ticket('4')]);
    assert.equal((await call('reserve', ticket('5'))).remainingCalls, 3);
    assert.equal((await row()).daily_calls, 2);

    // Forty calls a month, and a new day starts the daily count again.
    await db.exec("update public.voice_budget set daily_calls = 0, monthly_calls = 40, ticket_hash = null, claimed = false");
    assert.equal((await call('reserve', ticket('6'))).reason, 'monthly_limit');
    await db.exec("update public.voice_budget set daily_calls = 5, monthly_calls = 7, usage_day = usage_day - 1");
    state = await call('status');
    assert.deepEqual([state.allowed, state.remainingCalls], [true, 5]);

    // Only well-formed tickets, and only the four operations.
    for (const [action, hash] of [['reserve', null], ['reserve', 'xyz'], ['claim', null], ['release', 'A'.repeat(64)], ['status', 'not-a-ticket'], ['drop', ticket('a')]]) {
      await assert.rejects(call(action, hash), /Invalid voice/);
    }
  } finally { await db.close(); }
});
