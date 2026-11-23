// A read-only local run of the exact production checkout, without form-preview fixtures.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.VERCEL || process.env.K_SERVICE) throw new Error('Local recording only');
const port = Number(process.env.PORT || 3154);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');

const source = path.resolve(root, process.env.RECORDING_PUBLIC_ENV || '../Portfolio/.env');
const publicEnv = require('dotenv').parse(readFileSync(source));
const allowed = [
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_START_YEAR',
  'NEXT_PUBLIC_STORIES_ENDPOINT', 'NEXT_PUBLIC_STORIES_OWNER',
  'NEXT_PUBLIC_GITHUB_URL', 'NEXT_PUBLIC_LINKEDIN_URL', 'NEXT_PUBLIC_INSTAGRAM_URL',
  'NEXT_PUBLIC_LEETCODE_URL',
];
for (const key of Object.keys(process.env)) {
  if (/^(NEXT_PUBLIC_|SUPABASE_|TALK_|REFERRAL_|GOOGLE_|GEMINI_|QWEN_|OPENAI_|EMAIL_|SMTP_|CRON_|DISCOVERY_)/.test(key)) delete process.env[key];
}
for (const key of allowed) if (publicEnv[key]) process.env[key] = publicEnv[key];
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  throw new Error('Public content configuration is missing');
}
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (key.startsWith('eyJ') && JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role !== 'anon') {
  throw new Error('Recording must use the public anonymous key');
}
// These public switches match the active production deployment. No model credentials are loaded.
process.env.DISCOVERY_ENABLED = '1';
process.env.NEXT_PUBLIC_DISCOVERY_ENABLED = '1';
process.env.NEXT_PUBLIC_VOICE_ENABLED = 'true';
process.env.SUPABASE_SERVICE_ROLE_KEY = key;
process.env.NODE_ENV = 'development';
process.env.MEDIA_LOCAL_REVIEW = '1';
process.env.NEXT_PUBLIC_MEDIA_PIPELINE = '1';

const app = require('next')({ dev: true, dir: root, hostname: '127.0.0.1', port });
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!loopback || !/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) {
    res.writeHead(403); res.end('Local recording only'); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)
    || (/^\/(?:admin|mcp|oauth)(?:\/|$)/.test(url.pathname) && url.pathname !== '/admin/media-preview')
    || /^\/api\/(?:admin|cron|referral|contact|agent|voice|rag|writer)(?:\/|$)/.test(url.pathname)) {
    res.writeHead(403); res.end('Read-only recording: this action is not enabled'); return;
  }
  handler(req, res);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Production-matched local page: http://127.0.0.1:${port}/`);
  console.log('Public content only; no fixture employer, no email, no model calls, no submissions.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(); app.close().then(() => process.exit(0));
});
