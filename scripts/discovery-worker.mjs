import { Kafka, logLevel } from 'kafkajs';
import { createClient } from '@supabase/supabase-js';
import { discoveryRuntime } from '../src/lib/discovery/runtime.mjs';
import { consumeWindow, kafkaOptions, runScheduled } from '../src/lib/discovery/worker.mjs';

if (process.env.DISCOVERY_ENABLED !== '1' || process.env.DISCOVERY_PREVIEW === '1') throw new Error('Production discovery configuration required');
const runtime = discoveryRuntime();
const kafka = new Kafka({ ...kafkaOptions(process.env), logLevel: logLevel.NOTHING });
const consumer = kafka.consumer({ groupId: 'portfolio-discovery-v1', allowAutoTopicCreation: false, sessionTimeout: 10000, heartbeatInterval: 2500 });
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
try {
  const result = await runScheduled({ ...runtime, forceRebuild: process.argv.includes('--rebuild'),
    consume: () => consumeWindow(consumer, runtime),
    cleanup: async () => {
      const { error } = await client.from('content_review_queue').delete().lt('expires_at', new Date().toISOString()).abortSignal(AbortSignal.timeout(5000));
      if (error) throw new Error('Review retention cleanup failed');
    },
  });
  console.info(JSON.stringify({ event: 'discovery_job', ...result }));
} catch {
  console.error(JSON.stringify({ event: 'discovery_job_failed' }));
  process.exitCode = 1;
} finally { await runtime.store.close(); }
