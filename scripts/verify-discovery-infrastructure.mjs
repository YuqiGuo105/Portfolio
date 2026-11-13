// Uses production infrastructure but a separate short-lived topic and Redis namespace.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Kafka, logLevel } from 'kafkajs';
import { redisStore } from '../src/lib/discovery/store.mjs';
import { kafkaOptions, consumeWindow } from '../src/lib/discovery/worker.mjs';

const secret = name => execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, '--project=portfolio-notify-prod'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const env = Object.fromEntries(['BROKERS', 'USERNAME', 'PASSWORD', 'CA_CERT'].map(key => [`KAFKA_${key}`, secret(`ANALYTICS_KAFKA_${key}`)]));
const run = randomUUID(), prefix = `portfolio:discovery:verification:${run}:`;
const deadline = setTimeout(() => { console.error('Infrastructure verification deadline exceeded'); process.exit(1); }, 120000);
const backend = redisStore(secret('ANALYTICS_VALKEY_URL'), prefix);
const store = { ...backend, set: (key, value) => backend.set(key, value, 3600), update: (key, change) => backend.update(key, change, 3600) };
const kafka = new Kafka({ ...kafkaOptions(env), logLevel: logLevel.NOTHING });
const admin = kafka.admin(), producer = kafka.producer({ allowAutoTopicCreation: false });
const topic = 'portfolio.discovery.verification.v1';
const consumer = kafka.consumer({ groupId: 'portfolio-discovery-verification-v1', allowAutoTopicCreation: false, sessionTimeout: 10000, heartbeatInterval: 2500 });
const items = [{ id: 'project:one', url: '/verification-one' }, { id: 'blog:two', url: '/verification-two' }];
const event = page => ({ eventId: randomUUID(), siteId: 'yuqi.site', sessionId: run, consentState: 'granted', eventType: 'page_view', eventTime: new Date().toISOString(), pageUrl: page.url });
try {
  await admin.connect();
  console.log('Kafka admin connected');
  await admin.createTopics({ topics: [{ topic, numPartitions: 1, configEntries: [{ name: 'retention.ms', value: '3600000' }] }], waitForLeaders: true });
  await producer.connect();
  console.log('Kafka producer connected');
  const events = items.map(event); let published;
  const joined = new Promise(resolve => consumer.on(consumer.events.GROUP_JOIN, resolve));
  const stats = await consumeWindow(consumer, { store, loadCatalog: async () => ({ items }) }, { topic, durationMs: 45000, maxEvents: 4,
    onReady: async () => { await joined; published = await producer.send({ topic, messages: events.flatMap(value => [{ key: run, value: JSON.stringify(value) }, { key: run, value: JSON.stringify(value) }]) }); } });
  const state = await store.get('stats'), projection = await store.get('learning-public');
  assert.equal(Object.keys(state.receipts).length, 2);
  assert.equal(state.pairs['blog:two|project:one'], 1);
  assert.equal(projection.pairs['blog:two|project:one'], 1);
  assert.equal(projection.receipts, undefined);
  const offsets = await admin.fetchOffsets({ groupId: 'portfolio-discovery-verification-v1', topics: [topic] });
  assert.ok(BigInt(offsets[0].partitions[0].offset) >= BigInt(published[0].baseOffset) + 4n);
  console.log(JSON.stringify({ kafka: 'TLS/SASL connected', redis: 'TLS/CAS verified', duplicateDeliveries: stats.processed, uniqueEvents: 2, coVisitCount: 1, offsetsCommitted: true, productionVisitorDataWritten: false }));
} finally { await producer.disconnect(); await admin.disconnect(); await store.close(); clearTimeout(deadline); }
