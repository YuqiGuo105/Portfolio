// What an applicant can see about their own request, and the link that shows it.
//
// The link carries a token made from the request's id and a server secret, so it can be rebuilt
// for an email at any time and nothing extra is stored. It travels in the URL fragment
// (/talk/status#<token>), which browsers never send to a server or put in a Referer header.
//
// The applicant sees where the request stands and nothing else: no score, no screening note, no
// reason. Those are the owner's.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { storedRoles } from './roles.mjs';

const secret = env => env.REFERRAL_STATUS_SECRET || env.CRON_SECRET || '';
const mac = (id, key) => createHmac('sha256', key).update(`referral-status:v1:${id}`).digest().subarray(0, 16);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// '' when no secret is configured: the form then simply shows no link.
export function statusToken(id, env = process.env) {
  const key = secret(env);
  if (!key || !UUID.test(String(id || '').toLowerCase())) return '';
  return `${Buffer.from(String(id).replaceAll('-', ''), 'hex').toString('base64url')}.${mac(String(id).toLowerCase(), key).toString('base64url')}`;
}

// The request id a token was made for, or null.
export function readStatusToken(token, env = process.env) {
  const key = secret(env);
  if (!key || typeof token !== 'string' || !/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const [head, tail] = token.split('.');
  const hex = Buffer.from(head, 'base64url').toString('hex');
  if (hex.length !== 32) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const given = Buffer.from(tail, 'base64url');
  const expected = mac(id, key);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export const statusUrl = (id, env = process.env) => {
  const token = statusToken(id, env);
  return token ? `${String(env.REFERRAL_SITE_URL || 'https://www.yuqi.site').replace(/\/+$/, '')}/talk/status#${token}` : '';
};

// 'screening'     received; the résumé is being checked and the request screened
// 'file_problem'  the résumé could not be used; the applicant may send the request again
// 'review'        waiting for Yuqi
// 'qualified'     meets the bar; Yuqi has been asked to submit the referral
// 'referred'      Yuqi marked it referred
// 'not_selected'  declined, by the screening bar or by Yuqi (the page does not say which)
// 'closed'        archived
export function applicantStage(row) {
  if (row.status === 'referred') return 'referred';
  if (row.status === 'declined') return 'not_selected';
  if (row.status === 'archived') return 'closed';
  if (row.state === 'file_rejected') return 'file_problem';
  if (row.state !== 'ready') return 'screening';
  return row.status === 'new' && row.outcome === 'passed' ? 'qualified' : 'review';
}

export function publicStatus(row) {
  return { reference: row.reference, company: row.company || '', roles: storedRoles(row).map(role => role.roleTitle).filter(Boolean),
    receivedAt: row.created_at, updatedAt: row.updated_at, stage: applicantStage(row) };
}
