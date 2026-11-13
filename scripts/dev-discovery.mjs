import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('Local preview only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3146);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
if (process.argv.includes('--detach')) {
  const log = openSync(`/private/tmp/portfolio-discovery-${port}.log`, 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: root, env: process.env, detached: true, stdio: ['ignore', log, log] });
  closeSync(log); child.unref(); console.log(`Local preview PID ${child.pid}: http://127.0.0.1:${port}/admin/discovery-preview`);
} else {
  if (process.env.DISCOVERY_ENV_FILE) {
    const env = require('dotenv').parse(readFileSync(process.env.DISCOVERY_ENV_FILE));
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) process.env[key] ||= env[key];
    // Public page reads use anon RLS; the real service key is scoped to the spend guard only.
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (process.env.DISCOVERY_AI_ENABLED === '1') {
      process.env.DISCOVERY_GOOGLE_API_KEY ||= env.GEMINI_API_KEY;
      process.env.AI_SPEND_SERVICE_ROLE_KEY ||= env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.AI_SPEND_SUPABASE_URL ||= env.NEXT_PUBLIC_SUPABASE_URL;
    }
  }
  process.env.DISCOVERY_ENABLED = '1'; process.env.NEXT_PUBLIC_DISCOVERY_ENABLED = '1'; process.env.DISCOVERY_PREVIEW = '1';
  const app = require('next')({ dev: true, dir: root, conf: { distDir: '.next-discovery' } });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403); res.end('Local preview only'); return; }
    if (req.method !== 'GET' && !url.pathname.startsWith('/api/discovery/')) { res.writeHead(403); res.end('Local read-only preview'); return; }
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/discovery/') && url.pathname !== '/api/search') { res.writeHead(404); res.end('Preview route unavailable'); return; }
    handler(req, res);
  });
  server.listen(port, '127.0.0.1', () => console.log(`Discovery preview ready: http://127.0.0.1:${port}/admin/discovery-preview`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); app.close().then(() => process.exit(0)); });
}
