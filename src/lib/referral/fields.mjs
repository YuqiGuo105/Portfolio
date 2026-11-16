// Validation for a referral request. Pure and shared: the form uses it for inline hints and the
// server runs the same rules again, so the two can never disagree about what is acceptable.
import { INTRO_MAX, INTRO_MIN, LIMITS, RELATIONSHIPS } from './config.mjs';

export class ReferralError extends Error {
  constructor(code, status = 400, field = null) { super(code); this.code = code; this.status = status; this.field = field; }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Characters that can hide or reorder text in an email or an admin table.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
const clean = value => value.normalize('NFKC').replace(INVISIBLE, '').replace(/\r\n?/g, '\n');

export function httpsUrl(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  // https only, no credentials: these links are opened from an inbox and an admin page.
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null;
  return url.href;
}

// First-person wording in an introduction that should be about the applicant, not by them.
// "US" (the country) and quoted job titles are common, so only unambiguous forms are counted.
const FIRST_PERSON = /(?:^|[^\p{L}\p{N}'’])(I|[Mm]y|[Mm]e|[Mm]yself|[Mm]ine|[Ww]e|[Oo]ur)(?=$|[^\p{L}\p{N}])/gu;
// Chinese has no word boundaries; 我 and 本人 are first person wherever they appear.
const FIRST_PERSON_CJK = /我|本人/gu;
export function firstPersonWords(text) {
  if (typeof text !== 'string') return [];
  const found = [];
  for (const match of text.matchAll(FIRST_PERSON)) found.push(match[1]);
  for (const match of text.matchAll(FIRST_PERSON_CJK)) found.push(match[0]);
  return found;
}

// 'third_person' | 'mixed' | 'first_person'. One stray pronoun (a quote, a title) is tolerated.
export function introVoice(text) {
  const words = firstPersonWords(text);
  if (words.length === 0) return 'third_person';
  const opening = /^\s*(I\b|I['’]|My\b|我|本人)/u.test(text || '');
  return opening || words.length >= 3 ? 'first_person' : 'mixed';
}

// Unfilled parts of the fill-in template, such as "[current title]".
export const hasPlaceholder = text => typeof text === 'string' && /\[[^\]\n]{1,80}\]/.test(text);

export function introTemplate({ name = '', roleTitle = '', company = '' } = {}) {
  const who = name.trim() || '[Full name]';
  return `${who} is a [current title] with [N] years of experience in [main area]. `
    + `At [current or recent company], ${who.split(/\s+/)[0]} [built / led / improved what, with a number if there is one]. `
    + `Their strongest skills are [skill], [skill] and [skill]. `
    + `${who.split(/\s+/)[0]} is interested in the ${roleTitle.trim() || '[role]'} role${company ? ` at ${company}` : ''} because [one specific reason].`;
}

// Fields the applicant typed. Throws ReferralError naming the first field that needs attention.
export function referralFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReferralError('invalid_fields');
  const text = (key, max, { required = false, multiline = false } = {}) => {
    const raw = body[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) throw new ReferralError('missing_field', 400, key);
      return '';
    }
    if (typeof raw !== 'string' || raw.length > max * 2) throw new ReferralError('invalid_field', 400, key);
    const value = (multiline ? clean(raw) : clean(raw).replace(/\s+/g, ' ')).trim();
    if (value.length > max) throw new ReferralError('too_long', 400, key);
    if (required && !value) throw new ReferralError('missing_field', 400, key);
    return value;
  };
  const name = text('name', LIMITS.name, { required: true });
  const email = text('email', LIMITS.email, { required: true }).toLowerCase();
  if (!EMAIL.test(email)) throw new ReferralError('invalid_field', 400, 'email');
  const roleTitle = text('roleTitle', LIMITS.roleTitle, { required: true });
  if (body.jobUrl === undefined || body.jobUrl === '') throw new ReferralError('missing_field', 400, 'jobUrl');
  const jobUrl = httpsUrl(body.jobUrl, LIMITS.jobUrl);
  if (!jobUrl) throw new ReferralError('invalid_field', 400, 'jobUrl');
  let profileUrl = '';
  if (body.profileUrl) {
    profileUrl = httpsUrl(body.profileUrl, LIMITS.profileUrl);
    if (!profileUrl) throw new ReferralError('invalid_field', 400, 'profileUrl');
  }
  const relationship = RELATIONSHIPS.some(item => item.id === body.relationship) ? body.relationship : null;
  if (!relationship) throw new ReferralError(body.relationship ? 'invalid_field' : 'missing_field', 400, 'relationship');
  let years = null;
  if (body.years !== undefined && body.years !== null && body.years !== '') {
    years = Number(body.years);
    if (!Number.isInteger(years) || years < 0 || years > 60) throw new ReferralError('invalid_field', 400, 'years');
  }
  const intro = text('intro', INTRO_MAX, { required: true, multiline: true });
  if (intro.length < INTRO_MIN) throw new ReferralError('intro_too_short', 400, 'intro');
  if (hasPlaceholder(intro)) throw new ReferralError('intro_placeholder', 400, 'intro');
  if (introVoice(intro) === 'first_person') throw new ReferralError('intro_not_third_person', 400, 'intro');
  if (body.consent !== true) throw new ReferralError('consent_required', 400, 'consent');
  return {
    name, email, profileUrl, roleTitle, jobUrl,
    jobId: text('jobId', LIMITS.jobId), location: text('location', LIMITS.location),
    requirements: text('requirements', LIMITS.requirements, { multiline: true }),
    relationship, relationshipNote: text('relationshipNote', LIMITS.relationshipNote),
    currentTitle: text('currentTitle', LIMITS.currentTitle), years, intro,
    whyRole: text('whyRole', LIMITS.whyRole, { multiline: true }),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The key the form generates once per request. Sending it again never creates a second request.
export function idempotencyKey(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ReferralError('invalid_fields', 400);
  return value.toLowerCase();
}
