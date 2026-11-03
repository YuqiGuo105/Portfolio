// The view counter on the GitHub profile README (github.com/YuqiGuo105). The README embeds
// /api/badge/github-profile as an image, and GitHub fetches README images through its Camo image proxy on
// every profile load, so each Camo fetch is one profile view. The view goes into the analytics Kafka topic
// as a `github_profile_view` event, the admin visitor workbench labels it, and the badge shows the running
// total from the aggregator's daily rollups.
//
// Privacy: Camo hides the viewer, so GitHub's server IP and its user agent are all the request carries. The
// event keeps the user agent and nothing else: no IP, no session, no location. The public site stats count
// page views only, so these events never inflate them.

export const GITHUB_PROFILE_VIEW_EVENT = "github_profile_view";
export const GITHUB_PROFILE_URL = "https://github.com/YuqiGuo105";
export const SITE_ID = "yuqi.site";

export const BADGE_LABEL = "profile views";
// GitHub's link blue, so the badge reads as part of the profile page.
export const BADGE_COLOR = "#0969da";
export const BADGE_RATE_LIMIT = Object.freeze({ limit: 120, windowMs: 60_000 });
// The total is read from the rollups at most once a minute per server instance.
export const COUNT_CACHE_MS = 60_000;
export const COUNT_TIMEOUT_MS = 2_500;
// Camo gives up on slow images, so a slow Kafka produce must not hold the badge back.
export const RECORD_TIMEOUT_MS = 3_500;

// Camo re-fetches an image on every profile load only when the response forbids caching.
export const BADGE_HEADERS = Object.freeze({
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
});

// GitHub's image proxy names itself "github-camo (<build id>)".
export function isGithubCamo(userAgent) {
  return /^github-camo\b/i.test(String(userAgent || "").trim());
}

export function isGithubProfileView(item) {
  return item?.eventName === GITHUB_PROFILE_VIEW_EVENT || item?.eventType === GITHUB_PROFILE_VIEW_EVENT;
}

// What the admin workbench shows as the "page" of a GitHub profile view.
export function githubProfileContent(item) {
  if (!isGithubProfileView(item)) return null;
  return { title: "GitHub profile README", type: "GitHub", canonicalUrl: GITHUB_PROFILE_URL };
}

// The RawEvent for one profile view, in the wire format analytics-aggregator-service reads (see pages/api/track.js).
// Without a session, anonymous id or IP the aggregator builds no session for it, and without a geo hint it lands
// on the GLOBAL rollup only, so it never adds a pin to the globe.
export function githubProfileViewEvent({ eventId, now = new Date(), userAgent }) {
  const time = now.toISOString();
  return {
    eventId,
    schemaVersion: 1,
    siteId: SITE_ID,
    eventType: GITHUB_PROFILE_VIEW_EVENT,
    eventTime: time,
    serverTime: time,
    sessionId: null,
    anonId: null,
    consentState: "unknown",
    pageUrl: GITHUB_PROFILE_URL,
    targetUrl: null,
    referrer: GITHUB_PROFILE_URL,
    uaRaw: String(userAgent || "").slice(0, 255),
    ipRaw: null,
    ipHash: null,
    properties: {},
    geoHint: null,
  };
}

// The legacy visitor_logs row, written only when Kafka is unavailable (the same fallback as /api/track).
export function fallbackVisitorLog(event) {
  return {
    ip: "redacted",
    local_time: event.eventTime,
    event: GITHUB_PROFILE_VIEW_EVENT,
    ua: "server-fallback",
    country: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null,
    created_at: event.serverTime,
  };
}

export function sumEventCounts(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => {
    const count = Number(row?.event_count);
    return Number.isFinite(count) && count > 0 ? total + count : total;
  }, 0);
}

export function formatCount(count) {
  const value = Number(count);
  if (count === null || count === undefined || !Number.isFinite(value) || value < 0) return "–";
  return new Intl.NumberFormat("en-US").format(Math.floor(value));
}

// Verdana advance widths at 11px, the font shields.io badges use. Each text gets an explicit textLength, so
// the badge looks the same wherever Verdana is missing.
const CHAR_WIDTHS = {
  " ": 3.9, ",": 3.9, ".": 3.9, ":": 4.5, "-": 4.5, "–": 7, "(": 4.5, ")": 4.5,
  a: 6.6, b: 6.9, c: 5.7, d: 6.9, e: 6.6, f: 3.9, g: 6.9, h: 7, i: 3, j: 3.6, k: 6.3, l: 3, m: 10.7,
  n: 7, o: 6.7, p: 6.9, q: 6.9, r: 4.7, s: 5.7, t: 4.3, u: 7, v: 6.3, w: 9, x: 6.3, y: 6.3, z: 5.9,
};

export function textWidth(text) {
  let width = 0;
  for (const char of String(text)) {
    if (/[0-9]/.test(char)) width += 7;
    else if (char in CHAR_WIDTHS) width += CHAR_WIDTHS[char];
    else width += /[A-Z]/.test(char) ? 7.5 : 7;
  }
  return Math.round(width * 10) / 10;
}

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]
));

const round1 = (value) => Math.round(value * 10) / 10;

