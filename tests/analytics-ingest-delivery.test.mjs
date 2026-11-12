import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { isPrivateAnalyticsEvent, publicOutboundTarget } from '../src/lib/analyticsPagePolicy.mjs';

function fixture({ kafka = true, configured = true, storageError = false } = {}) {
  const events = [], rows = new Map(), writes = [];
  const source = readFileSync(new URL('../pages/api/track.js', import.meta.url), 'utf8')
    .replace(/^import .+;\r?$/gm, '').replace(/export const config =/, 'const config =')
    .replace('export default async function handler', 'return async function handler');
  const supabase = { from: table => ({ upsert: async (row, options) => {
    assert.equal(table, 'analytics_event_outbox');
    assert.deepEqual(options, { onConflict: 'event_id', ignoreDuplicates: true });
    writes.push(row);
    if (storageError) return { error: { code: 'UNAVAILABLE' } };
    if (!rows.has(row.event_id)) rows.set(row.event_id, row);
    return { error: null };
  } }) };
  const serve = new Function('crypto', 'process', 'produceRawEvent', 'supabaseServer',
    'isPrivateAnalyticsEvent', 'publicOutboundTarget', `
    const isLocalAnalyticsRequest = () => false;
    const isLocalAnalyticsEvent = () => false;
    const allowAnalyticsRequest = async () => true;
    const isRateLimited = async () => false;
    const createRecaptchaAssessment = async () => ({ status: 'SKIPPED' });
    const assessmentProperties = () => ({ botClassification: 'unknown' });
    const uuidv7 = () => crypto.randomUUID();
    ${source}
  `)(crypto, { env: { NODE_ENV: 'production',
    ...(configured ? { NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'unit-test-placeholder' } : {}) } },
  async event => { events.push(event); return kafka; }, supabase, isPrivateAnalyticsEvent, publicOutboundTarget);
  return { serve, events, rows, writes };
}
const body = () => ({ eventId: crypto.randomUUID(), event: 'read_progress', schemaVersion: 2,
  localTime: new Date().toISOString(), page: '/work-single/project-a', consentState: 'granted',
  sessionId: 'session-example-1234', anonymousId: 'anonymous-example-1234', properties: { progressPercent: 75 } });
async function submit(f, payload, headers = {}) {
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end() {} };
  await f.serve({ method: 'POST', body: payload, headers: { origin: 'https://www.yuqi.site',
    'user-agent': 'Chrome', 'x-forwarded-for': '192.0.2.1', ...headers } }, res);
  return res;
}

test('retries retain the backend unique key despite IP changes and scope it to the original session', async () => {
  const f = fixture(), payload = body();
  for (const ip of ['192.0.2.1', '192.0.2.2']) {
    const res = await submit(f, payload, { 'x-forwarded-for': ip });
    assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { ok: true, eventId: payload.eventId, via: 'kafka' });
  }
  assert.equal(f.events[0].eventId, f.events[1].eventId);
  assert.equal(f.events[0].eventTime, f.events[1].eventTime);
  assert.match(f.events[0].eventId, /^browser:[0-9a-f]{64}$/);
  await submit(f, { ...payload, sessionId: 'different-session-1234' });
  assert.notEqual(f.events[0].eventId, f.events[2].eventId);
  assert.equal(f.writes.length, 0);
});

test('Kafka failure durably saves the entire event, not a partial legacy visitor row', async () => {
  const f = fixture({ kafka: false }), payload = body();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await submit(f, payload);
    assert.equal(res.statusCode, 202); assert.equal(res.body.eventId, payload.eventId);
    assert.equal(res.body.via, 'outbox');
  }
  assert.equal(f.rows.size, 1);
  const stored = [...f.rows.values()][0];
  assert.equal(stored.event_id, f.events[0].eventId);
  assert.deepEqual(stored.payload, f.events[0]);
  assert.equal(stored.payload.sessionId, payload.sessionId);
  assert.equal(stored.payload.pageUrl, payload.page);
  assert.equal(stored.payload.properties.progressPercent, 75);
  assert.equal(stored.partition_key, 'yuqi.site');
});

test('neither unavailable storage nor a missing fallback configuration returns a success ACK', async () => {
  for (const options of [{ configured: false }, { storageError: true }]) {
    const res = await submit(fixture({ kafka: false, ...options }), body());
    assert.equal(res.statusCode, 503); assert.equal(res.body.ok, false);
  }
});

test('malformed client IDs are rejected, while old clients remain compatible', async () => {
  const f = fixture();
  for (const eventId of ['', {}, 'short', 'x'.repeat(101), 'private/id']) {
    assert.equal((await submit(f, { ...body(), eventId })).statusCode, 400);
  }
  assert.equal(f.events.length, 0);
  const old = body(); delete old.eventId;
  assert.equal((await submit(f, old)).statusCode, 200);
  assert.equal(f.events.length, 1);
});

test('privacy opt-out and private pages never enter either durable destination', async () => {
  const f = fixture({ kafka: false });
  for (const patch of [{ consentState: 'denied' }, { page: '/admin/visitors' }]) {
    assert.equal((await submit(f, { ...body(), ...patch })).statusCode, 204);
  }
  assert.equal(f.events.length, 0); assert.equal(f.rows.size, 0);
});
