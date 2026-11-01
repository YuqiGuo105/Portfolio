import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../src/data/siteHistory.json', import.meta.url)));
const publicFile = (p) => new URL(`../public${p}`, import.meta.url);

test('site history snapshots are in date order with real commits and every image present', () => {
  const snaps = data.snapshots;
  assert.ok(snaps.length >= 5);
  assert.match(data.repo, /^https:\/\/github\.com\/YuqiGuo105\/Portfolio$/);
  for (let i = 0; i < snaps.length; i += 1) {
    const s = snaps[i];
    assert.match(s.sha, /^[0-9a-f]{7}$/);
    assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
    if (i) assert.ok(s.date > snaps[i - 1].date, `${s.date} after ${snaps[i - 1].date}`);
    assert.equal(s.previous, i ? snaps[i - 1].sha : null);
    assert.ok(Number.isInteger(s.commits) && s.commits > 0);
    for (const key of ['cover', 'thumb', 'full']) {
      assert.match(s[key], new RegExp(`^/site-history/${s.date}-${s.sha}-${key}\\.webp$`));
      assert.ok(existsSync(publicFile(s[key])), s[key]);
    }
  }
});

test('site history images stay small enough to scrub through', () => {
  for (const s of data.snapshots) {
    assert.ok(statSync(publicFile(s.thumb)).size < 30_000, s.thumb);
    assert.ok(statSync(publicFile(s.cover)).size < 250_000, s.cover);
    assert.ok(statSync(publicFile(s.full)).size < 900_000, s.full);
  }
});