// A flat shields.io-style badge: grey label on the left, the count on the right.
export function renderViewBadge({ count, label = BADGE_LABEL, color = BADGE_COLOR } = {}) {
  const message = formatCount(count);
  const labelText = textWidth(label);
  const messageText = textWidth(message);
  const left = Math.ceil(labelText + 10);
  const right = Math.ceil(messageText + 10);
  const width = left + right;
  const title = escapeXml(`${label}: ${message}`);
  const safeLabel = escapeXml(label);
  const safeMessage = escapeXml(message);
  const text = (x, value, length) =>
    `<text x="${round1(x)}" y="15" fill="#010101" fill-opacity=".3" textLength="${length}" lengthAdjust="spacingAndGlyphs">${value}</text>`
    + `<text x="${round1(x)}" y="14" textLength="${length}" lengthAdjust="spacingAndGlyphs">${value}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">`
    + `<title>${title}</title>`
    + `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`
    + `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`
    + `<g clip-path="url(#r)"><rect width="${left}" height="20" fill="#555"/><rect x="${left}" width="${right}" height="20" fill="${escapeXml(color)}"/><rect width="${width}" height="20" fill="url(#s)"/></g>`
    + `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">`
    + text(left / 2, safeLabel, labelText)
    + text(left + right / 2, safeMessage, messageText)
    + `</g></svg>`;
}

function firstHeader(value) {
  return String(Array.isArray(value) ? value[0] : value || "");
}

function clientIp(req) {
  const forwarded = firstHeader(req?.headers?.["x-forwarded-for"]).split(",")[0].trim();
  return forwarded || req?.socket?.remoteAddress || "unknown";
}

function withTimeout(promise, ms, timeoutValue) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(timeoutValue), ms); });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

const TIMED_OUT = Symbol("timed out");

// The badge endpoint with its dependencies passed in, so tests can run it without Kafka, Supabase or Valkey.
// `produce(event)` resolves true once Kafka has the event; `fallbackInsert(row)` resolves { ok };
// `loadCount()` resolves the recorded total (or null when unknown); `rateLimited(ip)` resolves true to skip.
export function createGithubBadgeHandler({
  produce,
  fallbackInsert,
  loadCount,
  rateLimited = async () => false,
  newEventId,
  isLocal = () => false,
  now = () => new Date(),
  clock = () => Date.now(),
  log = console,
} = {}) {
  // Per server instance: the last total read from the rollups, the views this instance recorded since then
  // (Kafka has them, the rollups may not yet), and the last number shown, which never goes down.
  const state = { base: null, readAt: -Infinity, pending: 0, shown: null, loading: null };

  async function refreshBase() {
    if (state.base !== null && clock() - state.readAt < COUNT_CACHE_MS) return;
    if (!state.loading) {
      state.loading = withTimeout(Promise.resolve().then(loadCount), COUNT_TIMEOUT_MS, TIMED_OUT)
        .then((count) => {
          if (count === TIMED_OUT) { log.warn?.("[GithubBadge] count read timed out"); return; }
          const value = Number(count);
          if (count === null || count === undefined || !Number.isFinite(value) || value < 0) return;
          state.base = Math.floor(value);
          state.readAt = clock();
          state.pending = 0;
        })
        .catch((error) => log.warn?.("[GithubBadge] count read failed:", error?.message || error))
        .finally(() => { state.loading = null; });
    }
    await state.loading;
  }

  async function record(req, userAgent) {
    try {
      if (await rateLimited(clientIp(req))) return "rate_limited";
    } catch (error) {
      log.warn?.("[GithubBadge] rate limiter failed:", error?.message || error);
    }
    const event = githubProfileViewEvent({ eventId: newEventId(), now: now(), userAgent });
    let sent;
    try {
      sent = await withTimeout(produce(event), RECORD_TIMEOUT_MS, TIMED_OUT);
    } catch {
      sent = false;
    }
    if (sent === true) return "kafka";
    // A produce that is still running may yet land; writing the fallback too could count the view twice.
    if (sent === TIMED_OUT) return "timeout";
    try {
      const fallback = await fallbackInsert(fallbackVisitorLog(event));
      return fallback?.ok ? "supabase-fallback" : "failed";
    } catch {
      return "failed";
    }
  }

  return async function handle(req) {
    const method = String(req?.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return { status: 405, headers: { Allow: "GET, HEAD" }, body: "", via: "method_not_allowed" };
    }
    const userAgent = firstHeader(req?.headers?.["user-agent"]).slice(0, 255);
    const counts = method === "GET" && isGithubCamo(userAgent) && !isLocal(req);
    const [via] = await Promise.all([
      counts ? record(req, userAgent) : Promise.resolve("not_counted"),
      refreshBase(),
    ]);
    if (via === "kafka" || via === "supabase-fallback") state.pending += 1;
    const current = state.base === null ? null : state.base + state.pending;
    const count = current === null ? state.shown : Math.max(current, state.shown ?? 0);
    state.shown = count;
    return {
      status: 200,
      headers: BADGE_HEADERS,
      body: method === "HEAD" ? "" : renderViewBadge({ count }),
      via,
      count,
    };
  };
}
