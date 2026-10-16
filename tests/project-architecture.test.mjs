import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getProjectArchitecture } from '../src/lib/projectArchitecture.mjs';

const ids = [
  '7c3715bf-7722-4df5-9e83-5d7e9493ea2c', '8edf9020-39b6-4db4-83b3-43c459bef1cf',
  'c049c604-50bd-4265-9318-866fd5f1a69e', '37789a93-f60a-44e4-ab63-1479d036e686',
  'da8e70ff-57f5-4a76-9250-b93677dae43c', '0470298d-c74d-4d4b-be33-d948b033002a',
  'a9b53277-08e9-4727-b136-86cd12e21f22', '7e42b9d7-c888-429e-8b61-5a6888bf6699',
  'e592bf77-4279-4a95-8257-3bd95f8f7eb9',
];

test('each project has a distinct, small, serializable overview', () => {
  const titles = new Set();
  for (const id of ids) {
    const diagram = getProjectArchitecture(id);
    assert.ok(diagram);
    assert.ok(diagram.steps.length >= 4 && diagram.steps.length <= 5);
    assert.ok(Buffer.byteLength(JSON.stringify(diagram)) < 5000);
    assert.deepEqual(JSON.parse(JSON.stringify(diagram)), diagram);
    titles.add(diagram.title);
    for (const field of ['title', 'summary', 'label', 'outcome']) assert.ok(diagram[field]);
    for (const step of diagram.steps) {
      for (const field of ['title', 'subtitle', 'icon', 'role', 'data', 'boundary']) {
        assert.ok(step[field], `${id}: ${field}`);
      }
    }
    assert.equal(new Set(diagram.steps.map(step => step.title)).size, diagram.steps.length);
  }
  assert.equal(titles.size, ids.length);
});

test('unknown projects do not inherit another project diagram', () => {
  for (const id of [null, undefined, '', 'missing', '__proto__', 'constructor']) {
    assert.equal(getProjectArchitecture(id), null);
  }
});

test('overviews preserve key domain boundaries instead of claiming simulated telemetry', () => {
  const platform = getProjectArchitecture(ids[0]);
  assert.match(platform.steps[1].role, /same database transaction/);
  assert.match(platform.steps[2].boundary, /Delivery can repeat/);
  assert.match(getProjectArchitecture(ids[4]).outcome, /submission remains a manual action/);
  assert.equal(getProjectArchitecture(ids[5]).label, 'Engineering workflow');
  const talknest = getProjectArchitecture(ids[7]);
  assert.match(talknest.steps[1].boundary, /not the media transport/);
  assert.match(talknest.steps[3].role, /audio and video/);
});

test('article rendering keeps publication checks and no longer loads the broken image lab', () => {
  const source = readFileSync(new URL('../pages/work-single/[id].js', import.meta.url), 'utf8');
  assert.match(source, /\.eq\("publication_status", "PUBLISHED"\)/);
  assert.match(source, /architecture: getProjectArchitecture\(project.id\)/);
  assert.match(source, /key=\{project.id\}/);
  assert.doesNotMatch(source, /ProjectExperience|project_subsystems|platform-diagram/);
  const component = readFileSync(new URL('../src/components/projects/ProjectArchitectureOverview.js', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /setInterval|setTimeout|fetch\(|ResizeObserver|<img|<canvas/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /aria-selected/);
});

test('shared header does not mount the automatic invitation on other routes', () => {
  const header = readFileSync(new URL('../src/layout/Header.js', import.meta.url), 'utf8');
  assert.match(header, /router.pathname === "\/" && <SubscriptionPrompt/);
});
