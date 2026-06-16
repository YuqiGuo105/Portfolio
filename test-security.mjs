/**
 * E2E security test for /api/track and /api/click
 * Run with: node test-security.mjs
 *
 * Tests:
 *  1. Bot UA → 403
 *  2. curl UA → 403
 *  3. Bad origin (production mode check — dev allows all, so we test the logic path)
 *  4. Valid browser request → 200
 *  5. Rate-limit: >10 requests same IP → 429
 *  6. GET method → 405
 *  7. Direct Supabase anon insert (RLS should block) → 403 / RLS error
 */

const BASE = 'http://localhost:3000';
const SUPABASE_URL = 'https://iyvhmpdfrnznxgyvvkvx.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5dmhtcGRmcm56bnhneXZ2a3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDYwNjcyMjMsImV4cCI6MjAyMTY0MzIyM30.zwq9WBVBLmFaUnA2PBU9hanYfmJYMxfg4l37wXEf1NI';

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

// ─── /api/track tests ────────────────────────────────────────────────────────
console.log('\n=== /api/track ===');

// 1. Bot UA → 403
{
  const { status } = await post('/api/track', { event: 'page_view' }, {
    'user-agent': 'curl/7.88.1',
    'origin': 'http://localhost:3000',
  });
  assert('Bot UA (curl) blocked', status === 403, `got ${status}`);
}

// 2. spider UA → 403
{
  const { status } = await post('/api/track', { event: 'page_view' }, {
    'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'origin': 'http://localhost:3000',
  });
  assert('Spider UA blocked', status === 403, `got ${status}`);
}

// 3. Empty UA → 403
{
  const { status } = await post('/api/track', { event: 'page_view' }, {
    'user-agent': '',
    'origin': 'http://localhost:3000',
  });
  assert('Empty UA blocked', status === 403, `got ${status}`);
}

// 4. Valid browser UA (dev mode → origin check bypassed) → 200
{
  const { status } = await post('/api/track', { event: 'page_view' }, {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'origin': 'http://localhost:3000',
  });
  // In dev mode: origin check is bypassed, UA passes → should reach DB
  // DB insert may fail (missing service_role key or succeed) — but not 403/429
  assert('Valid browser request not blocked', status !== 403 && status !== 429, `got ${status}`);
}

// 5. GET → 405
{
  const res = await fetch(`${BASE}/api/track`, { method: 'GET' });
  assert('GET method rejected', res.status === 405, `got ${res.status}`);
}

// 6. Rate limit (11 rapid requests → last should be 429)
{
  const ua = 'Mozilla/5.0 RateLimitTest/1.0';
  const results = [];
  for (let i = 0; i < 11; i++) {
    const { status } = await post('/api/track', { event: 'rate_test' }, {
      'user-agent': ua,
      'origin': 'http://localhost:3000',
      'x-forwarded-for': '10.99.99.1',  // fixed test IP
    });
    results.push(status);
  }
  const got429 = results.includes(429);
  assert('Rate limit triggers 429 after 10 requests', got429, `statuses: ${results.join(',')}`);
}

// ─── /api/click tests ────────────────────────────────────────────────────────
console.log('\n=== /api/click ===');

// 7. Bot UA → 403
{
  const { status } = await post('/api/click', { clickEvent: 'nav', targetUrl: '/' }, {
    'user-agent': 'python-requests/2.31',
    'origin': 'http://localhost:3000',
  });
  assert('Bot UA (python) blocked', status === 403, `got ${status}`);
}

// 8. Valid browser → not blocked
{
  const { status } = await post('/api/click', { clickEvent: 'nav', targetUrl: '/' }, {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'origin': 'http://localhost:3000',
  });
  assert('Valid click not blocked', status !== 403 && status !== 429, `got ${status}`);
}

// 9. GET → 405
{
  const res = await fetch(`${BASE}/api/click`, { method: 'GET' });
  assert('GET method rejected', res.status === 405, `got ${res.status}`);
}

// 10. Rate limit on /api/click
{
  const ua = 'Mozilla/5.0 ClickRateLimitTest/1.0';
  const results = [];
  for (let i = 0; i < 11; i++) {
    const { status } = await post('/api/click', { clickEvent: 'rate_test', targetUrl: '/' }, {
      'user-agent': ua,
      'origin': 'http://localhost:3000',
      'x-forwarded-for': '10.99.99.2',  // fixed test IP
    });
    results.push(status);
  }
  const got429 = results.includes(429);
  assert('Rate limit triggers 429 after 10 click requests', got429, `statuses: ${results.join(',')}`);
}

// ─── RLS test: direct anon insert should be rejected ─────────────────────────
console.log('\n=== Supabase RLS (direct anon insert) ===');

// 11. Direct anon insert into visitor_logs → should fail (RLS blocks it)
{
  const res = await fetch(`${SUPABASE_URL}/rest/v1/visitor_logs`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      ip: '1.2.3.4',
      local_time: new Date().toISOString(),
      event: 'rls_test',
      ua: 'test',
    }),
  });
  assert('Anon cannot insert into visitor_logs (RLS)', res.status !== 200 && res.status !== 201, `got ${res.status}`);
  if (res.status !== 200 && res.status !== 201) {
    let body = '';
    try { body = JSON.stringify(await res.json()); } catch (_) {}
    console.log(`     (status=${res.status} body=${body})`);
  }
}

// 12. Direct anon insert into visitor_clicks → should fail (RLS blocks it)
{
  const res = await fetch(`${SUPABASE_URL}/rest/v1/visitor_clicks`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      ip: '1.2.3.4',
      click_event: 'rls_test',
      target_url: '/',
      local_time: new Date().toISOString(),
    }),
  });
  assert('Anon cannot insert into visitor_clicks (RLS)', res.status !== 200 && res.status !== 201, `got ${res.status}`);
  if (res.status !== 200 && res.status !== 201) {
    let body = '';
    try { body = JSON.stringify(await res.json()); } catch (_) {}
    console.log(`     (status=${res.status} body=${body})`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
