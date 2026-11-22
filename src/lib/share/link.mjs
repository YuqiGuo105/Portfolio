// Share links: the page's own address plus a short note of how it was passed on (`via`), and, for
// a shared passage, the passage itself (`quote`). Nothing here is looked up in a database when a
// link is opened, so a link that spreads widely costs the site nothing extra.
export const SITE_ORIGIN = 'https://www.yuqi.site';
export const VIAS = ['link', 'qr', 'image', 'system', 'quote', 'card', 'answer', 'tailored', 'linkedin', 'x', 'email'];
export const QUOTE_LIMIT = 280;

const toBase64Url = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = value => {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
};

export const tidy = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// A selection cut to a length that fits a link and a picture, ending on a whole word.
export function trimQuote(text, limit = QUOTE_LIMIT) {
  const clean = tidy(text);
  const chars = [...clean];
  if (chars.length <= limit) return clean;
  const cut = chars.slice(0, limit).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

export const encodeQuote = text => toBase64Url(trimQuote(text));
export function decodeQuote(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{4,1600}$/.test(value)) return '';
  try { return trimQuote(fromBase64Url(value)); } catch { return ''; }
}

// The address to hand out: this site only, no leftovers from the link the sharer arrived by.
export function shareUrl(href, via, { quote = '', origin = SITE_ORIGIN } = {}) {
  let url;
  try { url = new URL(href, origin); } catch { url = new URL(origin); }
  const out = new URL(url.pathname + url.search, origin);
  for (const key of ['via', 'quote', 'intent']) out.searchParams.delete(key);
  if (VIAS.includes(via)) out.searchParams.set('via', via);
  const passage = tidy(quote);
  if (passage) out.searchParams.set('quote', encodeQuote(passage));
  return out.href;
}

export function readShare(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const via = params.get('via');
  return { via: VIAS.includes(via) ? via : null, quote: decodeQuote(params.get('quote') || '') };
}

// Where a passage sits among a page's text nodes. `texts` are the nodes' raw strings in document
// order; white space is compared loosely, because a selection and the markup rarely agree on it.
// Returns { start: [node, offset], end: [node, offset] } (end is exclusive) or null.
export function locateQuote(texts, quote) {
  const wanted = tidy(quote).replace(/…$/, '').trim();
  if (wanted.length < 3) return null;
  let stream = '';
  const origin = [];
  let gap = true; // true while the last character kept was a space (or nothing has been kept yet)
  texts.forEach((text, node) => {
    for (let offset = 0; offset < text.length; offset += 1) {
      const char = text[offset];
      if (/\s/.test(char)) {
        if (!gap) { stream += ' '; origin.push([node, offset]); gap = true; }
      } else { stream += char; origin.push([node, offset]); gap = false; }
    }
  });
  const index = stream.indexOf(wanted);
  if (index < 0) return null;
  const last = origin[index + wanted.length - 1];
  return { start: origin[index], end: [last[0], last[1] + 1] };
}
