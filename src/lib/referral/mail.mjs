// The notification the owner receives about referral requests. It is a digest: one email covers
// every request that became ready since the last one, so a busy day sends a handful of emails
// rather than one per request. Up to three requests are shown in full, with the applicant's own
// third-person introduction ready to copy; beyond that it is a list that links to the review page.
// No résumé is attached: the file is opened from the review page.
import { RELATIONSHIPS } from './config.mjs';
import { currentScreening, EVIDENCE_PATHS, screeningLabel, screeningRank } from './rubric.mjs';
import { storedRoles } from './roles.mjs';

const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const oneLine = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const FLAG_TEXT = { spam: 'Looks like spam or mass outreach', injection: 'The text tried to instruct the screening model', off_topic: 'May not be a referral request', incomplete: 'Key details are missing' };

export function signalOf(row) {
  if (row.state === 'file_rejected') return 'résumé refused';
  const note = row.screening || {};
  return screeningLabel(note);
}

function fullText(row) {
  const note = row.screening || {};
  const roles = storedRoles(row);
  const relationship = RELATIONSHIPS.find(item => item.id === row.relationship)?.label || row.relationship;
  const ai = note.source === 'ai';
  const paths = currentScreening(note) && note.criteria ? Object.entries(EVIDENCE_PATHS).map(([id, label]) => {
    const item = note.criteria[id];
    return `${label}: ${item.score}/100; ${item.eligible ? 'meets the gate' : item.pendingBadge ? 'official badge not confirmed' : 'below the gate'}. ${item.reason}`;
  }) : [];
  const lists = [['Evidence paths', paths], [ai ? 'Strengths' : 'Provided', note.strengths], [ai ? 'Concerns' : 'Missing', note.concerns], ['Worth asking', note.followUps],
    ['Flags', (note.flags || []).map(flag => FLAG_TEXT[flag] || flag)]].filter(([, items]) => items?.length);
  const details = [...roles.flatMap((role, index) => [
    [`Role ${index + 1}${index === 0 ? ' (first choice)' : ''}`, role.roleTitle],
    [`Posting ${index + 1}`, role.jobUrl], [`Job ID ${index + 1}`, role.jobId], [`Location ${index + 1}`, role.location],
    [`Requirements ${index + 1}`, role.requirements],
  ]), ['Applicant', `${row.name} <${row.email}>`],
    ['Profile', row.profile_url], ['Now', row.current_title],
    ['Experience', row.years_experience === null || row.years_experience === undefined ? '' : `${row.years_experience} year${row.years_experience === 1 ? '' : 's'}`],
    ['Connection', [relationship, row.relationship_note].filter(Boolean).join(' — ')], ['Reference', row.reference]].filter(([, value]) => value);
  return { lists, details, lines: [
    `${row.name} — ${row.role_title}${row.company ? ` at ${row.company}` : ''}`, `Signal: ${signalOf(row)}`, note.summary || '',
    ...lists.flatMap(([title, items]) => ['', `${title}:`, ...items.map(item => `- ${item}`)]), '',
    'Their introduction, in their own words:', row.intro, '',
    ...(row.why_role ? [roles.length > 1 ? 'Why these roles:' : 'Why this role:', row.why_role, ''] : []),
    ...details.map(([key, value]) => `${key}: ${value}`),
  ] };
}

