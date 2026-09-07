import test from 'node:test';
import assert from 'node:assert/strict';
import { publicProfileUrl } from '../src/lib/socialProfiles.mjs';

test('public profile configuration accepts HTTPS and normalizes whitespace', () => {
  assert.equal(publicProfileUrl(' https://leetcode.com/u/example/ '), 'https://leetcode.com/u/example/');
});
test('unconfigured and unsafe profiles do not create links', () => {
  for (const value of [undefined, '', 'not a URL', 'javascript:alert(1)', 'http://example.com', 'https://user:password@example.com']) {
    assert.equal(publicProfileUrl(value), null);
  }
});
