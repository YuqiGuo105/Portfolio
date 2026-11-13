import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/lib/discovery/store.mjs';
import { consumeWindow, kafkaOptions, runScheduled } from '../src/lib/discovery/worker.mjs';

test('Kafka config normalizes Java mechanism and escaped CA', () => {
  const config = kafkaOptions({ KAFKA_BROKERS: 'a:1,b:2', KAFKA_SASL_MECHANISM: 'SCRAM-SHA-256', KAFKA_CA_CERT: 'a\\nb' });
  assert.equal(config.sasl.mechanism, 'scram-sha-256'); assert.deepEqual(config.ssl.ca, ['a\nb']);
});
test('scheduled work consumes hourly but rebuilds and cleans only once per UTC day', async () => {
  const store = memoryStore(); let reads = 0, builds = 0, cleanups = 0;
  const deps = { store, consume: async () => ({ processed: ++reads }), service: { rebuild: async () => ({ documents: 2, deferred: 0, unavailable: 1, attempt: ++builds }) }, cleanup: async () => { cleanups++; } };
  await runScheduled(deps); await runScheduled(deps);
  assert.deepEqual([reads, builds, cleanups], [2, 1, 1]);
  assert.equal((await store.get('last-worker')).status, 'ok');
});
test('worker lease excludes overlapping runs and releases after failure', async () => {
  const store = memoryStore(); await store.set('worker-lease', { owner: 'other', until: Date.now() + 50000 });
  assert.deepEqual(await runScheduled({ store }), { skipped: 'already_running' });
  await store.set('worker-lease', { until: 0 });
  await assert.rejects(runScheduled({ store, consume: async () => { throw Error('offline'); } }));
  assert.equal((await store.get('worker-lease')).until, 0);
  assert.equal((await store.get('last-worker')).status, 'error');
});
test('Kafka acknowledgement is after aggregation; storage failure leaves offset uncommitted', async () => {
  const event = { eventId: '11111111-1111-4111-8111-111111111111', siteId: 'yuqi.site', consentState: 'granted', sessionId: 'test', eventTime: new Date().toISOString(), eventType: 'page_view', pageUrl: '/' };
  for (const broken of [false, true]) {
    let handler, crash, commits = 0, disconnected = false;
    const store = memoryStore(); if (broken) store.update = async () => { throw Error('offline'); };
    const consumer = { events: { CRASH: 'crash' }, on: (_type, cb) => { crash = cb; return () => {}; }, connect: async () => {}, subscribe: async () => {},
      run: async options => { assert.equal(options.autoCommit, false); handler = options.eachMessage; },
      commitOffsets: async rows => { assert.equal(rows[0].offset, '10'); assert.ok(await store.get('learning-public')); commits++; }, disconnect: async () => { disconnected = true; } };
    const work = consumeWindow(consumer, { store, loadCatalog: async () => ({ items: [] }) }, { durationMs: 30, maxEvents: 1,
      onReady: async () => { try { await handler({ topic: 'test', partition: 0, message: { value: Buffer.from(JSON.stringify(event)), offset: '9' } }); } catch { crash(); } } });
    if (broken) await assert.rejects(work); else await work;
    assert.equal(commits, broken ? 0 : 1); assert.equal(disconnected, true);
  }
});
