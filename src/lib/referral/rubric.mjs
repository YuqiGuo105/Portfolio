// One strong path is enough; weak paths never add up to a pass.
import { httpsUrl } from './fields.mjs';

export const SCREENING_POLICY = 'evidence-v2';
// What the server's own lookups found for a path's references (publicEvidence.mjs).
export const CHECKS = Object.freeze(['verified', 'contradicted', 'unavailable', 'unchecked']);
// A path whose cited references turned out not to exist, or not to be merged or rated, stays in the "superficial" band.
export const CONTRADICTED_CAP = 39;
export const PASS_SCORE = 60;
export const EVIDENCE_PATHS = Object.freeze({
  employer: 'Major-company engineering experience',
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

// `verification` maps a path to what the server found: it comes from publicEvidence.mjs or from a
// stored note, never from the model or the applicant.
export function gradeEvidence(assessment, { profileUrl = '', badge = null, blocked = false, verification = {} } = {}) {
  const criteria = {};
  for (const id of Object.keys(EVIDENCE_PATHS)) {
    const item = assessment?.[id];
    if (!item || !Number.isInteger(item.score) || item.score < 0 || item.score > 100
      || typeof item.meetsBar !== 'boolean' || !text(item.reason, 360)
      || !Array.isArray(item.evidence) || !Array.isArray(item.links)) throw new Error('Invalid evidence assessment');
    const evidence = item.evidence.map(value => text(value, 280)).filter(Boolean).slice(0, 3);
    const links = [...new Set(item.links.map(value => httpsUrl(value, 500)).filter(Boolean))].slice(0, 3);
    const found = id !== 'employer' && CHECKS.includes(verification?.[id]) ? verification[id] : 'unchecked';
    // Employment is read from the résumé itself: a LinkedIn profile is noted for the owner when there is one, but its absence takes nothing away.
    const hasReference = id === 'employer' ? true
      : found === 'verified' || (id === 'contests' ? links.some(link => /(^|\.)leetcode\.(com|cn)$/.test(new URL(link).hostname)) : links.length > 0);
    const supported = item.meetsBar && item.score >= PASS_SCORE && evidence.length > 0 && hasReference && found !== 'contradicted';
    // This argument is supplied by the authenticated owner action, never by the model or applicant.
    const badgeVerified = badge?.confirmed === true && Boolean(badge.checkedBy) && Boolean(badge.checkedAt)
      && badge.profileUrl === linkedInProfile(profileUrl);
    criteria[id] = { score: item.score, meetsBar: item.meetsBar, reason: text(item.reason, 360), evidence, links,
      check: id === 'employer' ? (badgeVerified ? 'verified' : 'unchecked') : found,
      // The employer path stands on the résumé plus a LinkedIn member profile to check it against. The
      // owner's badge check is recorded when he makes it, but a request no longer waits for it.
      // Only his own "I looked and it is not there" takes the path away again.
      eligible: !blocked && supported && !(id === 'employer' && badge?.confirmed === false),
      pendingBadge: !blocked && supported && id === 'employer' && badge?.confirmed === false };
  }
  const qualifiedPaths = Object.keys(criteria).filter(id => criteria[id].eligible);
  const score = Math.max(...Object.values(criteria).map(item => item.evidence.length
    ? Math.min(item.score, item.eligible ? 100 : item.check === 'contradicted' ? CONTRADICTED_CAP : PASS_SCORE - 1) : 0));
  const passed = qualifiedPaths.length > 0 && score >= PASS_SCORE;
  const pendingBadge = criteria.employer.pendingBadge && !passed;
  return { rubric: SCREENING_POLICY, score, fit: score, passed, qualifiedPaths, criteria,
    linkedinBadge: badge || null,
    recommendation: passed ? score >= 80 ? 'strong' : 'promising' : blocked || pendingBadge ? 'unclear' : 'weak' };
}

// The stored checks of a note, to grade it again (after a badge check) without asking the services twice.
export const storedChecks = note => Object.fromEntries(Object.entries(note?.criteria || {}).map(([id, item]) => [id, item?.check]));

// Below this evidence score a request that nothing else is holding open is declined without waiting
// for the owner (REFERRAL_AUTO_DECLINE_BELOW; 0 switches it off). Never above the pass mark.
export function autoDeclineBelow(env = {}) {
  const value = env.REFERRAL_AUTO_DECLINE_BELOW;
  if (value === undefined || value === '') return PASS_SCORE;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, PASS_SCORE) : PASS_SCORE;
}

// 'passed'        one path qualifies: the applicant is told, and the owner is asked to refer
// 'auto_declined' a model scored it under the bar and nothing is left for a person to check
// 'review'        everything else waits for the owner: no model note, an unconfirmed LinkedIn badge,
//                 a résumé that disagrees with the introduction, or a lookup that could not be made
export function screeningOutcome(note, env = {}) {
  if (note?.source !== 'ai' || !currentScreening(note) || !Number.isInteger(note.score)) return 'review';
  if (note.passed === true) return 'passed';
  // A path the model found strong but that only lacks a link to check is a person's call, never an automatic decline.
  const waiting = note.criteria?.employer?.pendingBadge || note.consistency === 'conflicts'
    || (!note.flags?.some(flag => flag !== 'incomplete')
      && Object.values(note.criteria || {}).some(item => item.meetsBar && item.score >= PASS_SCORE && item.check !== 'contradicted'));
  return !waiting && note.score < autoDeclineBelow(env) ? 'auto_declined' : 'review';
}

export const currentScreening = note => note?.rubric === SCREENING_POLICY;
export function screeningLabel(note) {
  if (note?.source !== 'ai') return 'Not AI-screened';
  if (!currentScreening(note)) return 'Previous scoring policy - screen again';
  const state = note.passed ? 'Pass' : note.criteria?.employer?.pendingBadge ? 'LinkedIn not confirmed' : note.auto?.declined ? 'Auto-declined' : 'Below threshold';
  return `${state} · ${note.score}/100`;
}

export function screeningRank(note) {
  return currentScreening(note) && note.source === 'ai' && Number.isInteger(note.score) ? note.score : -1;
}
