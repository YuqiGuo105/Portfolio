/**
 * Optional read-only production permission check. Never inserts test visitors.
 * Supply SUPABASE_URL and SUPABASE_ANON_KEY explicitly.
 * The default CI security suite uses local fixtures, not a production database.
 */
import assert from 'node:assert/strict';

const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
assert.ok(base && key, 'Set SUPABASE_URL and SUPABASE_ANON_KEY explicitly.');
const url = new URL(base);
assert.ok(url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.username + url.password + url.search + url.hash, '');
const headers = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
async function probe(table) {
  const endpoint = new URL(`/rest/v1/${encodeURIComponent(table)}`, url);
  endpoint.searchParams.set('select', '*');
  endpoint.searchParams.set('limit', '0');
  return fetch(endpoint, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
}

// A bad key or broken API must fail the test, not look like successful protection.
assert.equal((await probe('Projects')).status, 200, 'Public content baseline must be reachable.');
for (const table of ['admin_users', 'Chat', 'chat_history', 'conversation', 'message',
  'agent_run', 'agent_step', 'tool_call_log', 'content_admin_audit_logs', 'behavior_events']) {
  const response = await probe(table);
  const body = await response.json();
  assert.ok([401, 403].includes(response.status) && body.code === '42501',
    `Expected permission denial for ${table}; received HTTP ${response.status}.`);
  console.log(`PASS: browser role denied on ${table}`);
}
