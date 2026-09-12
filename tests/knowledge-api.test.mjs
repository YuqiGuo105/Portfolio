import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeApi, knowledgeMutation } from '../src/lib/knowledgeApi.mjs';

test('knowledge writes use nested documents, policies and preconditions', () => {
  assert.deepEqual(knowledgeMutation({ title: 'Title', question: 'Question', content: 'Fact', status: 'DRAFT', answerVisibility: 'private', expectedRevision: 'a'.repeat(32) }), {
    document: { title: 'Title', question: 'Question', content: 'Fact' },
    policy: { status: 'DRAFT', answerVisibility: 'private' }, preconditions: { revision: 'a'.repeat(32) },
  });
});
test('search uses one bounded paginated request', () => {
  const calls = []; const api = createKnowledgeApi((...args) => calls.push(args));
  api.list({ query: 'Education', offset: 25 });
  assert.deepEqual(calls, [['POST', '/api/admin/knowledge/search', { filter: { query: 'Education', scope: 'OWNED', status: 'ALL' }, page: { size: 25, offset: 25 } }]]);
});
test('batch has a fixed limit and never fans out into N requests', () => {
  const calls = []; const api = createKnowledgeApi((...args) => calls.push(args));
  api.getBatch(['a', 'b']); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['POST', '/api/admin/knowledge/batch-get', { ids: ['a', 'b'] }]);
  assert.throws(() => api.getBatch([])); assert.throws(() => api.getBatch(Array(26).fill('x')));
  assert.equal(calls.length, 1);
});
test('write identity and revision survive client transport', () => {
  const calls = []; const api = createKnowledgeApi((...args) => calls.push(args));
  api.create({ title: 'New', content: 'Fact' }, 'stable-key');
  api.remove('a/b', 'c&d', 'delete-key');
  assert.equal(calls[0][3], 'stable-key');
  assert.deepEqual(calls[1], ['DELETE', '/api/admin/knowledge/a%2Fb?expectedRevision=c%26d', undefined, 'delete-key']);
});
