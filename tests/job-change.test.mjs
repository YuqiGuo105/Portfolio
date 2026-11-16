import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planJobChange, runJobChange } from '../src/lib/jobChange.mjs';
import { currentRole } from '../src/lib/currentRole.mjs';

const HISTORY = [
  { id: '6', name: 'CuraStone Corp', subname: 'Backend Developer Intern', date: 'Aug 2023 - Dec 2023' },
  { id: '5', name: 'Goldman Sachs', subname: 'Software Engineer - Full-time', date: 'Dec 2024 - Current' },
];
const MOVE = { lastMonth: 'march 2027', company: ' Northwind  Labs ', title: 'Senior Software Engineer', started: 'Mar 2027', about: 'Payments platform' };

test('a job change ends the current role and adds the new one as the open-ended row', () => {
  const plan = planJobChange(HISTORY, MOVE);
  assert.deepEqual(plan, {
    errors: null,
    end: { id: '5', company: 'Goldman Sachs', date: 'Dec 2024 - Mar 2027' },
    start: { title: 'Northwind Labs', summary: 'Senior Software Engineer', content: 'Payments platform', date: 'Mar 2027 - Current' },
  });
  // Applied to the work history, the plan makes the new company the current employer.
  const after = [...HISTORY.map(row => (row.id === plan.end.id ? { ...row, date: plan.end.date } : row)),
    { id: '7', name: plan.start.title, subname: plan.start.summary, date: plan.start.date }];
  assert.equal(currentRole(after).company, 'Northwind Labs');
});

test('leaving without a new role yet only ends the current one', () => {
  const plan = planJobChange(HISTORY, { lastMonth: 'Mar 2027' });
  assert.deepEqual(plan, { errors: null, end: { id: '5', company: 'Goldman Sachs', date: 'Dec 2024 - Mar 2027' }, start: null });
  assert.equal(currentRole(HISTORY.map(row => (row.id === '5' ? { ...row, date: plan.end.date } : row))), null);
});

test('starting again after a gap adds the role without touching the past', () => {
  const between = HISTORY.map(row => (row.id === '5' ? { ...row, date: 'Dec 2024 - Mar 2027' } : row));
  const plan = planJobChange(between, { company: 'Northwind Labs', title: 'Senior Software Engineer', started: 'Jun 2027' });
  assert.equal(plan.end, null);
  assert.deepEqual(plan.start, { title: 'Northwind Labs', summary: 'Senior Software Engineer', content: '', date: 'Jun 2027 - Current' });
  assert.deepEqual(planJobChange(between, {}).errors, { company: 'There is no current role to end. Add the new one.' });
});

test('mistakes are named before anything is written', () => {
  const errors = input => planJobChange(HISTORY, input).errors;
  assert.match(errors({ ...MOVE, lastMonth: '2027-03' }).lastMonth, /for example Mar 2027/);
  assert.match(errors({ ...MOVE, lastMonth: 'Nov 2024' }).lastMonth, /before the role began \(Dec 2024\)/);
  assert.match(errors({ ...MOVE, started: 'Jan 2027' }).started, /starts before the last one ends/);
  assert.match(errors({ ...MOVE, company: 'goldman sachs' }).company, /already the current employer/);
  assert.deepEqual(Object.keys(errors({ lastMonth: 'Mar 2027', company: 'Northwind Labs' })).sort(), ['started', 'title']);
  assert.match(errors({ lastMonth: 'Mar 2027', title: 'Engineer', started: 'Mar 2027' }).company, /Name the company/);
  assert.equal(planJobChange(HISTORY, MOVE).errors, null);
});

function recorder(fail = {}) {
  const calls = [];
  const api = {
    save: async (id, data, key) => { calls.push(['save', id, data, key]); if (fail.save === (id || 'new')) throw new Error('write refused'); return { sourceId: id || '7' }; },
    publish: async (id, options) => { calls.push(['publish', id, options]); if (fail.publish === id) throw new Error('index queue down'); return {}; },
    refresh: async () => { calls.push(['refresh']); if (fail.refresh) throw new Error('revalidate failed'); return {}; },
  };
  return { api, calls };
}

test('the change is carried out in order; subscribers are not told unless asked', async () => {
  const { api, calls } = recorder();
  const result = await runJobChange(planJobChange(HISTORY, MOVE), api, { key: 'k-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['save', '5', { date: 'Dec 2024 - Mar 2027' }, undefined],
    ['publish', '5', { changeNote: 'Role ended', notifySubscribers: false }],
    ['save', null, { title: 'Northwind Labs', summary: 'Senior Software Engineer', content: 'Payments platform', date: 'Mar 2027 - Current' }, 'k-1'],
    ['publish', '7', { changeNote: 'New role', notifySubscribers: false }],
    ['refresh'],
  ]);
  assert.deepEqual(result.steps.map(step => step.ok), [true, true, true, true, true]);

  const told = recorder();
  await runJobChange(planJobChange(HISTORY, MOVE), told.api, { announce: true });
  assert.deepEqual(told.calls.filter(call => call[0] === 'publish').map(call => call[2].notifySubscribers), [false, true], 'only the new role is announced, never the old one ending');
});

test('a failed step stops the change and says exactly how far it got', async () => {
  const { api, calls } = recorder({ save: 'new' });
  const result = await runJobChange(planJobChange(HISTORY, MOVE), api);
  assert.equal(result.ok, false);
  assert.deepEqual(result.steps.map(step => [step.ok, step.error || '']), [[true, ''], [true, ''], [false, 'write refused']]);
  assert.ok(!calls.some(call => call[0] === 'refresh'), 'nothing after the failure runs');

  const early = recorder({ publish: '5' });
  const stopped = await runJobChange(planJobChange(HISTORY, MOVE), early.api);
  assert.equal(stopped.ok, false);
  assert.ok(!early.calls.some(call => call[0] === 'save' && call[1] === null), 'the new role is not added on top of a half-finished ending');
});

test('pages that refresh by themselves do not fail the change when the refresh call does', async () => {
  const { api } = recorder({ refresh: true });
  const result = await runJobChange(planJobChange(HISTORY, { lastMonth: 'Mar 2027' }), api);
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.at(-1), { label: 'Home page and referral page regenerated', ok: false, optional: true, error: 'revalidate failed' });
});
