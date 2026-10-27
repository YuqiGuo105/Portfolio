import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the installed @electric-sql/pglite entrypoint.');
const { PGlite } = await import(process.env.PGLITE_MODULE);
const sql = await readFile(new URL('../supabase/migrations/20261027035313_shared_ai_spend_guard.sql', import.meta.url), 'utf8');
async function database() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(sql);
  return db;
}
async function call(db, action, id = null, micros = null) {
  const { rows } = await db.query("select public.ai_spend_guard($1, $2::uuid, 'qwen', 'test', $3::bigint) as result", [action, id, micros]);
  return rows[0].result;
}
test('paused rollout, atomic reservations, duplicate safety and exact boundary', async () => {
  const db = await database();
  try {
    assert.equal((await call(db, 'status')).reason, 'disabled');
    await db.exec('update public.ai_spend_policy set enabled = true;');
    const ids = Array.from({ length: 20 }, () => randomUUID());
    const results = await Promise.all(ids.map(id => call(db, 'reserve', id, 1000000)));
    assert.equal(results.filter(r => r.allowed).length, 8);
    assert.equal((await call(db, 'status')).reason, 'monthly_limit');
    assert.equal((await call(db, 'reserve', ids[0], 1000000)).reason, 'duplicate');
    assert.equal((await call(db, 'settle', ids[0], 500000)).reason, 'settled');
    assert.equal((await call(db, 'settle', ids[0], 0)).reason, 'already_settled');
    assert.equal((await call(db, 'status')).remainingMicros, 500000);
    assert.equal((await call(db, 'reserve', randomUUID(), 500001)).allowed, false);
    assert.equal((await call(db, 'reserve', randomUUID(), 500000)).allowed, true);
  } finally { await db.close(); }
});
test('unknown usage and old outstanding work cannot replenish the budget', async () => {
  const db = await database();
  try {
    await db.exec('update public.ai_spend_policy set enabled = true;');
    const id = randomUUID();
    await call(db, 'reserve', id, 3000000);
    await db.exec("insert into public.ai_spend_months(month) values ('2020-01-01'); update public.ai_spend_reservations set month = '2020-01-01';");
    assert.equal((await call(db, 'status')).remainingMicros, 5000000);
    await call(db, 'settle', id);
    assert.equal((await call(db, 'status')).remainingMicros, 5000000);
  } finally { await db.close(); }
});
test('overrun records the real charge and disables new calls', async () => {
  const db = await database();
  try {
    await db.exec('update public.ai_spend_policy set enabled = true;');
    const id = randomUUID();
    await call(db, 'reserve', id, 100);
    assert.equal((await call(db, 'settle', id, 101)).reason, 'reservation_overrun');
    assert.equal((await call(db, 'status')).reason, 'disabled');
    const { rows } = await db.query('select sum(settled_micros) as charged from public.ai_spend_months');
    assert.equal(Number(rows[0].charged), 101);
  } finally { await db.close(); }
});
test('RLS and grants reject public callers; service_role works without security definer', async () => {
  const db = await database();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role};`);
      await assert.rejects(call(db, 'status'), /permission denied/);
      await assert.rejects(db.query('select * from public.ai_spend_reservations'), /permission denied/);
      await db.exec('reset role;');
    }
    await db.exec('set role service_role;');
    assert.equal((await call(db, 'status')).reason, 'disabled');
    await db.exec('reset role;');
    await assert.rejects(db.exec('update public.ai_spend_policy set monthly_limit_micros = 9000000'), /check constraint/);
  } finally { await db.close(); }
});
