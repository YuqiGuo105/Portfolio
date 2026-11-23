import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogItem, createCatalogLoader } from '../src/lib/discovery/catalog.mjs';
import { projectCoverData } from '../src/lib/projectCover.mjs';
import { createDiscoveryService } from '../src/lib/discovery/service.mjs';
import { memoryStore } from '../src/lib/discovery/store.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const system = { project_id: id, title: 'Content Runtime', eyebrow: 'Event driven publishing', privateNote: 'omit', diagram_config: {
  coverTheme: 'content', coverLayout: 'database', coverStatus: 'Replayable', coverMotif: 'Outbox to search',
  nodes: [{ id: 'a', code: 'API', x: 10, y: 40, shape: 'gateway', description: 'omit' }, { id: 'b', code: 'DB', x: 80, y: 40, shape: 'database' }],
  edges: [{ from: 'a', to: 'b', kind: 'data' }], domains: [{ label: 'Write', x: 5, width: 90 }], steps: ['omit'],
} };
const rows = [{ id, title: 'Content Intelligence Platform', content: 'Kafka data' }, { id: otherId, title: 'Kafka article', content: 'Kafka data' }];

test('generated covers use bounded public presentation data, not project ids or article bodies', () => {
  const cover = projectCoverData(system);
  assert.equal(cover.diagram_config.nodes.length, 2);
  assert.equal(JSON.stringify(cover).includes('omit'), false);
  assert.equal(catalogItem(rows[0], 'project', system).coverSystem.diagram_config.coverTheme, 'content');
  assert.equal(catalogItem(rows[0], 'blog', system).coverSystem, null);
  assert.equal(projectCoverData({ ...system, diagram_config: { nodes: [] } }), null);
  assert.equal(projectCoverData({ ...system, diagram_config: { ...system.diagram_config, nodes: [{ id: 'a', x: Infinity, y: 2 }] } }), null);
  assert.equal(catalogItem({ ...rows[0], image_url: 'https://example.com/a.webp' }, 'project').image, 'https://example.com/a.webp');
});

function clientFixture({ fail = false } = {}) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    return { select(value) { call.columns = value; return this; }, eq(...args) { call.filters.push(args); return this; },
      in(...args) { call.filters.push(args); return this; }, order() { return this; }, limit() { return this; },
      async abortSignal() { return table === 'project_subsystems' ? { data: [system], error: fail } : { data: table === 'Projects' ? [rows[0]] : [rows[1]] }; } };
  } };
  return { client, calls };
}

test('catalog batches active cover reads for published projects and shares its minute cache', async () => {
  let now = 0;
  const f = clientFixture(), load = createCatalogLoader({ client: f.client, now: () => now });
  const [a, b] = await Promise.all([load(), load()]);
  assert.deepEqual(a, b);
  assert.equal(a.items[0].coverSystem.title, system.title);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.find(c => c.table === 'Projects').filters, [['publication_status', 'PUBLISHED']]);
  assert.deepEqual(f.calls[2].filters, [['project_id', [id]], ['active', true]]);
  await load(); assert.equal(f.calls.length, 3);
  now = 60001; await load(); assert.equal(f.calls.length, 6);
});

test('cover read failures keep recommendations usable and retry after five seconds', async () => {
  let now = 0;
  const f = clientFixture({ fail: true }), load = createCatalogLoader({ client: f.client, now: () => now });
  assert.equal((await load()).items.length, 2);
  now = 5001; await load(); assert.equal(f.calls.length, 6);
});

test('recommendations rejoin current covers even when stored ranking only has ids', async () => {
  const f = clientFixture(), loadCatalog = createCatalogLoader({ client: f.client }), store = memoryStore();
  const catalog = await loadCatalog();
  await store.set(`recommendations:${catalog.version}`, { [`blog:${otherId}`]: [{ id: `project:${id}`, reason: 'Related topic' }] }, 60);
  const service = createDiscoveryService({ store, provider: {}, loadCatalog });
  const result = await service.recommendations(otherId);
  assert.equal(result.items[0].coverSystem.title, system.title);
  assert.equal(result.items[0].text, undefined);
});

test('a thrown cover timeout does not discard readable articles', async () => {
  const f = clientFixture();
  const from = f.client.from;
  f.client.from = table => {
    if (table === 'project_subsystems') throw new Error('Timeout');
    return from(table);
  };
  const result = await createCatalogLoader({ client: f.client })();
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].coverSystem, null);
});
