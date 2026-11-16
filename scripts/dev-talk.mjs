// Local preview of the Talk page: the message form, the referral request form and the review list.
//
//   npm run dev:talk                       → http://127.0.0.1:3147/talk
//   TALK_COMPANY="Northwind Labs" npm run dev:talk     the site as it would be at another employer
//   TALK_COMPANY=none npm run dev:talk                 the site between jobs (referrals closed)
//   TALK_ENV_FILE=../Portfolio/.env.local npm run dev:talk          site content from Supabase (read-only, anon key)
//   TALK_AI=1 TALK_ENV_FILE=../Portfolio/.env.local npm run dev:talk   real AI screening, charged to the shared monthly ledger
//
// Nothing here sends email or writes to the database or to storage: requests and résumé files are
// kept in memory, and the emails that would have been sent are listed on /admin/referrals-preview.
// Bot verification and rate limits are skipped.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('Local preview only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3147);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');

let ai = false;
if (process.env.TALK_ENV_FILE) {
  const env = require('dotenv').parse(readFileSync(path.resolve(root, process.env.TALK_ENV_FILE)));
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_START_YEAR']) process.env[key] ||= env[key];
  // Pages read through anonymous row-level security; the real service key is used by the spend guard only.
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (process.env.TALK_AI === '1' && env.GEMINI_API_KEY && env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.REFERRAL_GOOGLE_API_KEY ||= env.GEMINI_API_KEY;
    process.env.AI_SPEND_SERVICE_ROLE_KEY ||= env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.AI_SPEND_SUPABASE_URL ||= env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.REFERRAL_AI_ENABLED = '1';
    ai = true;
  }
}
if (!ai) process.env.REFERRAL_AI_ENABLED = '0';
// A custom server does not set this by itself, and the origin check for localhost depends on it.
process.env.NODE_ENV = 'development';
process.env.TALK_PREVIEW = '1';
process.env.NEXT_PUBLIC_TALK_PREVIEW = '1';
// The worker endpoint is reachable only with this secret, new on every start.
process.env.CRON_SECRET = require('node:crypto').randomBytes(24).toString('hex');
// The preview never reaches the email account, whatever the environment file contains.
for (const key of ['EMAIL_USER', 'EMAIL_PASS', 'EMAIL_TO']) delete process.env[key];

const WRITABLE = new Set(['/api/contact', '/api/referral', '/api/referral/complete', '/api/referral/preview', '/api/referral/preview-upload', '/api/referral/preview-history', '/api/cron/referral-worker']);
// hostname and port let the middleware on "/" build absolute URLs under a custom server.
const app = require('next')({ dev: true, dir: root, hostname: '127.0.0.1', port, conf: { ...require('../next.config.js'), distDir: '.next-talk' } });
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403); res.end('Local preview only'); return; }
  // Read-only apart from the forms being previewed, which write to memory.
  if (!['GET', 'HEAD'].includes(req.method) && !WRITABLE.has(url.pathname)) { res.writeHead(403); res.end('Switched off in the local preview'); return; }
  handler(req, res);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Talk preview ready:  http://127.0.0.1:${port}/talk`);
  console.log(`Home page section:   http://127.0.0.1:${port}/#contact-section`);
  console.log(`Review list:         http://127.0.0.1:${port}/admin/referrals-preview`);
  console.log(`Work history:        http://127.0.0.1:${port}/admin/experience-preview   (try "I changed jobs" here)`);
  console.log(ai ? 'AI screening: ON (real model calls, charged to the shared monthly ledger).' : 'AI screening: off (completeness check only). Set TALK_AI=1 with TALK_ENV_FILE to try the real model.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); app.close().then(() => process.exit(0)); });
