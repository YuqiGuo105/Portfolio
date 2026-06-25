/**
 * Singleton Kafka producer for serverless use.
 *
 * KafkaJS keeps its TCP connection alive across invocations within the same
 * Node.js process (warm lambda). On cold start we connect lazily and cache
 * the producer. If the connect or produce fails we NEVER throw — tracking
 * is best-effort and must not degrade the user experience.
 *
 * Required environment variables (Aiven SASL_SSL / SCRAM-SHA-256):
 *   KAFKA_BROKERS         e.g. "kafka-host:19092"
 *   KAFKA_USERNAME        Aiven service user
 *   KAFKA_PASSWORD        Aiven service password
 *   KAFKA_CA_CERT         PEM text (multiline ok — \n preserved by Vercel)
 *   KAFKA_TOPIC_RAW       (optional) override topic name, default analytics.raw.events
 */

import { Kafka, logLevel } from 'kafkajs';

const TOPIC = process.env.KAFKA_TOPIC_RAW || 'analytics.raw.events';

let producerInstance = null;
let connectPromise = null;

function buildKafka() {
  const brokers = (process.env.KAFKA_BROKERS || '').split(',').map(b => b.trim()).filter(Boolean);
  if (!brokers.length) return null;

  const ssl = process.env.KAFKA_CA_CERT
    ? { ca: process.env.KAFKA_CA_CERT }
    : true; // trust system CAs when no explicit cert given

  return new Kafka({
    clientId: 'portfolio-track',
    brokers,
    ssl,
    sasl: {
      mechanism: (process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256').toLowerCase(),
      username: process.env.KAFKA_USERNAME || '',
      password: process.env.KAFKA_PASSWORD || '',
    },
    // Keep logs quiet in prod; only surface errors.
    logLevel: logLevel.ERROR,
    // Short connect timeout so a cold-Kafka doesn't stall the response.
    connectionTimeout: 5000,
    requestTimeout: 8000,
    retry: { retries: 2 },
  });
}

/**
 * Returns a connected producer, or null if Kafka is not configured / unreachable.
 * Caches the connection across warm invocations.
 */
async function getProducer() {
  if (producerInstance) return producerInstance;

  // Deduplicate concurrent cold-start calls.
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const kafka = buildKafka();
    if (!kafka) return null; // not configured
    const p = kafka.producer({ allowAutoTopicCreation: false });
    await p.connect();
    producerInstance = p;
    return p;
  })().catch(err => {
    // Reset so the next request retries.
    connectPromise = null;
    console.warn('[KafkaProducer] connect failed (best-effort):', err.message);
    return null;
  });

  return connectPromise;
}

/**
 * Produce a single RawEvent JSON message.
 * @param {object} rawEvent  — plain object matching the RawEvent wire format.
 * @returns {Promise<boolean>} true if produced, false if skipped/failed.
 */
export async function produceRawEvent(rawEvent) {
  try {
    const producer = await getProducer();
    if (!producer) return false; // Kafka not configured or unreachable

    // Partition key = siteId so all events for a tenant land on the same shard.
    const key = rawEvent.siteId || 'yuqi.site';
    const value = JSON.stringify(rawEvent);

    await producer.send({
      topic: TOPIC,
      messages: [{ key, value }],
    });
    return true;
  } catch (err) {
    console.warn('[KafkaProducer] produce failed (best-effort):', err.message);
    // Reset connection so next request attempts reconnect.
    producerInstance = null;
    connectPromise = null;
    return false;
  }
}
