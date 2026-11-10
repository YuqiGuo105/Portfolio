import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrowserAction as action, normalizeBrowserPlan, executeBrowserAction, registerBrowserTarget } from '../src/lib/browserActions.mjs';
import { recordPublicRunEvent, publicEvidence } from '../src/lib/publicRunReplay.mjs';
import { sequenceSteps } from '../src/lib/sequenceSteps.mjs';
import { publicArchitectureEvolution } from '../src/lib/publicArchitectureEvolution.mjs';
import fs from 'node:fs';

test('page actions reject code, external routes, writes and invalid coordinates', () => {
  for (const item of [{ type: 'eval', code: 'alert(1)' }, { type: 'open_project', projectId: '/admin' },
    { type: 'terminal_command', command: 'pwd; curl attacker.test' }, { type: 'terminal_command', command: 'open admin' },
    { type: 'globe_city', city: 'x', lat: NaN, lng: 0 }, { type: 'globe_city', city: 'x', lat: 91, lng: 0 },
    { type: 'diagram_step', flow: 'publish-content', step: 1.5 }, { type: 'diagram_step', flow: 'secret', step: 1 }]) assert.equal(action(item), null);
  assert.deepEqual(action({ type: 'terminal_command', command: 'pwd', token: 'secret' }), { type: 'terminal_command', command: 'pwd' });
  assert.equal(normalizeBrowserPlan({ schemaVersion: 1, actions: Array(5).fill({ type: 'terminal_command', command: 'pwd' }) }), null);
  assert.equal(normalizeBrowserPlan({ schemaVersion: 1, actions: [{ type: 'eval' }] }), null);
});

test('diagram execution waits for destination registration and validates at the target', async () => {
  let got;
  let remove;
  const router = { pathname: '/', push: async path => {
    assert.equal(path, '/architecture');
    remove = registerBrowserTarget('diagram', value => { got = value; return 'Step 3'; });
  } };
  assert.equal(await executeBrowserAction({ type: 'diagram_step', flow: 'publish-content', step: 3 }, router), 'Step 3');
  assert.equal(got.step, 3); remove();
});

test('late-mounted targets execute once and expired or cancelled navigation does not execute', async () => {
  let count = 0;
  let remove;
  const item = { type: 'diagram_step', flow: 'publish-content', step: 2 };
  const router = { pathname: '/architecture' };
  const pending = executeBrowserAction(item, router);
  await new Promise(resolve => setTimeout(resolve, 5));
  remove = registerBrowserTarget('diagram', () => { count++; return 'Step 2'; });
  assert.equal(await pending, 'Step 2');
  await assert.rejects(executeBrowserAction(item, router, () => false), /not allowed/);
  await assert.rejects(executeBrowserAction(item, { pathname: '/', push: async () => false }), /cancelled/);
  assert.equal(count, 1);
  remove();
});

test('execution replay keeps parallel stages honest and excludes raw diagnostics', () => {
  let rows = recordPublicRunEvent([], { stage: 'safety_check', status: 'started', payload: { token: 'secret' } });
  rows = recordPublicRunEvent(rows, { stage: 'routing', status: 'started' });
  assert.equal(rows[0].status, 'started');
  rows = recordPublicRunEvent(rows, { stage: 'safety_check', status: 'completed', durationMs: 55,
    payload: { prompt: 'private', reasoning: 'hidden', usage: { inputTokens: 10, outputTokens: 2, costUsd: .0002 } } });
  assert.equal(rows[0].durationMs, 55);
  assert.equal(rows[0].inputTokens, 10);
  assert.equal(rows[1].costUsd, null);
  assert.ok(!JSON.stringify(rows).includes('private'));
  assert.equal(recordPublicRunEvent(rows, { stage: 'reasoning_step', status: 'completed' }), rows);
  assert.equal(publicEvidence([{ url: 'https://www.yuqi.site/admin' }, { url: 'https://www.yuqi.site/?token=secret' },
    { url: 'https://www.yuqi.site/blog-single/a', sourceRequiresLogin: true }]).length, 0);
});

test('public architecture output and diagram steps come from the existing curated sources', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../docs/architecture/platform-evolution.json', import.meta.url)));
  const result = publicArchitectureEvolution(data);
  assert.equal(result.milestones.length, data.milestones.length);
  assert.ok(result.milestones.find(item => item.id === 'cpu-throttle').evidence[0].url.startsWith('https://github.com/'));
  assert.ok(!Object.hasOwn(result, 'nodes'));
  const sequences = JSON.parse(fs.readFileSync(new URL('../docs/architecture/platform-sequences.json', import.meta.url)));
  assert.equal(sequenceSteps(sequences.sequences.find(item => item.key === 'publish-content').steps).length, 15);
});
