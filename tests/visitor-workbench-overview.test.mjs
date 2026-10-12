import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createVisitorPreviewApi } from '../src/lib/visitorPreview.mjs';

test('overview aggregates the full window, independent of page size, and fills empty buckets', async () => {
  const api = createVisitorPreviewApi();
  const to = new Date().toISOString();
  const query = { hours: 168, to, from: new Date(Date.parse(to) - 168 * 3600000).toISOString() };
  const [data, page] = await Promise.all([api.visitors.overview(query), api.visitors.list({ ...query, size: 1 })]);
  assert.equal(page.items.length, 1);
  assert.equal(data.summary.events, page.page.totalElements);
  assert.ok(data.summary.events > 200);
  assert.equal(data.timeline.length, 8);
  assert.equal(data.timeline.reduce((sum, p) => sum + p.events, 0), data.summary.events);
  assert.equal(data.summary.likelyPeople + data.summary.bots + data.summary.unknown, data.summary.events);
  for (const rows of Object.values(data.rankings)) assert.ok(rows.length <= 5);
  assert.doesNotMatch(JSON.stringify(data), /sample-session|ipAddress|private=|\?q=/);
  const empty = await api.visitors.overview({ ...query, country: 'XX' });
  assert.equal(empty.summary.events, 0);
  assert.ok(empty.timeline.every(p => p.events === 0));
});

test('overview bot and content filters match the records and unknown is not human', async () => {
  const api = createVisitorPreviewApi();
  for (const hours of [24, 168, 720]) for (const bot of ['ALL', 'EXCLUDE', 'ONLY']) {
    const filters = { hours, bot, country: 'IN', device: 'mobile' };
    const overview = await api.visitors.overview(filters);
    const records = await api.visitors.list(filters);
    assert.equal(overview.summary.events, records.page.totalElements);
    if (bot !== 'ALL') assert.equal(overview.summary.unknown, 0);
    if (bot === 'EXCLUDE') assert.equal(overview.summary.bots, 0);
    if (bot === 'ONLY') assert.equal(overview.summary.likelyPeople, 0);
  }
});

const source = readFileSync(new URL('../pages/api/admin/visitor-overview.js', import.meta.url), 'utf8');
function handler(requireAdminUser, fetch) {
  return new Function('requireAdminUser', 'fetch', source.replace(/^import .*;\n/, '').replace('export default async function handler', 'return async function handler'))(requireAdminUser, fetch);
}
function response() { return { headers: {}, statusCode: 200, body: null, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } }; }

test('overview API rejects non-admin reads and mutation methods without fetching', async () => {
  for (const kind of ['anonymous', 'VIEWER', 'expired']) {
    let calls = 0;
    const res = response();
    const run = handler(async (_req, r) => { r.status(kind === 'VIEWER' ? 403 : 401).json({ error: 'unauthorized' }); return null; }, async () => { calls++; });
    await run({ method: 'GET', query: {} }, res);
    assert.ok([401, 403].includes(res.statusCode)); assert.equal(calls, 0);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    await run({ method: 'POST', query: {} }, res);
    assert.equal(res.statusCode, 405); assert.equal(calls, 0);
  }
});

test('overview API forwards only bounded query fields and never exposes downstream errors', async () => {
  const original = process.env.ANALYTICS_SERVICE_TOKEN;
  process.env.ANALYTICS_SERVICE_TOKEN = 'test-only-not-real';
  try {
    const res = response();
    const run = handler(async () => ({}), async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, '/api/admin/visitor-overview');
      assert.equal(parsed.searchParams.get('country'), 'IN');
      assert.equal(parsed.searchParams.get('bot'), 'EXCLUDE');
      assert.equal(parsed.searchParams.has('limit'), false);
      assert.equal(options.headers['X-Internal-Token'], 'test-only-not-real');
      return { ok: false, status: 500, text: async () => 'secret internal SQL' };
    });
    await run({ method: 'GET', query: { country: 'IN', bot: 'EXCLUDE', limit: 100000 } }, res);
    assert.equal(res.statusCode, 502); assert.doesNotMatch(JSON.stringify(res.body), /secret|SQL|run.app/);
  } finally { if (original == null) delete process.env.ANALYTICS_SERVICE_TOKEN; else process.env.ANALYTICS_SERVICE_TOKEN = original; }
});
