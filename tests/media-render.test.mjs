import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMedia } from '../src/lib/media/render.js';
import { placeholderHtml } from '../src/lib/media/markup.mjs';

const options = { baseUrl: 'https://media.example' };
const html = placeholderHtml({ id: '11111111-1111-4111-8111-111111111111', kind: 'VIDEO', alt: 'Preview' });
function client(query) {
  return { from(table) {
    assert.equal(table, 'media_public');
    return { select() { return { in(field, ids) {
      assert.equal(field, 'id');
      return { abortSignal(signal) { return query(ids, signal); } };
    } }; } };
  } };
}

test('media failures preserve the stored article preview', async () => {
  const db = client(async () => ({ data: null, error: new Error('offline') }));
  assert.equal(await renderMedia(html, db, options), html);
  assert.equal(await renderMedia(html, null, options), html);
  assert.equal(await renderMedia(html, db, { baseUrl: '' }), html);
});

test('media lookup is aborted rather than blocking article rendering indefinitely', async () => {
  let aborted = false;
  const db = client((ids, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  }));
  assert.equal(await renderMedia(html, db, options), html);
  assert.equal(aborted, true);
});

test('one bounded media lookup per article', async () => {
  const many = Array.from({ length: 60 }, (_, index) => placeholderHtml({
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, kind: 'VIDEO', alt: 'Preview',
  })).join('');
  let calls = 0;
  await renderMedia(many, client(async ids => {
    calls++;
    assert.equal(ids.length, 50);
    return { data: [] };
  }), options);
  assert.equal(calls, 1);
});
