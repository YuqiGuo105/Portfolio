// Measures the referral accept path against a running local preview (`npm run dev:talk`).
//
//   node scripts/referral-load.mjs                 300 requests, 50 at a time
//   REQUESTS=1000 CONCURRENCY=100 node scripts/referral-load.mjs
//
// Each simulated applicant does what the browser does: save the answers, upload a 60 KB PDF to the
// stand-in storage route, confirm. It then waits for the worker to drain the queue. Local only:
// the preview keeps everything in memory, sends no email and calls no model unless you started it
// with TALK_AI=1 (do not load-test with that on).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const base = process.env.BASE || 'http://127.0.0.1:3147';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local preview only');
const total = Number(process.env.REQUESTS || 300), concurrency = Number(process.env.CONCURRENCY || 50);
const pdf = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${'x'.repeat(60000)}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
const json = { origin: base, 'content-type': 'application/json' };
const timings = { save: [], upload: [], confirm: [], total: [] };
const failures = [];

async function applicant(index) {
  const key = randomUUID();
  const body = { idempotencyKey: key, name: `Load Test ${index}`, email: `load${index}@example.com`, roleTitle: 'Associate, Software Engineering',
    jobUrl: 'https://higher.gs.com/roles/123456', relationship: 'not_yet', consent: true, turnstileToken: 'local-preview',
    intro: `Load Test ${index} is a backend engineer with five years of experience building payment services in Java. At a previous company the engineer led the migration of a ledger service to Kafka, cutting settlement delay from hours to minutes, and shares on-call ownership for the service.`,
    resume: { name: 'resume.pdf', size: pdf.length, type: 'application/pdf' } };
  const t0 = performance.now();
  const saved = await fetch(`${base}/api/referral`, { method: 'POST', headers: json, body: JSON.stringify(body) });
  const ticket = await saved.json();
  if (saved.status !== 201) throw new Error(`save ${saved.status} ${ticket.code}`);
  const t1 = performance.now();
  const put = await fetch(new URL(ticket.upload.url, base), { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: pdf });
  if (!put.ok) throw new Error(`upload ${put.status}`);
  const t2 = performance.now();
  const done = await fetch(`${base}/api/referral/complete`, { method: 'POST', headers: json, body: JSON.stringify({ idempotencyKey: key }) });
  if (!done.ok) throw new Error(`confirm ${done.status}`);
  const t3 = performance.now();
  timings.save.push(t1 - t0); timings.upload.push(t2 - t1); timings.confirm.push(t3 - t2); timings.total.push(t3 - t0);
}

const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0; };
const line = (name, values) => `${name.padEnd(8)} p50 ${percentile(values, 0.5).toFixed(0).padStart(5)} ms   p95 ${percentile(values, 0.95).toFixed(0).padStart(5)} ms   max ${Math.max(0, ...values).toFixed(0).padStart(5)} ms`;

// Warm the routes once so the first compile is not measured.
await applicant(-1).catch(error => { console.error(`The preview is not answering at ${base}: ${error.message}`); process.exit(1); });
for (const key of Object.keys(timings)) timings[key].length = 0;

const started = performance.now();
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < total) { const index = next++; await applicant(index).catch(error => failures.push(error.message)); }
}));
const accepted = performance.now() - started;

let waiting = total, drained = null;
for (let attempt = 0; attempt < 240; attempt += 1) {
  const list = await (await fetch(`${base}/api/referral/preview`)).json();
  waiting = list.requests.filter(row => row.name.startsWith('Load Test') && row.state !== 'ready').length;
  if (!waiting) { drained = performance.now() - started; break; }
  await new Promise(resolve => setTimeout(resolve, 500));
}

console.log(`${total} requests, ${concurrency} at a time, against ${base} (development build)`);
console.log(`accepted ${total - failures.length}/${total} in ${(accepted / 1000).toFixed(1)} s  →  ${((total - failures.length) / (accepted / 1000)).toFixed(0)} requests/s`);
for (const [name, values] of Object.entries(timings)) console.log(line(name, values));
console.log(drained === null ? `queue not drained yet: ${waiting} still waiting` : `queue drained ${(drained / 1000).toFixed(1)} s after the first request`);
if (failures.length) { console.log(`failures: ${JSON.stringify([...new Set(failures)].slice(0, 5))}`); process.exitCode = 1; }
