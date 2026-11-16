import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, admissionSettings, applyAdmission, createAdmission, memoryAdmissionStore } from '../src/lib/chat/admission.mjs';

const T0 = Date.parse('2026-11-16T12:00:00Z');
const cfg = (overrides = {}) => ({ ...DEFAULTS, capacity: 2, sessionSeconds: 600, sessionMessages: 5, dailyMessages: 100, queueLimit: 3, ...overrides });
// A little world: a state, a clock, and people doing things.
function world(settings = cfg()) {
  let state = null, now = T0;
  const act = (id, action = 'enter', ip = `net-${id}`) => { const out = applyAdmission(state, { now, id, ip, action }, settings); state = out.state; return out.result; };
  return { act, tick: seconds => { now += seconds * 1000; }, get state() { return state; }, get now() { return now; } };
}

test('places are given in arrival order; later arrivals wait in line and see who is ahead', () => {
  const w = world();
  assert.deepEqual(w.act('ann'), { status: 'active', left: 5, seconds: 600 });
  assert.equal(w.act('bob').status, 'active');
  assert.deepEqual(w.act('cat'), { status: 'queued', position: 1, ahead: 0, eta: 150, allowed: false });
  assert.deepEqual(w.act('dan'), { status: 'queued', position: 2, ahead: 1, eta: 300, allowed: false });
  assert.equal(w.act('ann').status, 'active', 'coming back does not cost a second place');
  assert.equal(w.state.active.length, 2);
  // Someone who arrives while people are waiting does not jump ahead, even if they send a message straight away.
  const eve = w.act('eve', 'message');
  assert.equal(eve.allowed, false); assert.equal(eve.position, 3);
});

test('when a place frees up the head of the line gets it, not whoever asks next', () => {
  const w = world();
  w.act('ann'); w.act('bob'); w.act('cat'); w.act('dan');
  w.act('ann', 'leave');
  assert.equal(w.act('zed').status, 'queued', 'a newcomer still waits');
  assert.equal(w.act('cat').status, 'active', 'cat was first in line');
  assert.deepEqual(w.act('dan').position, 1);
  assert.equal(w.act('zed').position, 2);
});

test('a place lasts for its time and its messages, and its holder is never cut off by others', () => {
  const w = world();
  w.act('ann'); w.act('bob'); w.act('cat');
  for (let n = 4; n >= 1; n -= 1) { const sent = w.act('ann', 'message'); assert.equal(sent.allowed, true); assert.equal(sent.left, n); }
  assert.equal(w.act('ann', 'message').left, 0, 'the fifth message is still answered');
  assert.equal(w.act('cat').status, 'active', 'and then the place passes to the line');
  const again = w.act('ann', 'message');
  assert.equal(again.allowed, false); assert.equal(again.status, 'queued', 'after their place is used they queue again like anyone else');
  w.tick(601);
  w.act('cat');
  assert.ok(!w.state.active.some(place => place.id === 'bob'), 'time is up for bob');
});

test('people who close the page drop out of the line; someone promoted must show up', () => {
  const w = world();
  w.act('ann'); w.act('bob'); w.act('cat'); w.act('dan');
  w.tick(20); w.act('dan');                 // dan keeps checking in, cat has gone
  w.tick(10); w.act('dan');
  assert.deepEqual(w.state.queue.map(waiting => waiting.id), ['dan']);
  w.act('ann', 'leave');                    // dan is promoted now
  assert.ok(w.state.active.find(place => place.id === 'dan').claimBy);
  w.tick(46);                               // …but never shows up
  assert.equal(w.act('fay').status, 'active', 'the unclaimed place goes to the next person');
  assert.ok(!w.state.active.some(place => place.id === 'dan'));
});

test('the line has an end, and one network cannot hold many places', () => {
  const w = world();
  ['a', 'b', 'c', 'd', 'e'].forEach(id => w.act(id));
  assert.deepEqual(w.act('f'), { status: 'full', reason: 'line', retry: 120, allowed: false });
  const crowded = world(cfg({ capacity: 10, perIp: 2 }));
  crowded.act('t1', 'enter', 'office'); crowded.act('t2', 'enter', 'office');
  assert.deepEqual(crowded.act('t3', 'enter', 'office'), { status: 'full', reason: 'network', retry: 60, allowed: false });
  assert.equal(crowded.act('t4', 'enter', 'home').status, 'active');
});

