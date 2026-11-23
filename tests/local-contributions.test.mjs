import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { localArticleDraft } from '../src/lib/media/localArticleDraft.mjs';

const draft = JSON.parse(await fs.readFile(new URL('../docs/content-drafts/0470298d-c74d-4d4b-be33-d948b033002a.json', import.meta.url), 'utf8'));
const original = { id: draft.id, content: 'Original database content', updated_at: draft.sourceUpdatedAt };
test('local contribution draft is verified and grouped without stale three-PR claims', () => {
  assert.equal(draft.contributions.length, 8);
  assert.equal(new Set(draft.contributions.map(pr => pr.repo)).size, 5);
  for (const pr of draft.contributions) {
    assert.ok(pr.mergedAt);
    assert.match(pr.url, /^https:\/\/github.com\/[^/]+\/[^/]+\/pull\/\d+$/);
    assert.ok(draft.content.includes(pr.url));
  }
  assert.match(draft.content, /8 Merged Pull Requests/);
  assert.doesNotMatch(draft.content, /3 Merged Pull Requests|Three pull requests|All three bugs/);
  assert.match(draft.content, /Agent->>Shell/);
  assert.doesNotMatch(draft.content, /Agent-&gt;|Send --&gt;/);
});
test('draft cannot override production, hosted previews or newer database revisions', async () => {
  for (const env of [{}, { NODE_ENV: 'production', MEDIA_LOCAL_REVIEW: '1' }, { NODE_ENV: 'development', MEDIA_LOCAL_REVIEW: '1', VERCEL: '1' }, { NODE_ENV: 'development', MEDIA_LOCAL_REVIEW: '1', K_SERVICE: 'app' }]) {
    assert.equal(await localArticleDraft(original, env), original);
  }
  const env = { NODE_ENV: 'development', MEDIA_LOCAL_REVIEW: '1' };
  const newer = { ...original, updated_at: 'newer' };
  assert.equal(await localArticleDraft(newer, env), newer);
  assert.equal((await localArticleDraft(original, env)).content, draft.content);
});
