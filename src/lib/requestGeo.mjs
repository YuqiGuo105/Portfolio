// Approximate visitor location from Vercel's edge geo headers. City-level only and rounded to one
// decimal (about 11 km), so nothing finer than "which city" is ever used or shown. Local dev and
// non-Vercel hosts have no headers and get null.

const clampNumber = (value, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const headerText = (value, max = 80) => {
  if (typeof value !== 'string' || !value) return '';
  let text = value;
  try { text = decodeURIComponent(value); } catch { /* keep raw */ }
  return text.normalize('NFKC').replace(/[<>][\s\S]*$/, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
};

export function requestGeo(headers = {}) {
  const lat = clampNumber(headers['x-vercel-ip-latitude'], -90, 90);
  const lng = clampNumber(headers['x-vercel-ip-longitude'], -180, 180);
  if (lat === null || lng === null) return null;
  const country = headerText(headers['x-vercel-ip-country'], 2).toUpperCase();
  return {
    lat: Math.round(lat * 10) / 10,
    lng: Math.round(lng * 10) / 10,
    city: headerText(headers['x-vercel-ip-city']),
    country: /^[A-Z]{2}$/.test(country) ? country : '',
  };
}

export function clientIp(req) {
  const headers = req?.headers || {};
  const forwarded = process.env.VERCEL ? headers['x-vercel-forwarded-for'] || headers['x-forwarded-for'] : null;
  return String(forwarded || req?.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

// Same-origin JSON POST guard used by the playground; rejects cross-site form posts and CSRF.
export function sameOriginJson(req) {
  const headers = req?.headers || {};
  if (!/^application\/json(?:;|$)/i.test(headers['content-type'] || '')) return 'json_required';
  if (headers['sec-fetch-site'] === 'cross-site') return 'invalid_origin';
  try {
    if (headers.origin && new URL(headers.origin).host !== headers.host) return 'invalid_origin';
  } catch { return 'invalid_origin'; }
  return null;
}

// Presence payloads come from other browsers: keep only well-formed, rounded, city-level fields.
export function cleanPeer(meta) {
  const lat = clampNumber(meta?.lat, -90, 90);
  const lng = clampNumber(meta?.lng, -180, 180);
  if (lat === null || lng === null) return null;
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  return { lat: Math.round(lat * 10) / 10, lng: Math.round(lng * 10) / 10, city: text(meta.city, 60), country: text(meta.country, 2) };
}
