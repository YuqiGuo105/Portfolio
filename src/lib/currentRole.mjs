// Who Yuqi works for right now, read from the work history (the `experience` table).
//
// This is the one place the site learns the current employer from. The home page introduction,
// structured data, llms.txt and the referral form all use it, so a job change is one edit to the
// work history (/admin/experience) and nothing in the code names an employer.
//
// A row is the current role when its period ends in "Current" / "Present" (e.g. "Dec 2024 - Current").
const OPEN_END = /(?:^|[\s\-–—~至到])(current|present|now|today|ongoing|至今|现在|目前)\s*$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const EMPLOYMENT_TYPE = /\s*[-–—·|,]\s*\(?(full[- ]?time|part[- ]?time|contract(or)?|intern(ship)?|temporary|freelance)\)?\s*$/i;
const line = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export const isCurrentPeriod = period => OPEN_END.test(line(period, 120));

// "Dec 2024 - Current" → { label: "Dec 2024", order: 24299 } (order only ranks periods against each other).
export function periodStart(period) {
  const label = line(period, 120).split(/\s+[-–—~]\s+|\s+to\s+/i)[0] || '';
  const year = Number((label.match(/\b(?:19|20)\d{2}\b/) || [])[0] || 0);
  const named = MONTHS.findIndex(month => label.toLowerCase().includes(month));
  const numbered = Number((label.match(/\b(?:19|20)\d{2}[./-](\d{1,2})\b/) || label.match(/\b(\d{1,2})[./-](?:19|20)\d{2}\b/) || [])[1] || 0);
  const month = named >= 0 ? named : numbered >= 1 && numbered <= 12 ? numbered - 1 : 0;
  return { label, order: year ? year * 12 + month : 0 };
}

// "Software Engineer - Full-time" → "Software Engineer"
export const roleTitle = subname => line(subname, 140).replace(EMPLOYMENT_TYPE, '').trim();

export const sameCompany = (a, b) => Boolean(line(a, 160)) && line(a, 160).toLowerCase() === line(b, 160).toLowerCase();

// The current role, or null when no row is open-ended (between jobs). With several open-ended
// rows, the one that started last wins.
export function currentRole(rows) {
  const open = (Array.isArray(rows) ? rows : [])
    .filter(row => row && line(row.name, 160) && isCurrentPeriod(row.date))
    .map(row => ({ row, order: periodStart(row.date).order }))
    .sort((a, b) => b.order - a.order || Number(b.row.id || 0) - Number(a.row.id || 0));
  if (!open.length) return null;
  const { row } = open[0];
  return {
    id: String(row.id ?? ''),
    company: line(row.name, 160),
    title: roleTitle(row.subname),
    since: periodStart(row.date).label,
    team: line(String(row.text || '').split('\n')[0], 200),
  };
}

// Every employer in the work history, current first. Used where past employers matter too.
export const employers = rows => [...new Set((Array.isArray(rows) ? rows : [])
  .slice().sort((a, b) => periodStart(b?.date).order - periodStart(a?.date).order)
  .map(row => line(row?.name, 160)).filter(Boolean))];

// Optional public home pages for structured data. An employer that is not listed is published by name only.
const EMPLOYER_URLS = { 'goldman sachs': 'https://www.goldmansachs.com/' };
export const employerUrl = company => EMPLOYER_URLS[line(company, 160).toLowerCase()] || null;

// A cached reader for server code. `load` returns the work-history rows. A failed read keeps the
// last good answer; with no answer yet it reports `known: false` so callers can say "try again"
// instead of treating an outage as "no employer".
export function createRoleSource({ load, ttlMs = 5 * 60 * 1000, now = Date.now, log = message => console.warn(message) } = {}) {
  let cached = null, readAt = 0, pending = null;
  const read = async () => {
    try {
      const rows = await load();
      // An empty list is not proof of "no employer": a failed or unconfigured read looks the same.
      if (!Array.isArray(rows) || !rows.length) throw new Error('work history is empty or unavailable');
      cached = { role: currentRole(rows), employers: employers(rows), known: true };
    } catch (error) {
      log(`[current-role] ${error?.message || error}`);
      cached = cached ? { ...cached, stale: true } : { role: null, employers: [], known: false };
    }
    readAt = now();
    return cached;
  };
  return {
    async get() {
      if (cached && now() - readAt < (cached.known && !cached.stale ? ttlMs : Math.min(ttlMs, 15000))) return cached;
      pending ||= read().finally(() => { pending = null; });
      return pending;
    },
    // Forget how fresh the answer is, but keep it as the fallback for a failed read.
    clear() { readAt = -Infinity; },
  };
}
