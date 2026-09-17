import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedSearch } from '../src/lib/rankedSearch.mjs';

const payload = { results: [{ id: '2', key: 'LIFE_BLOG:2', type: 'LIFE_BLOG', title: 'Travel',
  summary: 'Journey', tags: ['Travel'], url: 'https://www.yuqi.site/life-blog/2', sourceRequiresLogin: true,
  searchText: 'must not escape the proxy', raw: { token: 'private' } }], total: 1, modelVersion: 'v1', requestId: 'request-id' };

test('typed proxy retains the login link and strips internal fields', async () => {
  const result = await rankedSearch({ q: '盐湖城', source: 'life' }, { fetchImpl: async url => {
    assert.equal(url.searchParams.get('types'), 'LIFE_BLOG');
    return Response.json(payload);
  } });
  assert.equal(result.results[0].sourceRequiresLogin, true);
  assert.equal(result.results[0].source, 'Life');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('must not escape'));
});

test('failure remains an error and does not turn into an empty result', async () => {
  await assert.rejects(rankedSearch({ q: 'SLC' }, { fetchImpl: async () => new Response('down', { status: 503 }) }));
});

test('invalid queries and category filters are rejected', async () => {
  for (const params of [{ q: 'x'.repeat(301) }, { q: 'x', source: 'secret' }]) {
    await assert.rejects(rankedSearch(params), RangeError);
  }
});

test('untrusted result URLs and wrong types cannot cross the proxy', async () => {
  for (const changes of [{ url: 'https://evil.example' }, { type: 'PRIVATE' }]) {
    await assert.rejects(rankedSearch({ q: 'x' }, { fetchImpl: async () => Response.json({ ...payload, results: [{ ...payload.results[0], ...changes }] }) }));
  }
});
