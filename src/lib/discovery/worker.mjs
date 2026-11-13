import { randomUUID } from 'node:crypto';
import { consumeDiscoveryEvent } from './feedback.mjs';

export const kafkaOptions = env => ({
  clientId: 'portfolio-discovery', brokers: (env.KAFKA_BROKERS || '').split(',').filter(Boolean),
  connectionTimeout: 5000, requestTimeout: 10000, retry: { retries: 2 },
  ssl: env.KAFKA_CA_CERT ? { ca: [env.KAFKA_CA_CERT.replace(/\\n/g, '\n')] } : true,
  sasl: { mechanism: (env.KAFKA_SASL_MECHANISM || 'scram-sha-256').toLowerCase(), username: env.KAFKA_USERNAME, password: env.KAFKA_PASSWORD },
});

export async function consumeWindow(consumer, runtime, { topic = 'analytics.raw.events', durationMs = 30000, maxEvents = 1000, onReady } = {}) {
  let timer, count = 0, resolve, reject;
  const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
  finished.catch(() => {});
  const off = consumer.on(consumer.events.CRASH, () => reject(new Error('Discovery consumer failed')));
  try {
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({ autoCommit: false, eachMessage: async ({ topic: name, partition, message }) => {
      let event;
      try { event = JSON.parse(message.value.toString()); } catch { /* Invalid JSON is skipped, not retried forever. */ }
      if (event) await consumeDiscoveryEvent(event, runtime);
      // Redis must persist both idempotency receipts and aggregates before this acknowledgement.
      await consumer.commitOffsets([{ topic: name, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
      count++;
      if (count >= maxEvents) resolve();
    } });
    timer = setTimeout(resolve, durationMs);
    if (onReady) await Promise.race([Promise.resolve().then(onReady), finished]);
    await finished;
    return { processed: count };
  } finally { clearTimeout(timer); off?.(); await consumer.disconnect(); }
}

export async function runScheduled({ store, service, cleanup, consume, now = Date.now, forceRebuild = false }) {
  const owner = randomUUID(), start = now();
  const lease = await store.update('worker-lease', old => old?.until > start ? old : { owner, until: start + 600000 }, 600);
  if (lease.owner !== owner) return { skipped: 'already_running' };
  try {
    const feedback = await consume();
    const day = new Date(now()).toISOString().slice(0, 10);
    let maintenance = await store.get('last-maintenance');
    if (forceRebuild || maintenance?.day !== day || maintenance?.build?.deferred > 0) {
      const build = await service.rebuild();
      await cleanup();
      maintenance = { day, at: new Date(now()).toISOString(), build };
      await store.set('last-maintenance', maintenance, 30 * 86400);
    }
    const result = { at: new Date(now()).toISOString(), status: 'ok', durationMs: now() - start, ...feedback, maintenanceAt: maintenance?.at };
    await store.set('last-worker', result, 30 * 86400);
    return result;
  } catch (error) {
    await store.set('last-worker', { at: new Date(now()).toISOString(), status: 'error' }, 30 * 86400).catch(() => {});
    throw error;
  } finally { await store.update('worker-lease', old => old?.owner === owner ? { until: 0 } : old, 600); }
}
