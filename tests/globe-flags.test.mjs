import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_EMOJIS, FlagError, cleanMessage, createFlagsHandler, publicFlag, validateFlag } from '../src/lib/globeFlags.mjs';
import { cleanPeer, requestGeo } from '../src/lib/requestGeo.mjs';

const geo = { lat: 31.2, lng: 121.5, city: 'Shanghai', country: 'CN' };

function mockRes() {
  return {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const post = (body, headers = {}) => ({ method: 'POST', body, headers: { 'content-type': 'application/json', host: 'www.yuqi.site', origin: 'https://www.yuqi.site', ...headers }, socket: { remoteAddress: '1.2.3.4' } });

test('edge geo headers become a rounded, city-level location; missing headers mean unknown', () => {
  assert.deepEqual(requestGeo({ 'x-vercel-ip-latitude': '31.2304', 'x-vercel-ip-longitude': '121.4737', 'x-vercel-ip-city': 'Shanghai', 'x-vercel-ip-country': 'cn' }),
    { lat: 31.2, lng: 121.5, city: 'Shanghai', country: 'CN' });
  assert.equal(requestGeo({}), null);
  assert.equal(requestGeo({ 'x-vercel-ip-latitude': '91', 'x-vercel-ip-longitude': '0' }), null);
  assert.equal(requestGeo({ 'x-vercel-ip-latitude': '1', 'x-vercel-ip-longitude': '2', 'x-vercel-ip-city': 'S%C3%A3o%20Paulo<script>' }).city, 'São Paulo');
});

test('emoji-only flags are approved at once and use the visitor city; notes wait for review', () => {
  assert.deepEqual(validateFlag({ emoji: '🚩' }, geo), { lat: 31.2, lng: 121.5, emoji: '🚩', message: null, city: 'Shanghai', country: 'CN', status: 'approved' });
  const noted = validateFlag({ emoji: '👋', message: '  Hello   from Shanghai ' }, geo);
  assert.equal(noted.status, 'pending');
  assert.equal(noted.message, 'Hello from Shanghai');
});

test('a spot picked on the globe is rounded and does not carry the visitor city', () => {
  const flag = validateFlag({ emoji: '🐼', lat: 48.85661, lng: 2.35222 }, geo);
  assert.deepEqual([flag.lat, flag.lng, flag.city, flag.country], [48.86, 2.35, null, null]);
  assert.throws(() => validateFlag({ emoji: '🐼', lat: 10 }, geo), { code: 'invalid_location' });
  assert.throws(() => validateFlag({ emoji: '🐼', lat: 100, lng: 0 }, geo), { code: 'invalid_location' });
  assert.throws(() => validateFlag({ emoji: '🐼', lat: true, lng: 0 }, geo), { code: 'invalid_location' });
  assert.throws(() => validateFlag({ emoji: '🐼' }, null), { code: 'location_required' });
});

test('only the palette emojis, known fields, and an empty honeypot are accepted', () => {
  assert.throws(() => validateFlag({ emoji: '💩' }, geo), { code: 'invalid_emoji' });
  assert.throws(() => validateFlag({ emoji: '🚩', status: 'approved' }, geo), { code: 'invalid_body' });
  assert.throws(() => validateFlag({ emoji: '🚩', website: 'spam' }, geo), { code: 'rejected' });
  assert.throws(() => validateFlag([], geo), { code: 'invalid_body' });
  assert.equal(FLAG_EMOJIS.length, 8);
});

test('notes cannot carry links, emails, handles, phone numbers, markup or hidden characters', () => {
  for (const text of ['visit https://x.io', 'www.spam.com', 'buy at cheap.xyz', 'mail me a@b.co', 'follow @someone', 'call 555 123 4567']) {
    assert.throws(() => cleanMessage(text), { code: 'message_not_allowed' }, text);
  }
  assert.equal(cleanMessage('<b>hi</b>‮ there​'), 'bhi/b there');
  assert.throws(() => cleanMessage('x'.repeat(61)), { code: 'message_too_long' });
  assert.equal(cleanMessage('来自上海的问候 👋'), '来自上海的问候 👋');
  assert.throws(() => cleanMessage(42), FlagError);
});

test('POST stores the flag, rate-limits per visitor, and never trusts a status from the client', async () => {
  const inserted = [];
  const store = () => ({ insert: async (row) => { inserted.push(row); return { id: 'f1', created_at: 'now', ...row }; } });
  let calls = 0;
  const handler = createFlagsHandler({ store, isRateLimited: async () => ++calls > 2, geoOf: () => geo });
  const res = mockRes();
  await handler(post({ emoji: '🚩' }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'approved');
  assert.equal(res.body.flag.city, 'Shanghai');
  assert.equal(inserted[0].status, 'approved');
  assert.ok(!('ip' in inserted[0]));

  const limited = mockRes();
  await handler(post({ emoji: '🚩' }), limited);
  assert.equal(limited.statusCode, 429);
});

test('POST rejects cross-site and non-JSON requests; a pending note is not echoed back', async () => {
  const store = () => ({ insert: async (row) => ({ id: 'f2', ...row }) });
  const handler = createFlagsHandler({ store, isRateLimited: async () => false, geoOf: () => geo });
  const cross = mockRes();
  await handler(post({ emoji: '🚩' }, { origin: 'https://evil.example' }), cross);
  assert.equal(cross.statusCode, 403);
  const form = mockRes();
  await handler(post({ emoji: '🚩' }, { 'content-type': 'application/x-www-form-urlencoded' }), form);
  assert.equal(form.statusCode, 415);
  const pending = mockRes();
  await handler(post({ emoji: '👋', message: 'hello' }), pending);
  assert.equal(pending.statusCode, 201);
  assert.deepEqual(pending.body, { status: 'pending', flag: null });
});

test('GET lists only approved public fields, and reports a missing table as disabled', async () => {
  const handler = createFlagsHandler({
    store: () => ({ listApproved: async () => [{ id: 1, lat: 1, lng: 2, emoji: '🚩', message: 'hi', city: 'X', country: 'US', created_at: 't', ip_hash: 'secret' }, { id: 2, lat: 'x', lng: 2, emoji: '🚩' }] }),
    isRateLimited: async () => false,
  });
  const res = mockRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.flags.length, 1);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
  assert.match(res.headers['cache-control'], /s-maxage/);

  const off = createFlagsHandler({ store: () => ({ listApproved: async () => null }), isRateLimited: async () => false });
  const res2 = mockRes();
  await off({ method: 'GET', headers: {} }, res2);
  assert.deepEqual(res2.body, { enabled: false, flags: [] });
  assert.equal(publicFlag({ id: 3, lat: 0, lng: 0, emoji: 'nope' }), null);
});

test('presence from other browsers is reduced to rounded, bounded city fields', () => {
  assert.deepEqual(cleanPeer({ lat: 35.6895, lng: 139.6917, city: 'Tokyo', country: 'JP', extra: '<img>' }), { lat: 35.7, lng: 139.7, city: 'Tokyo', country: 'JP' });
  assert.equal(cleanPeer({ lat: 'a', lng: 1 }), null);
  assert.equal(cleanPeer({ lat: 10, lng: 999 }), null);
  assert.equal(cleanPeer({ lat: 1, lng: 1, city: 'x'.repeat(200) }).city.length, 60);
});
