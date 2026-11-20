export const DIAGNOSTIC_LIMIT = 100;
export const DEFAULT_THRESHOLDS = Object.freeze({ suspected: 50, high: 80 });
export const DIAGNOSTIC_RULES = Object.freeze([
  { id: 'burst', points: 35, title: 'Concurrent sessions', detail: 'At least 3 sessions on the same IP and path within 1 second of server receipt.' },
  { id: 'sequence', points: 25, title: 'Repeated navigation', detail: 'At least 3 sessions on the same IP repeat the same first 2 distinct pages within 10 minutes.' },
  { id: 'fast_read', points: 30, title: 'Rapid reading checkpoints', detail: 'A page view, an intermediate checkpoint and 100% within 3 seconds. Client timing is not independent proof.' },
]);

const ms = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const text = value => typeof value === 'string' ? value.trim() : '';
const key = (...parts) => JSON.stringify(parts);
const finiteScore = value => typeof value === 'number' && Number.isFinite(value);
const BOT_UA = /\b(?:googlebot|bingbot|gptbot|chatgpt-user|headlesschrome|facebookexternalhit|curl|wget|python-requests)\b|(?:bot|crawler|spider)\//i;

export function diagnosticThresholds(value = {}) {
  const suspected = finiteScore(value.suspected) ? Math.round(Math.max(1, Math.min(99, value.suspected))) : 50;
  const high = finiteScore(value.high) ? Math.round(Math.max(suspected + 1, Math.min(100, value.high))) : Math.max(suspected + 1, 80);
  return { suspected, high };
}

function pagePath(value) {
  if (!text(value)) return '';
  try {
    const url = new URL(value, 'https://preview.invalid');
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.pathname.replace(/\/$/, '') || '/';
  } catch { return ''; }
}

function sessionKey(event, index) {
  return key(event.siteId || '', text(event.sessionId) ? 'session' : 'missing', text(event.sessionId) || index);
}

function addReason(session, rule, evidence) {
  if (!session.reasons.some(reason => reason.id === rule.id)) session.reasons.push({ ...rule, evidence });
}

// Sliding windows count distinct sessions, never event volume or delivery retries.
function matchingWindows(entries, width, apply) {
  entries.sort((a, b) => a.time - b.time);
  for (let left = 0, right = 0; left < entries.length; left++) {
    while (right < entries.length && entries[right].time - entries[left].time <= width) right++;
    const members = new Map(entries.slice(left, right).map(entry => [entry.session.key, entry.session]));
    if (members.size >= 3) apply([...members.values()], entries[right - 1].time - entries[left].time);
  }
}