export function referralDigestMail(rows, { adminUrl = 'https://www.yuqi.site/admin/referrals', waiting = 0 } = {}) {
  const sorted = [...rows].sort((a, b) => screeningRank(b.screening) - screeningRank(a.screening));
  const passed = sorted.filter(row => currentScreening(row.screening) && row.screening?.passed === true).length;
  const single = sorted.length === 1 ? sorted[0] : null;
  const subject = single
    ? `Referral request: ${single.additional_roles?.length ? `${single.additional_roles.length + 1} roles` : single.role_title} · ${single.name} (${signalOf(single)})`
    : `${sorted.length} new referral requests${passed ? ` (${passed} passed initial screening)` : ''}`;
  const caveat = '60/100 requires at least one strong evidence path. AI assesses submitted material; links and claims are not independently verified. The owner records official LinkedIn badge checks separately. This is not a referral decision.';
  const more = waiting > 0 ? `${waiting} more ${waiting === 1 ? 'is' : 'are'} still being screened.` : '';
  const detailed = sorted.length <= 3;

  const text = [
    ...(detailed
      ? sorted.flatMap((row, index) => [...(index ? ['', '────────', ''] : []), ...fullText(row).lines])
      : sorted.map(row => `- ${row.name} — ${storedRoles(row).map(role => role.roleTitle).join(' / ')} — ${signalOf(row)}`)),
    '', more, `Review them: ${adminUrl}`, caveat,
  ].filter(lineText => lineText !== undefined && lineText !== null).join('\n').replace(/\n{3,}/g, '\n\n');

  const para = value => `<p style="margin:0;white-space:pre-wrap;line-height:1.55">${escapeHtml(value)}</p>`;
  const card = row => {
    const { lists, details } = fullText(row);
    return `<div style="margin:0 0 22px;padding:16px 18px;border:1px solid #c9d2cd;border-radius:8px">`
      + `<p style="margin:0 0 4px;font-size:16px"><strong>${escapeHtml(row.name)}</strong> · ${escapeHtml(row.role_title)}</p>`
      + `<p style="margin:0 0 10px;font-weight:600;color:#245449">${escapeHtml(signalOf(row))}</p>${para(row.screening?.summary || '')}`
      + lists.map(([title, items]) => `<p style="margin:12px 0 4px;font-weight:600">${escapeHtml(title)}</p><ul style="margin:0;padding-left:18px">${items.map(item => `<li style="margin:2px 0">${escapeHtml(item)}</li>`).join('')}</ul>`).join('')
      + `<p style="margin:16px 0 6px;font-weight:600">Their introduction, in their own words</p><div style="border-left:3px solid #245449;padding:2px 0 2px 12px">${para(row.intro)}</div>`
      + (row.why_role ? `<p style="margin:16px 0 6px;font-weight:600">${row.additional_roles?.length ? 'Why these roles' : 'Why this role'}</p>${para(row.why_role)}` : '')
      + `<table style="margin-top:14px;border-collapse:collapse;font-size:13px">${details.map(([key, value]) =>
        `<tr><td style="padding:3px 14px 3px 0;color:#5b6b66;vertical-align:top">${escapeHtml(key)}</td><td style="padding:3px 0">${escapeHtml(value)}</td></tr>`).join('')}</table></div>`;
  };
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#1d2a27;max-width:680px">`
    + (detailed ? sorted.map(card).join('')
      : `<p style="margin:0 0 12px;font-size:16px"><strong>${sorted.length} new referral requests</strong></p><table style="border-collapse:collapse;font-size:14px">${sorted.map(row =>
        `<tr><td style="padding:5px 16px 5px 0"><strong>${escapeHtml(row.name)}</strong></td><td style="padding:5px 16px 5px 0">${escapeHtml(storedRoles(row).map(role => role.roleTitle).join(' / '))}</td><td style="padding:5px 0;color:#245449">${escapeHtml(signalOf(row))}</td></tr>`).join('')}</table>`)
    + (more ? `<p style="margin:14px 0 0">${escapeHtml(more)}</p>` : '')
    + `<p style="margin:18px 0 0"><a href="${escapeHtml(adminUrl)}">Open the review page</a></p>`
    + `<p style="margin:10px 0 0;font-size:12px;color:#5b6b66">${escapeHtml(caveat)}</p></div>`;

  return { subject: oneLine(subject).slice(0, 200), ...(single ? { replyTo: single.email } : {}), text, html };
}

export async function sendReferralMail(mail, { env = process.env } = {}) {
  const { EMAIL_USER: user, EMAIL_PASS: pass, EMAIL_TO: to } = env;
  if (!user || !pass || !to) throw new Error('Referral email is not configured');
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 20000 });
  await transporter.sendMail({ from: `"Referral requests" <${user}>`, to, ...mail });
}
