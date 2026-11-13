import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const modulePath = process.env.DISCOVERY_PGLITE_MODULE;

test('PostgreSQL review schema: roles, atomic transitions, expiry and immutable fingerprints', { skip: !modulePath }, async () => {
  const { PGlite } = await import(modulePath);
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../supabase/migrations/20261112184443_content_review_queue.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into public.content_review_queue(id, fingerprint, channel, text, reason, model)
      values('11111111-1111-4111-8111-111111111111', repeat('a',64), 'contact', 'Test only', 'uncertain', 'test');`);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.content_review_queue'), /permission denied/);
      await assert.rejects(db.query(`select * from public.review_content_transition('11111111-1111-4111-8111-111111111111','pending','releasing','x')`), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const sql = `select * from public.review_content_transition('11111111-1111-4111-8111-111111111111','pending','releasing','test-admin')`;
    assert.equal((await db.query(sql)).rows.length, 1);
    assert.equal((await db.query(sql)).rows.length, 0);
    assert.equal((await db.query(`select * from public.review_content_transition('11111111-1111-4111-8111-111111111111','releasing','sent','test-admin')`)).rows[0].audit.length, 2);
    await assert.rejects(db.query(`select * from public.review_content_transition('11111111-1111-4111-8111-111111111111','sent','pending','test-admin')`), /Invalid review transition/);
    await db.exec(`update public.content_review_queue set status='pending', expires_at=now() - interval '1 hour';`);
    assert.equal((await db.query(sql)).rows.length, 0);
    await db.exec(`delete from public.content_review_queue where expires_at < now()`);
    assert.equal((await db.query('select * from public.content_review_queue')).rows.length, 0);
  } finally { await db.close(); }
});