test('each place reserves its messages from the day; when the day cannot cover another, newcomers are told', () => {
  const w = world(cfg({ capacity: 5, dailyMessages: 12 }));   // room for two places of 5
  assert.equal(w.act('ann').status, 'active'); assert.equal(w.act('bob').status, 'active');
  assert.equal(w.state.used, 10);
  const cat = w.act('cat');
  assert.equal(cat.status, 'full'); assert.equal(cat.reason, 'daily'); assert.equal(cat.retry, 12 * 3600);
  // ann and bob are not affected: every reserved message is still theirs.
  for (let n = 0; n < 5; n += 1) assert.equal(w.act('ann', 'message').allowed, true);
  // bob leaves after two messages: his three unused ones go back, which is just enough for one more place.
  w.act('bob', 'message'); w.act('bob', 'message'); w.act('bob', 'leave');
  assert.equal(w.state.used, 7);
  assert.equal(w.act('cat').status, 'active', 'returned messages make room again');
  assert.equal(w.act('dan').reason, 'daily');
  w.tick(12 * 3600 + 1);                                       // a new day
  assert.equal(w.act('dan').status, 'active');
});

test('a hundred people arriving at once are served strictly in order', () => {
  const w = world(cfg({ capacity: 10, queueLimit: 200, sessionMessages: 2, dailyMessages: 1000 }));
  const order = Array.from({ length: 100 }, (_, index) => `p${String(index).padStart(3, '0')}`);
  order.forEach(id => w.act(id));
  const served = [];
  while (served.length < 100) {
    for (const place of [...w.state.active]) { delete place.claimBy; served.push(place.id); w.act(place.id, 'message'); w.act(place.id, 'message'); }
    w.tick(5);
    w.state.queue.forEach(waiting => { waiting.seen = w.now; });   // everyone still waiting checks in
    w.act('observer', 'leave');
  }
  assert.deepEqual(served, order);
});

test('settings come from the environment with safe bounds, and the line can be switched off', () => {
  assert.equal(admissionSettings({}).capacity, 30); assert.equal(admissionSettings({}).enabled, true);
  assert.deepEqual((({ capacity, sessionMessages, dailyMessages }) => ({ capacity, sessionMessages, dailyMessages }))(admissionSettings({ CHAT_PLACES: '8', CHAT_PLACE_MESSAGES: '6', CHAT_DAILY_MESSAGES: '120' })), { capacity: 8, sessionMessages: 6, dailyMessages: 120 });
  assert.equal(admissionSettings({ CHAT_PLACES: '-3' }).capacity, 30); assert.equal(admissionSettings({ CHAT_PLACES: 'lots' }).capacity, 30);
  assert.equal(admissionSettings({ CHAT_ADMISSION: 'off' }).enabled, false);
});

test('two hundred simultaneous requests through the shared document give exactly the places there are', async () => {
  const store = memoryAdmissionStore();
  // Each request reads, then yields, so they really do interleave and collide.
  const slow = { read: async () => { const raw = await store.read(); await new Promise(resolve => setImmediate(resolve)); return raw; }, swap: store.swap };
  const admission = createAdmission({ store: slow, settings: { ...cfg({ capacity: 7, queueLimit: 500 }), enabled: true }, now: () => T0, attempts: 400, wait: () => new Promise(resolve => setImmediate(resolve)), log: () => {} });
  const results = await Promise.all(Array.from({ length: 200 }, (_, index) => admission.act({ id: `v${index}`, ip: `n${index}`, action: 'enter' })));
  assert.equal(results.filter(result => result.status === 'active').length, 7);
  const positions = results.filter(result => result.status === 'queued').map(result => result.position).sort((a, b) => a - b);
  assert.deepEqual(positions, Array.from({ length: 193 }, (_, index) => index + 1), 'every waiting person has their own position');
});

test('a broken store never takes the chat down: the message goes through', async () => {
  const logs = [];
  const down = createAdmission({ store: { read: async () => { throw new Error('valkey unreachable'); }, swap: async () => false }, settings: { ...cfg(), enabled: true }, log: message => logs.push(message) });
  assert.deepEqual(await down.act({ id: 'ann', ip: 'x', action: 'message' }), { status: 'unknown', allowed: true });
  assert.match(logs[0], /valkey unreachable/);
  const contended = createAdmission({ store: { read: async () => null, swap: async () => false }, settings: { ...cfg(), enabled: true }, attempts: 3, wait: async () => {}, log: () => {} });
  assert.equal((await contended.act({ id: 'ann', ip: 'x', action: 'enter' })).status, 'unknown');
  const off = createAdmission({ store: memoryAdmissionStore(), settings: { ...cfg(), enabled: false } });
  assert.deepEqual(await off.act({ id: 'ann', ip: 'x', action: 'message' }), { status: 'off', allowed: true });
  const garbled = { raw: '{not json', read: async function () { return this.raw; }, swap: async function (previous, next) { this.raw = next; return true; } };
  assert.equal((await createAdmission({ store: garbled, settings: { ...cfg(), enabled: true }, now: () => T0 }).act({ id: 'ann', ip: 'x', action: 'enter' })).status, 'active', 'a corrupted document is started afresh');
});

