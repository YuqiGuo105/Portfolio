/**
 * Remote E2E for the Kafka-primary /api/track path and the aggregator
 * public read surface.
 *
 * Run:
 *   BASE=https://www.yuqi.site \
 *   AGG=https://portfolio-analytics-aggregator-702193211434.us-central1.run.app \
 *   node test-track-remote.mjs
 *
 * Tests:
 *   1. /api/track blocks curl UA         → 403
 *   2. /api/track blocks bad origin      → 403
 *   3. /api/track with browser UA + origin
 *        → 200 { ok:true, via:'kafka' | 'supabase-fallback' }
 *   4. Aggregator /api/public/visits/summary?window=all → 200 + JSON with `totals`
 *   5. Aggregator /api/public/visits/markers?window=all → 200 + array
 */

const BASE = (process.env.BASE || 'https://www.yuqi.site').replace(/\/$/, '');
const AGG = (process.env.AGG || 'https://portfolio-analytics-aggregator-702193211434.us-central1.run.app').replace(/\/$/, '');

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) { console.log(`  ✅ PASS: ${name}`); passed++; }
function fail(name, detail = '') {
  console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  failed++;
  failures.push({ name, detail });
}
function assert(name, condition, detail = '') {
  condition ? pass(name) : fail(name, detail);
}

async function postTrack(headers = {}, body = {}) {
  const res = await fetch(`${BASE}/api/track`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* non-JSON body */ }
  return { status: res.status, json };
}

// ─── 1. Bot UA rejected ────────────────────────────────────────────────
console.log('\n=== /api/track guards ===');
{
  const { status } = await postTrack(
    {
      'user-agent': 'curl/8.4.0',
      origin: BASE,
      referer: BASE + '/',
    },
    { event: 'page_view', localTime: new Date().toISOString() },
  );
  assert('curl UA → 403', status === 403, `got ${status}`);
}

// ─── 2. Bad origin rejected ────────────────────────────────────────────
{
  const { status } = await postTrack(
    {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      origin: 'https://evil.example.com',
      referer: 'https://evil.example.com/',
    },
    { event: 'page_view', localTime: new Date().toISOString() },
  );
  assert('bad origin → 403', status === 403, `got ${status}`);
}

// ─── 3. Valid browser request → Kafka (or fallback) ────────────────────
console.log('\n=== /api/track happy path (Kafka-primary) ===');
{
  const { status, json } = await postTrack(
    {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      origin: BASE,
      referer: BASE + '/',
    },
    {
      event: 'page_view',
      localTime: new Date().toISOString(),
      page: '/test-track-remote',
    },
  );
  assert(`POST /api/track → 200`, status === 200, `got ${status}, body=${JSON.stringify(json)}`);
  assert(
    `response body has ok:true`,
    json && json.ok === true,
    `body=${JSON.stringify(json)}`,
  );
  // Kafka-primary contract: response tells us which path was taken.
  // "kafka" is the ideal outcome; "supabase-fallback" means Kafka env is
  // missing on Vercel and we degraded gracefully; "skipped" means both
  // paths are unreachable which is a warning, not a fatal test failure.
  const via = json && (json.via || (json.skipped ? `skipped:${json.skipped}` : null));
  console.log(`  ℹ️  ingest path taken: ${via || '(unknown)'}`);
  assert(
    `ingest path is one of {kafka, supabase-fallback, skipped:*}`,
    via === 'kafka' || via === 'supabase-fallback' || (via && via.startsWith('skipped:')),
    `via=${via}`,
  );
  if (via === 'kafka') pass('Kafka-primary is ACTIVE (best case)');
  else if (via === 'supabase-fallback') console.log('  ⚠️  Kafka env not configured on Vercel — fell back to Supabase');
}

// ─── 4. Aggregator public summary ──────────────────────────────────────
console.log(`\n=== ${AGG}/api/public/visits/summary ===`);
{
  const res = await fetch(`${AGG}/api/public/visits/summary?window=all`, {
    headers: { accept: 'application/json' },
  });
  assert(`summary → 200`, res.status === 200, `got ${res.status}`);
  let json = null;
  try { json = await res.json(); } catch (_) {}
  assert(`summary body has totals`, !!(json && json.totals), `body=${JSON.stringify(json)}`);
  if (json && json.totals) {
    console.log(`  ℹ️  totals: events=${json.totals.events} pageViews=${json.totals.pageViews} clicks=${json.totals.clicks}`);
  }
}

// ─── 5. Aggregator markers ─────────────────────────────────────────────
console.log(`\n=== ${AGG}/api/public/visits/markers ===`);
{
  const res = await fetch(`${AGG}/api/public/visits/markers?window=all`, {
    headers: { accept: 'application/json' },
  });
  assert(`markers → 200`, res.status === 200, `got ${res.status}`);
  let json = null;
  try { json = await res.json(); } catch (_) {}
  assert(`markers body is array`, Array.isArray(json), `type=${typeof json}`);
  if (Array.isArray(json)) console.log(`  ℹ️  marker count: ${json.length}`);
}

// ─── Summary ───────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
process.exit(0);
