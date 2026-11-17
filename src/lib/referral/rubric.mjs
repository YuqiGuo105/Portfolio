// One strong path is enough; weak paths never add up to a pass.
import { httpsUrl } from './fields.mjs';

export const SCREENING_POLICY = 'evidence-v1';
export const PASS_SCORE = 60;
export const EVIDENCE_PATHS = Object.freeze({
  employer: 'Major-company experience + LinkedIn badge',
  openSource: 'Substantial open-source engineering',
  contests: 'Strong LeetCode contest performance',
});
const text = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function linkedInProfile(value) {
  const safe = httpsUrl(value, 500);
  if (!safe) return null;
  const url = new URL(safe);
  return /(^|\.)linkedin\.com$/.test(url.hostname) && /^\/in\/[^/]+\/?$/.test(url.pathname) ? safe : null;
}

export function gradeEvidence(assessment, { profileUrl = '', badge = null, blocked = false } = {}) {
  const criteria = {};
  for (const id of Object.keys(EVIDENCE_PATHS)) {
    const item = assessment?.[id];
    if (!item || !Number.isInteger(item.score) || item.score < 0 || item.score > 100
      || typeof item.meetsBar !== 'boolean' || !text(item.reason, 360)
      || !Array.isArray(item.evidence) || !Array.isArray(item.links)) throw new Error('Invalid evidence assessment');
    const evidence = item.evidence.map(value => text(value, 280)).filter(Boolean).slice(0, 3);
    const links = [...new Set(item.links.map(value => httpsUrl(value, 500)).filter(Boolean))].slice(0, 3);
    const hasReference = id === 'employer' ? Boolean(linkedInProfile(profileUrl))
      : id === 'contests' ? links.some(link => /(^|\.)leetcode\.(com|cn)$/.test(new URL(link).hostname)) : links.length > 0;
    const supported = item.meetsBar && item.score >= PASS_SCORE && evidence.length > 0 && hasReference;
    // This argument is supplied by the authenticated owner action, never by the model or applicant.
    const badgeVerified = badge?.confirmed === true && Boolean(badge.checkedBy) && Boolean(badge.checkedAt)
      && badge.profileUrl === linkedInProfile(profileUrl);
    criteria[id] = { score: item.score, meetsBar: item.meetsBar, reason: text(item.reason, 360), evidence, links,
      eligible: !blocked && supported && (id !== 'employer' || badgeVerified),
      pendingBadge: !blocked && supported && id === 'employer' && !badgeVerified };
  }
  const qualifiedPaths = Object.keys(criteria).filter(id => criteria[id].eligible);
  const score = Math.max(...Object.values(criteria).map(item => item.evidence.length
    ? Math.min(item.score, item.eligible ? 100 : PASS_SCORE - 1) : 0));
  const passed = qualifiedPaths.length > 0 && score >= PASS_SCORE;
  const pendingBadge = criteria.employer.pendingBadge && !passed;
  return { rubric: SCREENING_POLICY, score, fit: score, passed, qualifiedPaths, criteria,
    linkedinBadge: badge || null,
    recommendation: passed ? score >= 80 ? 'strong' : 'promising' : blocked || pendingBadge ? 'unclear' : 'weak' };
}

export const currentScreening = note => note?.rubric === SCREENING_POLICY;
export function screeningLabel(note) {
  if (note?.source !== 'ai') return 'Not AI-screened';
  if (!currentScreening(note)) return 'Previous scoring policy - screen again';
  const state = note.passed ? 'Pass' : note.criteria?.employer?.pendingBadge ? 'Pending badge check' : 'Below threshold';
  return `${state} · ${note.score}/100`;
}

export function screeningRank(note) {
  return currentScreening(note) && note.source === 'ai' && Number.isInteger(note.score) ? note.score : -1;
}
