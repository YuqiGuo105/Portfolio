import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the installed PGlite entrypoint.');
const { PGlite } = await import(process.env.PGLITE_MODULE);
const sql = await readFile(new URL('../supabase/migrations/20261027150402_current_knowledge_lexical_recovery.sql', import.meta.url), 'utf8');

test('lexical recovery excludes private, superseded, unpublished and unreviewed evidence', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table kb_documents(id uuid primary key,content text,metadata jsonb);
      create table "Blogs"(id uuid); create table "Projects"(id uuid,publication_status text);
      create table life_blogs(id bigint,require_login boolean); create table experience(id bigint);
      grant select on all tables in schema public to service_role;`);
    await db.exec(sql);
    const insert = async (content, meta) => {
      const id = randomUUID();
      await db.query('insert into kb_documents values($1,$2,$3)', [id, content, meta]); return id;
    };
    const content = 'Syracuse University masters degree in Computer Science. University of Liverpool bachelors degree.';
    const original = await insert(content, { source: 'personal_profile' });
    const { rows } = await db.query('select md5($1) as hash', [content]);
    const profile = { status: 'ACTIVE', source_type: 'PROFILE', answer_visibility: 'public',
      retrieval_eligible: true, evidence_review: 'approved', source_id: original, original_content_md5: rows[0].hash };
    const approved = await insert(content, profile);
    for (const change of [{ status: 'SUPERSEDED' }, { evidence_review: 'pending' },
      { original_content_md5: 'stale' }, { answer_visibility: 'private' }, { retrieval_eligible: false }]) {
      await insert(content, { ...profile, ...change });
    }
    const project = randomUUID();
    await db.query('insert into "Projects" values($1,\'PUBLISHED\')', [project]);
    const meta = { status: 'ACTIVE', source_type: 'PROJECT', source_id: project, url: `/work-single/${project}`, source_version: 1 };
    await insert('Kafka duplicate messages old', meta);
    const current = await insert('Kafka duplicate messages current', { ...meta, source_version: 2 });
    await db.exec('insert into life_blogs values(1,true),(2,false);');
    await insert('Kafka private article', { ...meta, source_type: 'LIFE_BLOG', source_id: '1', url: '/life-blog/1' });
    const publicBlog = await insert('Kafka public article', { ...meta, source_type: 'LIFE_BLOG', source_id: '2', url: '/life-blog/2' });
    const search = async query => (await db.query('select * from search_current_knowledge_lexical($1,20)', [query])).rows;
    await db.exec('set role service_role;');
    assert.deepEqual((await search('学历')).map(r => r.id), [approved]);
    assert.deepEqual(new Set((await search('Kafka')).map(r => r.id)), new Set([current, publicBlog]));
    assert.equal((await search('Kafka')).every(r => r.metadata.source_requires_login === false), true);
    assert.equal((await search('')).length, 0);
    assert.equal((await search('x'.repeat(8001))).length, 0);
    await db.exec('reset role;');
    await db.query('update "Projects" set publication_status=\'DRAFT\' where id=$1', [project]);
    assert.deepEqual((await search('Kafka')).map(r => r.id), [publicBlog]);
    await db.query('update kb_documents set content=\'changed\' where id=$1', [original]);
    assert.equal((await search('学历')).length, 0);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role};`);
      await assert.rejects(search('education'), /permission denied/);
      await db.exec('reset role;');
    }
  } finally { await db.close(); }
});
