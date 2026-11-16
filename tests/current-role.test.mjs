import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoleSource, currentRole, employerUrl, employers, isCurrentPeriod, periodStart, roleTitle, sameCompany } from '../src/lib/currentRole.mjs';
import { createReferralAvailability, publicAvailability } from '../src/lib/referral/availability.mjs';

// The work history as the `experience` table holds it today.
const TODAY = [
  { id: 6, name: 'CuraStone Corp', subname: 'Backend Developer Intern', date: 'Aug 2023 - Dec 2023', text: 'Internship' },
  { id: 5, name: 'Goldman Sachs', subname: 'Software Engineer - Full-time', date: 'Dec 2024 - Current', text: 'Global Banking and Markets - Margins Team\nNew Chapter Starts Here.....' },
];
// After a job change: the old row gets an end date and a new open-ended row is added.
const AFTER = [
  { id: 6, name: 'CuraStone Corp', subname: 'Backend Developer Intern', date: 'Aug 2023 - Dec 2023', text: '' },
  { id: 5, name: 'Goldman Sachs', subname: 'Software Engineer - Full-time', date: 'Dec 2024 - Mar 2027', text: '' },
  { id: 7, name: 'Northwind Labs', subname: 'Senior Software Engineer · Full-time', date: 'Mar 2027 – Present', text: 'Payments platform' },
];

test('the current role is the open-ended row of the work history', () => {
  assert.deepEqual(currentRole(TODAY), { id: '5', company: 'Goldman Sachs', title: 'Software Engineer', since: 'Dec 2024', team: 'Global Banking and Markets - Margins Team' });
  assert.deepEqual(currentRole(AFTER), { id: '7', company: 'Northwind Labs', title: 'Senior Software Engineer', since: 'Mar 2027', team: 'Payments platform' });
});

test('between jobs there is no current role, and bad input never invents one', () => {
  assert.equal(currentRole(AFTER.slice(0, 2)), null);
  for (const rows of [null, undefined, [], [null], [{ name: '', date: 'Jan 2025 - Current' }], [{ name: 'X', date: '' }], 'Goldman Sachs']) assert.equal(currentRole(rows), null);
});

test('with two open-ended rows the one that started last wins', () => {
  const overlap = [...TODAY, { id: 9, name: 'Northwind Labs', subname: 'Staff Engineer', date: 'Jan 2026 - Present', text: '' }];
  assert.equal(currentRole(overlap).company, 'Northwind Labs');
  assert.equal(currentRole([...overlap].reverse()).company, 'Northwind Labs', 'whatever order the rows arrive in');
});

test('periods are read in the forms people write them', () => {
  for (const period of ['Dec 2024 - Current', 'Dec 2024 – Present', 'December 2024 — now', '2024.12 - 至今', '2024 - present', 'Mar 2027 to Present']) assert.equal(isCurrentPeriod(period), true, period);
  for (const period of ['Aug 2023 - Dec 2023', 'Dec 2024', '', null, 'Presentation lead 2022 - 2023', 'Current Biology 2020 - 2021']) assert.equal(isCurrentPeriod(period), false, String(period));
  assert.ok(periodStart('Mar 2027 - Present').order > periodStart('Dec 2024 - Current').order);
  assert.equal(periodStart('2024.12 - 至今').order, periodStart('Dec 2024 - Current').order);
  assert.equal(periodStart('12/2024 - now').order, periodStart('Dec 2024 - Current').order);
  assert.equal(periodStart('sometime').order, 0);
});

test('titles lose the employment type, companies compare without case or spacing', () => {
  assert.equal(roleTitle('Software Engineer - Full-time'), 'Software Engineer');
  assert.equal(roleTitle('Senior Software Engineer · Full-time'), 'Senior Software Engineer');
  assert.equal(roleTitle('Backend Developer Intern'), 'Backend Developer Intern');
  assert.equal(roleTitle('Engineer, Contract'), 'Engineer');
  assert.equal(sameCompany(' goldman  sachs', 'Goldman Sachs'), true);
  assert.equal(sameCompany('Goldman', 'Goldman Sachs'), false);
  assert.equal(sameCompany('', ''), false); assert.equal(sameCompany(undefined, 'Goldman Sachs'), false);
  assert.deepEqual(employers(AFTER), ['Northwind Labs', 'Goldman Sachs', 'CuraStone Corp']);
  assert.equal(employerUrl('goldman sachs'), 'https://www.goldmansachs.com/'); assert.equal(employerUrl('Northwind Labs'), null);
});

