import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBreaker } from '../src/lib/circuitBreaker.mjs';
import { ago, avatarOf, gatherNotifications, initials, rememberSeen, unseenCount } from '../src/lib/adminNotifications.mjs';

const NOW = Date.parse('2026-11-16T07:00:00Z');
const at = minutes => new Date(NOW - minutes * 60000).toISOString();
const api = (overrides = {}) => ({
  alerts: async () => ({ incidents: [{ incidentId: 'i1', ruleName: 'Traffic spike', createdAt: at(5), measuredValue: 420, threshold: 300 }] }),
  referrals: async () => ({ requests: [
    { id: 'r1', status: 'new', name: 'Alex Chen', role_title: 'Associate', company: 'Goldman Sachs', created_at: at(30) },
    { id: 'r2', status: 'reviewing', name: 'Maya Lin', role_title: 'Analyst', created_at: at(10) },
  ] }),
  flags: async () => ({ enabled: true, flags: [{ id: 7, emoji: '👋', message: 'Hello from Lisbon', city: 'Lisbon', country: 'Portugal', created_at: at(90) }] }),
  reviews: async () => ({ reviews: [{ id: 'v1', status: 'pending', title: 'Suggested link', created_at: at(200) }, { id: 'v2', status: 'approved', title: 'Old' }] }),
  failures: async () => ({ items: [{ kind: 'RAG_INDEX', id: 12, lastError: 'embedding quota', updatedAt: at(2) }] }),
  ...overrides,
});

test('gathers what is waiting from every source, newest group first, each linking to its page', async () => {
  const result = await gatherNotifications(api());
  assert.deepEqual(result.groups.map(group => [group.id, group.href, group.total]), [
    ['monitoring', '/admin/jobs', 1], ['audience', '/admin/visitors', 1], ['referrals', '/admin/referrals', 1], ['flags', '/admin/globe-flags', 1], ['reviews', '/admin/discovery', 1],
  ]);
  assert.equal(result.total, 5); assert.deepEqual(result.unchecked, []);
  const byId = Object.fromEntries(result.groups.map(group => [group.id, group.items[0]]));
  assert.deepEqual(byId.audience, { key: 'audience:i1', title: 'Traffic spike', at: NOW - 5 * 60000, detail: 'Measured 420, threshold 300' });
  assert.equal(byId.referrals.title, 'Alex Chen'); assert.equal(byId.referrals.detail, 'Associate at Goldman Sachs');
  assert.equal(byId.flags.title, '👋 Hello from Lisbon'); assert.equal(byId.flags.detail, 'Lisbon, Portugal');
  assert.equal(byId.monitoring.title, 'Failed: rag index'); assert.equal(byId.monitoring.detail, 'embedding quota');
  assert.ok(!result.keys.includes('referral:r2'), 'a request already being reviewed is not a notification');
  assert.ok(!result.keys.includes('review:v2'));
});

test('a source that fails or answers oddly is named as unchecked and never breaks the rest', async () => {
  const result = await gatherNotifications(api({
    alerts: async () => { throw new Error('alert service down'); },
    failures: () => { throw new Error('thrown before any promise'); },
    flags: async () => ({ enabled: false, flags: [] }),
    reviews: async () => null,
  }));
  assert.deepEqual(result.unchecked, ['Audience alerts', 'Monitoring']);
  assert.deepEqual(result.groups.map(group => group.id), ['referrals']);
  assert.equal(result.total, 1);
  assert.deepEqual((await gatherNotifications(api({ referrals: async () => 'nonsense', alerts: async () => ({}), flags: async () => ({}), reviews: async () => ({}), failures: async () => [] }))).groups, []);
});

test('a long list is cut to eight with a count of the rest', async () => {
  const requests = Array.from({ length: 23 }, (_, index) => ({ id: `r${index}`, status: 'new', name: `Person ${index}`, created_at: at(index) }));
  const [group] = (await gatherNotifications(api({ referrals: async () => ({ requests }), alerts: async () => ({}), flags: async () => ({}), reviews: async () => ({}), failures: async () => [] }))).groups;
  assert.equal(group.items.length, 8); assert.equal(group.more, 15); assert.equal(group.total, 23);
  assert.equal(group.items[0].title, 'Person 0', 'newest first');
});

test('the badge counts only what has not been looked at; opening the list remembers what was shown', () => {
  const keys = ['audience:i1', 'referral:r1', 'flag:7'];
  assert.equal(unseenCount(keys, []), 3);
  const seen = rememberSeen(keys.slice(0, 2), ['old:1']);
  assert.deepEqual(seen, ['audience:i1', 'referral:r1', 'old:1']);
  assert.equal(unseenCount(keys, seen), 1);
  assert.equal(rememberSeen(Array.from({ length: 500 }, (_, index) => `k${index}`), []).length, 400, 'the remembered list is capped');
});

test('times read naturally', () => {
  assert.equal(ago(NOW - 20000, NOW), 'just now'); assert.equal(ago(NOW - 5 * 60000, NOW), '5 min ago');
  assert.equal(ago(NOW - 3 * 3600000, NOW), '3 h ago'); assert.equal(ago(NOW - 50 * 3600000, NOW), '2 d ago'); assert.equal(ago(0, NOW), '');
});

test('the account picture comes from the sign-in provider, https only, with initials as the fallback', () => {
  const google = { email: 'owner@example.com', user_metadata: { avatar_url: 'https://lh3.googleusercontent.com/a/abc=s96-c', full_name: 'Yuqi Guo' } };
  assert.deepEqual(avatarOf(google), { url: 'https://lh3.googleusercontent.com/a/abc=s96-c', name: 'Yuqi Guo', email: 'owner@example.com' });
  assert.equal(avatarOf({ user_metadata: { picture: 'https://example.com/p.png' } }).url, 'https://example.com/p.png');
  assert.equal(avatarOf({ user_metadata: {}, identities: [{ identity_data: { avatar_url: 'https://example.com/i.png' } }] }).url, 'https://example.com/i.png');
  for (const bad of ['http://example.com/p.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '', null, 42]) assert.equal(avatarOf({ user_metadata: { avatar_url: bad } }).url, '', String(bad));
  assert.deepEqual(avatarOf(null), { url: '', name: '', email: '' });
  assert.equal(initials('Yuqi Guo', ''), 'YG'); assert.equal(initials('Madonna', ''), 'M'); assert.equal(initials('', 'owner@example.com'), 'O'); assert.equal(initials('', ''), '?');
});

test('the tracking breaker leaves a failing broker alone for a while, then lets requests try again', () => {
  let clock = 1000;
  const breaker = createBreaker(30000, () => clock);
  assert.equal(breaker.isOpen(), false);
  breaker.trip(); assert.equal(breaker.isOpen(), true);
  clock += 29999; assert.equal(breaker.isOpen(), true);
  clock += 1; assert.equal(breaker.isOpen(), false, 'closes by itself');
  breaker.trip(); breaker.reset(); assert.equal(breaker.isOpen(), false);
});