// ── Over HTTP ───────────────────────────────────────────────────────────────
import { admitChatMessage, chatVisitor, createAdmissionHandler, publicAdmission, skipsLine } from '../src/lib/chat/admissionHttp.mjs';

const reply = () => ({ statusCode: 200, headers: {}, body: null, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (device, ip = '203.0.113.9', extra = {}) => ({ method: 'POST', headers: { 'x-cw-device-id': device, 'x-test-ip': ip }, body: { action: 'enter' }, ...extra });
const ipOf = req => req.headers['x-test-ip'];
function line(settings = cfg({ capacity: 1 })) {
  const admission = createAdmission({ store: memoryAdmissionStore(), settings: { ...settings, enabled: true }, now: () => T0, log: () => {} });
  const limited = [];
  const handler = createAdmissionHandler({ admission, ipOf, isRateLimited: async (...args) => { limited.push(args); return false; }, authorize: async req => req.auth || null });
  const enter = async (device, ip, extra) => { const res = reply(); await handler(request(device, ip, extra), res); return res; };
  const message = async (device, ip, auth) => { const res = reply(); const allowed = await admitChatMessage(request(device, ip), res, { admission, ipOf, auth }); return { allowed, res }; };
  return { enter, message, limited };
}

test('the widget learns its place or its position; a message is passed on only for someone who holds a place', async () => {
  const l = line();
  const ann = await l.enter('device-ann-0001', '203.0.113.1');
  assert.deepEqual(ann.body, { status: 'active', left: 5, seconds: 600 });
  assert.equal(ann.headers['Cache-Control'], 'private, no-store');
  const bob = await l.enter('device-bob-0001', '203.0.113.2');
  assert.deepEqual(bob.body, { status: 'queued', position: 1, ahead: 0, eta: 300 });
  assert.equal((await l.message('device-ann-0001', '203.0.113.1')).allowed, true);
  const refused = await l.message('device-bob-0001', '203.0.113.2');
  assert.equal(refused.allowed, false); assert.equal(refused.res.statusCode, 429);
  assert.equal(refused.res.body.code, 'RATE_LIMITED'); assert.deepEqual(refused.res.body.admission, { status: 'queued', position: 1, ahead: 0, eta: 300 });
  assert.equal(refused.res.headers['Retry-After'], '300');
  // Leaving the line frees the spot.
  const left = await l.enter('device-bob-0001', '203.0.113.2', { body: { action: 'leave' } });
  assert.deepEqual(left.body, { status: 'left' });
  assert.equal((await l.enter('device-cat-0001', '203.0.113.3')).body.position, 1);
});

test('the owner never waits, a bad device id falls back to the network, and no address is kept', async () => {
  const l = line();
  await l.enter('device-ann-0001', '203.0.113.1');
  const owner = { anonymous: false, roles: 'OWNER,ADMIN' };
  assert.deepEqual((await l.enter('device-own-0001', '203.0.113.7', { auth: owner })).body, { status: 'active', owner: true });
  assert.equal((await l.message('device-own-0001', '203.0.113.7', owner)).allowed, true);
  assert.equal(skipsLine({ anonymous: true, roles: 'VIEWER' }), false); assert.equal(skipsLine({ anonymous: false, roles: 'VIEWER' }), false); assert.equal(skipsLine(null), false);
  const odd = chatVisitor({ headers: { 'x-cw-device-id': '<script>', 'x-test-ip': '203.0.113.50' } }, { ipOf, salt: 's' });
  assert.match(odd.id, /^net-[0-9a-f]{12}$/); assert.match(odd.ip, /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(odd).includes('203.0.113.50'));
  assert.notEqual(chatVisitor({ headers: { 'x-test-ip': '203.0.113.50' } }, { ipOf, salt: 'other' }).ip, odd.ip);
  assert.deepEqual(publicAdmission({ status: 'full', reason: 'daily', retry: 3600, allowed: false }), { status: 'full', reason: 'daily', retry: 3600 });
});

test('the line endpoint is rate limited and accepts POST only', async () => {
  const admission = createAdmission({ store: memoryAdmissionStore(), settings: { ...cfg(), enabled: true }, now: () => T0 });
  const handler = createAdmissionHandler({ admission, ipOf, isRateLimited: async () => true });
  const limited = reply(); await handler(request('device-ann-0001'), limited);
  assert.equal(limited.statusCode, 429); assert.equal(limited.headers['Retry-After'], '30');
  const open = createAdmissionHandler({ admission, ipOf, isRateLimited: async () => false });
  const get = reply(); await open({ method: 'GET', headers: {} }, get);
  assert.equal(get.statusCode, 405);
});
