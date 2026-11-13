import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.DISCOVERY_ENV_FILE) {
  const env = require('dotenv').parse(readFileSync(process.env.DISCOVERY_ENV_FILE));
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) process.env[key] = env[key];
}
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
process.env.DISCOVERY_ENABLED = '1';
process.env.NEXT_PUBLIC_DISCOVERY_ENABLED = '1';
process.env.NEXT_TELEMETRY_DISABLED = '1';
// Use a file entrypoint: Node eval arguments can be inherited by build workers.
await require('next/dist/build').default(root, {
  ...require('../next.config.js'),
  distDir: '.next-discovery-build',
  experimental: { cpus: 2, workerThreads: false },
});
