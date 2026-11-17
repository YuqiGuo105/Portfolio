import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeEvidence, linkedInProfile, screeningLabel, screeningRank } from '../src/lib/referral/rubric.mjs';
import { AI_NOTE } from './referral-fixtures.mjs';

const profileUrl = 'https://www.linkedin.com/in/alex-example';
const assessment = changes => ({ ...structuredClone(AI_NOTE.assessment), ...changes });
const none = () => ({ score: 0, meetsBar: false, reason: 'No evidence.', evidence: [], links: [] });
const strong = score => ({ score, meetsBar: true, reason: 'Substantive professional evidence.', evidence: ['Resume p.1: specific work and results.'], links: ['https://github.com/example/project'] });

test('59 does not pass and 60 does, without adding other paths', () => {
  for (const score of [59, 60, 80, 100]) {
    const grade = gradeEvidence(assessment({ employer: none(), openSource: strong(score) }));
    assert.equal(grade.score, score); assert.equal(grade.passed, score >= 60);
    assert.deepEqual(grade.qualifiedPaths, score >= 60 ? ['openSource'] : []);
  }
  const weak = { ...strong(59), meetsBar: false };
  const grade = gradeEvidence({ employer: weak, openSource: weak, contests: { ...weak, links: ['https://leetcode.com/u/example'] } }, { profileUrl });
  assert.equal(grade.score, 59); assert.equal(grade.passed, false);
});

test('each alternative can pass alone; the employer path also needs a trusted official badge check', () => {
  const employer = assessment({ employer: strong(88), openSource: none() });
  const pending = gradeEvidence(employer, { profileUrl });
  assert.equal(pending.score, 59); assert.equal(pending.passed, false); assert.equal(pending.criteria.employer.pendingBadge, true);
  const badge = { confirmed: true, profileUrl, checkedBy: 'owner', checkedAt: '2026-11-16T12:00:00Z' };
  assert.deepEqual(gradeEvidence(employer, { profileUrl, badge }).qualifiedPaths, ['employer']);
  for (const invalid of [{ confirmed: true }, { ...badge, profileUrl: 'https://www.linkedin.com/in/another' }, { ...badge, confirmed: false }]) {
    assert.equal(gradeEvidence(employer, { profileUrl, badge: invalid }).passed, false);
  }
  const contest = gradeEvidence(assessment({ employer: none(), openSource: none(), contests: { ...strong(85), links: ['https://leetcode.com/u/example'] } }));
  assert.equal(contest.score, 85); assert.deepEqual(contest.qualifiedPaths, ['contests']);
});

test('no evidence, no reference, a weak assessment or unsafe URLs cannot qualify', () => {
  for (const patch of [{ evidence: [] }, { links: [] }, { meetsBar: false }, { links: ['javascript:alert(1)', 'https://user:pass@example.com'] }]) {
    const grade = gradeEvidence(assessment({ employer: none(), openSource: { ...strong(99), ...patch } }));
    assert.equal(grade.passed, false); assert.ok(grade.score < 60);
  }
  const grade = gradeEvidence(assessment({ openSource: none(), contests: { ...strong(99), links: ['https://leetcode.com.evil.test/u/example'] } }));
  assert.equal(grade.passed, false);
  assert.equal(gradeEvidence(assessment(), { blocked: true }).passed, false);
});

test('LinkedIn verification accepts member profiles, not lookalikes, OAuth or company pages', () => {
  assert.equal(linkedInProfile(profileUrl), profileUrl);
  for (const url of ['https://linkedin.com.evil.test/in/example', 'https://www.linkedin.com/company/example', 'http://www.linkedin.com/in/example', 'https://www.linkedin.com/oauth/v2/authorization', 'https://example.com/in/user']) assert.equal(linkedInProfile(url), null);
});

test('old job-fit scores are never relabelled as passing the new policy', () => {
  const legacy = { source: 'ai', fit: 100, recommendation: 'strong' };
  assert.equal(screeningRank(legacy), -1);
  assert.equal(screeningLabel(legacy), 'Previous scoring policy - screen again');
  assert.equal(screeningLabel({ source: 'ai', ...gradeEvidence(assessment()) }), 'Pass · 82/100');
  assert.equal(screeningLabel({ source: 'rules' }), 'Not AI-screened');
});