export function scoreVisitorSample(input = []) {
  const bounded = Array.isArray(input) ? input.slice(0, DIAGNOSTIC_LIMIT) : [];
  const seen = new Set(), events = [], sessions = new Map();
  let duplicates = 0, invalid = 0, grouped = 0;
  bounded.forEach((event, index) => {
    if (!event || typeof event !== 'object') { invalid++; return; }
    if (event.visit) { grouped++; return; }
    const identity = text(event.eventId) && key(event.siteId || '', event.eventId);
    if (identity && seen.has(identity)) { duplicates++; return; }
    if (identity) seen.add(identity);
    const id = sessionKey(event, index);
    if (!sessions.has(id)) sessions.set(id, { key: id, sessionId: text(event.sessionId), events: [], reasons: [] });
    sessions.get(id).events.push(event);
    events.push(event);
  });
  const bursts = new Map(), sequences = new Map();
  for (const session of sessions.values()) {
    session.events = [...session.events].sort((a, b) => (ms(a.eventTime) || 0) - (ms(b.eventTime) || 0));
    session.paths = [...new Set(session.events.map(event => pagePath(event.pageUrl)).filter(Boolean))];
    session.storedBotCount = session.events.filter(event => event.bot === true).length;
    let directScore = 0;
    for (const event of session.events) {
      const properties = event.properties || {};
      if (properties.botAssessmentProvider === 'GOOGLE_RECAPTCHA_ENTERPRISE' && properties.botAssessmentStatus === 'VALID') {
        const humanScore = properties.botAssessmentHumanScore;
        const risk = properties.botAssessmentVerifiedBot === true ? 100
          : finiteScore(humanScore) && humanScore >= 0 && humanScore <= 1 ? Math.round((1 - humanScore) * 100) : 0;
        if (risk >= 50 && risk > directScore) {
          directScore = risk;
          session.reasons = session.reasons.filter(reason => reason.id !== 'assessment');
          addReason(session, { id: 'assessment', title: 'Recorded CAPTCHA assessment', points: risk }, `Server-recorded risk ${risk}/100; applies to one event, not a verified identity.`);
        }
      }
      if (BOT_UA.test(text(event.userAgent))) {
        directScore = Math.max(directScore, 90);
        addReason(session, { id: 'ua', title: 'Automation user agent', points: 90 }, 'An explicit automation product appears in the user agent; the header can be spoofed.');
      }
      const receipt = ms(event.serverTime), path = pagePath(event.pageUrl);
      if (session.sessionId && event.eventName === 'page_view' && text(event.ipAddress) && path && Number.isFinite(receipt)) {
        const group = key(event.siteId || '', text(event.ipAddress), path);
        if (!bursts.has(group)) bursts.set(group, []);
        bursts.get(group).push({ session, time: receipt });
      }
    }
    session.directScore = directScore;
    if (!session.sessionId) continue;
    const pageViews = session.events.filter(event => event.eventName === 'page_view' && pagePath(event.pageUrl) && Number.isFinite(ms(event.eventTime)));
    const distinct = pageViews.filter((event, i) => !i || pagePath(event.pageUrl) !== pagePath(pageViews[i - 1].pageUrl));
    const ips = [...new Set(session.events.map(event => text(event.ipAddress)).filter(Boolean))];
    if (distinct.length >= 2 && ips.length === 1 && ms(distinct[1].eventTime) - ms(distinct[0].eventTime) <= 600000) {
      const group = key(distinct[0].siteId || '', ips[0], pagePath(distinct[0].pageUrl), pagePath(distinct[1].pageUrl));
      if (!sequences.has(group)) sequences.set(group, []);
      sequences.get(group).push({ session, time: ms(distinct[0].eventTime) });
    }
    for (const pageView of pageViews) {
      const start = ms(pageView.eventTime), path = pagePath(pageView.pageUrl);
      const nextView = pageViews.find(event => ms(event.eventTime) > start);
      const end = Math.min(start + 3000, nextView ? ms(nextView.eventTime) : Infinity);
      const checkpoints = session.events.filter(event => event.eventName === 'read_progress' && pagePath(event.pageUrl) === path && ms(event.eventTime) > start && ms(event.eventTime) <= end);
      const full = checkpoints.find(event => event.properties?.progressPercent === 100 && checkpoints.some(earlier => finiteScore(earlier.properties?.progressPercent) && earlier.properties.progressPercent > 0 && earlier.properties.progressPercent < 100 && ms(earlier.eventTime) < ms(event.eventTime)));
      if (full) {
        const serverStart = ms(pageView.serverTime), serverEnd = ms(full.serverTime);
        if (Number.isFinite(serverStart) && Number.isFinite(serverEnd) && (serverEnd < serverStart || serverEnd - serverStart > 5000)) continue;
        addReason(session, DIAGNOSTIC_RULES[2], `${path}: intermediate checkpoint to 100%, ${(ms(full.eventTime) - start) / 1000}s after page view (client time).`);
      }
    }
  }
  for (const entries of bursts.values()) matchingWindows(entries, 1000, (members, elapsed) => {
    members.forEach(session => addReason(session, DIAGNOSTIC_RULES[0], `${members.length} distinct sessions share an IP and path; server receipts span ${elapsed}ms.`));
  });
  for (const entries of sequences.values()) matchingWindows(entries, 600000, members => {
    members.forEach(session => addReason(session, DIAGNOSTIC_RULES[1], `${members.length} sessions repeat the same two-page sequence on one IP within 10 minutes (client time).`));
  });
  for (const session of sessions.values()) {
    const behavior = session.reasons.filter(reason => DIAGNOSTIC_RULES.some(rule => rule.id === reason.id));
    session.score = Math.min(100, Math.max(session.directScore, behavior.reduce((sum, reason) => sum + reason.points, 0)));
    session.eligible = session.directScore >= 50 || behavior.length >= 2;
  }
  return { sessions: [...sessions.values()], eventCount: events.length, duplicates, invalid, grouped,
    truncated: Array.isArray(input) && input.length > DIAGNOSTIC_LIMIT,
    missingReceipt: events.filter(event => !Number.isFinite(ms(event.serverTime))).length,
    missingSession: events.filter(event => !text(event.sessionId)).length,
    missingEventId: events.filter(event => !text(event.eventId)).length,
    missingAssessment: events.filter(event => event.properties?.botAssessmentStatus !== 'VALID').length };
}

export function classifyVisitorSample(sample, value = DEFAULT_THRESHOLDS) {
  const thresholds = diagnosticThresholds(value);
  const sessions = sample.sessions.map(session => ({ ...session, verdict: !session.eligible || session.score < thresholds.suspected ? 'undetermined' : session.score >= thresholds.high ? 'high' : 'suspected' }));
  sessions.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const candidates = sessions.filter(session => session.verdict !== 'undetermined');
  const stored = sessions.reduce((sum, session) => sum + session.storedBotCount, 0);
  const additional = candidates.reduce((sum, session) => sum + session.events.length - session.storedBotCount, 0);
  return { thresholds, sessions, counts: { stored, additional, combined: stored + additional,
    candidates: candidates.reduce((sum, session) => sum + session.events.length, 0),
    high: sessions.filter(session => session.verdict === 'high').length,
    suspected: sessions.filter(session => session.verdict === 'suspected').length,
    undetermined: sessions.filter(session => session.verdict === 'undetermined').length } };
}
