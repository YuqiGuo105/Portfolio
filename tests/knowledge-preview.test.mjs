import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewEnabled, searchOptions, searchKnowledge, getKnowledgeBatch } from '../src/lib/server/knowledgePreview.mjs';

const ID = '00000000-0000-4000-8000-000000000001';
const MISSING_ID = '00000000-0000-4000-8000-000000000002';

function reader(result) {
  const calls = [];
  const client = Object.fromEntries(['from', 'select', 'or', 'order', 'range', 'in'].map(method => [method, (...args) => {
    calls.push([method, ...args]);
    return client;
  }]));
  client.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return { client, calls };
}

test('live preview is opt-in and always disabled in production', () => {
  assert.equal(previewEnabled({}), false);
  assert.equal(previewEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(previewEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_KNOWLEDGE_READ_ONLY_PREVIEW: 'true' }), false);
  assert.equal(previewEnabled({ NODE_ENV: 'development', NEXT_PUBLIC_KNOWLEDGE_READ_ONLY_PREVIEW: 'true' }), true);
});

test('search validates nested pagination and filters before querying', () => {
  assert.equal(searchOptions().size, 25);
  for (const body of [
    { page: { size: 26 } }, { page: { size: 0 } }, { page: { offset: -1 } },
    { page: { size: 1.5 } }, { page: { offset: 100001 } },
    { filter: { scope: 'INVALID' } }, { filter: { status: 'INVALID' } },
    { filter: { query: 123 } }, { filter: { query: 'x'.repeat(301) } },
    { filter: { query: '\0' } },
  ]) assert.throws(() => searchOptions(body), /Invalid knowledge search/);
});

test('search quotes arbitrary text and escapes wildcard characters', () => {
  const query = 'x",status.eq.ACTIVE)%_*\\';
  const literal = JSON.stringify(`%${query.replace(/[\\%_*]/g, '\\$&')}%`);
  assert.equal(searchOptions({ filter: { scope: 'ALL', query } }).filter,
    `and(or(content.ilike.${literal},metadata->>title.ilike.${literal},metadata->>question.ilike.${literal}))`);
});

test('scope and status remain combined in a single filter', () => {
  assert.match(searchOptions({ filter: { status: 'LEGACY' } }).filter, /metadata->>status.is.null/);
  assert.match(searchOptions({ filter: { scope: 'INDEXED', status: 'ACTIVE' } }).filter, /source_type.not.is.null/);
  assert.equal(searchOptions({ filter: { scope: 'ALL' } }).filter, null);
});

test('list uses bounded stable ordering and returns summaries without vectors', async () => {
  const { client, calls } = reader({ data: [{ id: ID, content: 'a'.repeat(400), metadata: { question: 'Owner question' } }], count: 87 });
  const result = await searchKnowledge(client, { page: { size: 10, offset: 20 } });
  assert.equal(result.total, 87);
  assert.equal(result.items[0].preview.length, 180);
  assert.equal(result.items[0].status, 'LEGACY');
  assert.equal(result.items[0].editable, true);
  assert.equal(result.connection.mode, 'LIVE_READ_ONLY');
  assert.deepEqual(calls.filter(call => call[0] === 'range'), [['range', 20, 29]]);
  assert.deepEqual(calls.filter(call => call[0] === 'order'), [['order', 'created_at', { ascending: false }], ['order', 'id']]);
  assert.equal(calls.filter(call => call[0] === 'or').length, 1);
  assert.equal(calls.some(call => call[0] === 'select' && call[1].includes('embedding')), false);
});

test('batch deduplicates IDs in one query and preserves missing results', async () => {
  const { client, calls } = reader({ data: [{ id: ID, content: 'Source content', metadata: { source_type: 'BLOG', status: 'ACTIVE' } }] });
  const result = await getKnowledgeBatch(client, [ID, MISSING_ID, ID]);
  assert.deepEqual(calls.filter(call => call[0] === 'in'), [['in', 'id', [ID, MISSING_ID]]]);
  assert.deepEqual(result.batch, { requested: 2, found: 1, maxSize: 25 });
  assert.equal(result.items[0].record.editable, false);
  assert.equal(result.items[0].record.content, 'Source content');
  assert.deepEqual(result.items[1], { id: MISSING_ID, found: false });
});

test('invalid batches never reach the database', async () => {
  const { client, calls } = reader({ data: [] });
  for (const ids of [null, [], Array(26).fill(ID), ['not-a-uuid'], [123]])
    await assert.rejects(getKnowledgeBatch(client, ids), /Choose 1-25 knowledge UUIDs/);
  assert.equal(calls.length, 0);
});

test('database errors do not disclose provider internals', async () => {
  const { client } = reader({ error: { message: 'Private provider diagnostic' } });
  await assert.rejects(searchKnowledge(client, {}), { message: 'Live knowledge query failed' });
  await assert.rejects(getKnowledgeBatch(client, [ID]), { message: 'Live knowledge query failed' });
});