test('the cached reader follows a job change, survives an outage, and tells an outage from "no employer"', async () => {
  let rows = TODAY, fail = false, reads = 0, clock = 0;
  const source = createRoleSource({ load: async () => { reads += 1; if (fail) throw new Error('database unreachable'); return rows; }, ttlMs: 300000, now: () => clock, log: () => {} });
  assert.equal((await source.get()).role.company, 'Goldman Sachs');
  await source.get(); assert.equal(reads, 1, 'answers from memory inside five minutes');
  rows = AFTER; clock += 300001;
  assert.equal((await source.get()).role.company, 'Northwind Labs', 'picks up the change on the next read');
  rows = TODAY; source.clear();
  assert.equal((await source.get()).role.company, 'Goldman Sachs', 'or at once when told to');
  fail = true; clock += 300001;
  const stale = await source.get();
  assert.equal(stale.role.company, 'Goldman Sachs'); assert.equal(stale.stale, true, 'keeps the last good answer through an outage');
  clock += 15001; await source.get(); assert.equal(reads, 5, 'and retries soon, not after another five minutes');

  const cold = createRoleSource({ load: async () => [], log: () => {} });
  assert.deepEqual(await cold.get(), { role: null, employers: [], known: false }, 'an empty read is "unknown", not "between jobs"');
  const between = createRoleSource({ load: async () => AFTER.slice(0, 2), log: () => {} });
  assert.deepEqual((({ role, known }) => ({ role, known }))(await between.get()), { role: null, known: true });
});

test('fifty simultaneous readers cause one read of the work history', async () => {
  let reads = 0;
  const source = createRoleSource({ load: async () => { reads += 1; await new Promise(resolve => setTimeout(resolve, 10)); return TODAY; }, log: () => {} });
  const answers = await Promise.all(Array.from({ length: 50 }, () => source.get()));
  assert.equal(reads, 1); assert.ok(answers.every(answer => answer.role.company === 'Goldman Sachs'));
});

const roles = rows => createRoleSource({ load: async () => rows, log: () => {} });
const store = (accepting = true) => ({ accepting: async () => accepting });

test('referrals are open at the current employer, and closed between jobs, when paused, or when unknown', async () => {
  const open = await createReferralAvailability({ roles: roles(TODAY), store: store(), env: {} }).get();
  assert.equal(open.company, 'Goldman Sachs'); assert.equal(open.accepting, true); assert.equal(open.reason, null);
  assert.deepEqual(publicAvailability(open), { company: 'Goldman Sachs', reason: null });

  const moved = await createReferralAvailability({ roles: roles(AFTER), store: store(), env: {} }).get();
  assert.deepEqual(publicAvailability(moved), { company: 'Northwind Labs', reason: null }, 'a job change moves the form with it');

  const between = await createReferralAvailability({ roles: roles(AFTER.slice(0, 2)), store: store(), env: {} }).get();
  assert.deepEqual(publicAvailability(between), { company: null, reason: 'no_employer' });

  const paused = await createReferralAvailability({ roles: roles(TODAY), store: store(false), env: {} }).get();
  assert.equal(paused.accepting, false); assert.equal(paused.switchedOn, false); assert.equal(paused.company, 'Goldman Sachs');
  assert.deepEqual(publicAvailability(paused), { company: null, reason: 'paused' }, 'a paused page does not name a company');
  assert.equal((await createReferralAvailability({ roles: roles(TODAY), store: store(), env: { REFERRALS_PAUSED: '1' } }).get()).reason, 'paused');

  const unknown = await createReferralAvailability({ roles: roles([]), store: store(), env: {} }).get();
  assert.deepEqual(publicAvailability(unknown), { company: null, reason: 'unknown' });
  assert.deepEqual(publicAvailability(null), { company: null, reason: 'paused' });
});

test('REFERRAL_COMPANY pins a company by hand; a failing switch read does not close the form', async () => {
  const pinned = await createReferralAvailability({ roles: roles(AFTER.slice(0, 2)), store: store(), env: { REFERRAL_COMPANY: '  Acme   Corp ' } }).get();
  assert.equal(pinned.company, 'Acme Corp'); assert.equal(pinned.accepting, true);
  const flaky = await createReferralAvailability({ roles: roles(TODAY), store: { accepting: async () => { throw new Error('down'); } }, env: {} }).get();
  assert.equal(flaky.accepting, true);
});

test('availability is cached briefly and cleared on demand', async () => {
  let rows = TODAY, clock = 0;
  const source = createRoleSource({ load: async () => rows, ttlMs: 1000, now: () => clock, log: () => {} });
  const availability = createReferralAvailability({ roles: source, store: store(), env: {}, ttlMs: 30000, now: () => clock });
  assert.equal((await availability.get()).company, 'Goldman Sachs');
  rows = AFTER; clock += 5000;
  assert.equal((await availability.get()).company, 'Goldman Sachs', 'inside the cache window');
  availability.clear();
  assert.equal((await availability.get()).company, 'Northwind Labs', 'after the admin page asks for a re-read');
});
