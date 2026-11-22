// A contact card as a .vcf file (vCard 3.0, which iPhone, Android and desktop address books all
// open as "add this contact"). Only the fields that are passed in are written.
const escape = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1').trim();

// Lines longer than 75 bytes continue on the next line after one space (RFC 2426); a multi-byte
// character is never split.
export function foldLine(line) {
  const encoder = new TextEncoder();
  const out = [];
  let current = '', bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > (out.length ? 74 : 75)) { out.push(current); current = ''; bytes = 0; }
    current += char; bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

const cleanUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
export const cleanPhone = value => { const text = String(value ?? '').trim(); const digits = text.replace(/\D/g, ''); return /^\+?[\d\s().-]{7,24}$/.test(text) && digits.length >= 7 && digits.length <= 15 ? text.replace(/\s+/g, ' ') : ''; };
export const cleanEmail = value => { const text = String(value ?? '').trim(); return text.length <= 120 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(text) ? text : ''; };

// card: { given, family, nickname, company, title, phone, email, site, links: [{ label, url }], note, photo: { type, base64 } }
export function buildVCard(card) {
  const given = escape(card.given), family = escape(card.family);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${family};${given};;;`, `FN:${[given, family].filter(Boolean).join(' ')}`];
  if (card.nickname) lines.push(`NICKNAME:${escape(card.nickname)}`);
  if (card.company) lines.push(`ORG:${escape(card.company)}`);
  if (card.title) lines.push(`TITLE:${escape(card.title)}`);
  const phone = cleanPhone(card.phone);
  if (phone) lines.push(`TEL;TYPE=CELL,VOICE:${phone.replace(/[^\d+]/g, '')}`);
  const email = cleanEmail(card.email);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escape(email)}`);
  const site = cleanUrl(card.site);
  if (site) lines.push(`URL:${site}`);
  (card.links || []).slice(0, 6).forEach((link, index) => {
    const url = cleanUrl(link?.url);
    if (!url) return;
    const label = escape(link.label).slice(0, 40) || 'Link';
    if (!card.compact && /^(linkedin|github|twitter)$/i.test(label)) lines.push(`X-SOCIALPROFILE;TYPE=${label.toLowerCase()}:${url}`);
    lines.push(`item${index + 1}.URL:${url}`, `item${index + 1}.X-ABLabel:${label}`);
  });
  if (card.note) lines.push(`NOTE:${escape(card.note).slice(0, 400)}`);
  if (card.photo?.base64 && /^(PNG|JPEG)$/.test(card.photo.type)) lines.push(`PHOTO;ENCODING=b;TYPE=${card.photo.type}:${card.photo.base64}`);
  lines.push('END:VCARD');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// The same contact, written into a QR code: a phone camera that scans it offers "Add contact"
// straight away, with no web page in between. No photo (it would not fit) and no social-profile
// duplicates, so the code stays small enough to scan from a screen.
export const vcardForQr = card => buildVCard({ ...card, photo: null, note: '', compact: true });
