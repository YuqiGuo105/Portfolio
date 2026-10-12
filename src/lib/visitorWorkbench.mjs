export function referrerOrigin(value) {
  if (!value || typeof value !== 'string' || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return null;
    return { domain: url.hostname.toLowerCase(), href: url.origin };
  } catch { return null; }
}

export function mapLink(item) {
  const parts = [item.city, item.region, item.country].filter(value => typeof value === 'string' && value.trim() && !/^unknown$/i.test(value));
  return parts.length ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}` : null;
}

export function scrollDepthPercent(event) {
  const value = event?.properties?.progressPercent ?? event?.progressPercent;
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const percent = Number(value);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent) : null;
}

export function eventTimestamp(value, zone = 'local') {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'medium', ...(zone === 'UTC' ? { timeZone: 'UTC' } : {}),
  }).format(date) + (zone === 'UTC' ? ' UTC' : ` ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
}

export function sessionWindow(item, hours = 24, now = Date.now()) {
  const eventTime = Date.parse(item.eventTime);
  const end = Math.max(now, Number.isFinite(eventTime) ? eventTime + 1000 : now);
  const start = Math.min(end - hours * 3600000, Number.isFinite(eventTime) ? eventTime - 1000 : end);
  return { from: new Date(Math.max(start, end - 31 * 86400000)).toISOString(), to: new Date(end).toISOString() };
}

export function alertFromVisitor(item, siteId = '') {
  // City names are not canonical metro IDs. Use only the recorded country/region codes.
  const country = /^[A-Z]{2}$/.test(item.country || '') ? item.country : '';
  const region = country && /^[A-Z0-9-]{1,12}$/.test(item.region || '') ? item.region : '';
  return {
    ruleId: null, siteId: item.siteId || siteId, name: `Visits from ${[item.city, item.region, country].filter(Boolean).join(', ') || 'this source'}`,
    eventType: item.eventName || 'page_view', geoLevel: region ? 'REGION' : country ? 'COUNTRY' : 'GLOBAL',
    geoAreaId: region ? `REGION:${country}:${region}` : country ? `COUNTRY:${country}` : '',
    granularity: '5m', threshold: 1, comparator: '>=', cooldownSeconds: 1800, enabled: false,
    filters: { bot: item.bot === true ? 'ONLY' : item.bot === false ? 'EXCLUDE' : 'ALL', referrerDomain: referrerOrigin(item.referrer)?.domain || '' },
  };
}

export function assessmentEvidence(item) {
  const p = item.properties || {};
  const score = p.botAssessmentHumanScore;
  return {
    stored: item.bot === true ? 'Detected bot' : item.bot === false ? 'Not classified as a bot' : 'No classification',
    provider: typeof p.botAssessmentProvider === 'string' ? p.botAssessmentProvider : 'Not recorded',
    status: typeof p.botAssessmentStatus === 'string' ? p.botAssessmentStatus : 'Not recorded',
    score: p.botAssessmentStatus === 'VALID' && typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1 ? score : null,
    reasons: Array.isArray(p.botAssessmentReasons) ? p.botAssessmentReasons.filter(v => typeof v === 'string').slice(0, 20) : [],
    verifiedBot: p.botAssessmentVerifiedBot === true,
  };
}

const SAVED_FIELDS = ['bot', 'event', 'path', 'country', 'city', 'device', 'browser', 'referrer'];
export function sanitizeSavedView(value) {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || ![24, 168, 720].includes(value.hours)) return null;
  const filters = {};
  for (const field of SAVED_FIELDS) {
    const entry = value.filters?.[field];
    if (typeof entry === 'string' && entry.length <= 256) filters[field] = entry;
  }
  if (!['ALL', 'ONLY', 'EXCLUDE'].includes(filters.bot)) filters.bot = 'ALL';
  // Deliberately omit free text, IPs and visitor identifiers from browser persistence.
  return { name: value.name.trim().slice(0, 60), hours: value.hours, filters };
}

export function readSavedViews(raw) {
  try { const data = JSON.parse(raw); return Array.isArray(data) ? data.slice(0, 12).map(sanitizeSavedView).filter(Boolean) : []; }
  catch { return []; }
}
