import { isBrowserAnalyticsDisabled } from "./analyticsHostFilter";
import { isPrivateAnalyticsPage, publicOutboundTarget } from "./analyticsPagePolicy.mjs";

const CONSENT_KEY = "yuqi_analytics_consent";
const ANON_COOKIE = "yuqi_analytics_id";
const SESSION_KEY = "yuqi_analytics_session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const PENDING_KEY = "yuqi_analytics_pending_v1";
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PENDING = 32;
const MAX_PENDING_BYTES = 32 * 1024;
const MAX_DELIVERIES = 3;
const deliveryQueues = new WeakMap();
const byteLength = value => new TextEncoder().encode(value).byteLength;

const ALLOWED_EVENTS = new Set([
  "page_view",
  "content_impression",
  "content_open",
  "read_progress",
  "engaged_time",
  "project_open",
  "outbound_link_clicked",
  "search_performed",
  "search_result_clicked",
  "subscribe_started",
  "subscribe_verified",
  "unsubscribe_completed",
  "recommendation_impression",
  "recommendation_click",
  "recommendation_dismiss",
  "chat_started",
  "chat_completed",
  "tool_used",
]);

function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function privacySignalDenied() {
  if (typeof navigator === "undefined") return false;
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
}

export function getAnalyticsConsent() {
  if (typeof window === "undefined") return "unknown";
  if (privacySignalDenied()) return "denied";
  let value;
  try { value = window.localStorage.getItem(CONSENT_KEY); } catch { return "denied"; }
  // First-party analytics is enabled by default for this owner-operated site;
  // explicit browser/user privacy signals always override that default.
  return value === "granted" || value === "denied" ? value : "granted";
}

export function setAnalyticsConsent(value) {
  if (typeof window === "undefined" || !["granted", "denied"].includes(value)) return;
  window.localStorage.setItem(CONSENT_KEY, value);
  if (value === "denied") {
    deliveryQueues.get(window)?.clear();
    window.sessionStorage.removeItem(PENDING_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
    document.cookie = `${ANON_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
  }
}

function readCookie(name) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || null;
}

function getAnonymousId() {
  let id = readCookie(ANON_COOKIE);
  if (!id) {
    id = uuid();
    document.cookie = `${ANON_COOKIE}=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
  }
  return id;
}

function getSessionId(now = Date.now()) {
  try {
    const current = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null");
    if (current?.id && now - Number(current.lastActivity) < SESSION_TIMEOUT_MS) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: current.id, lastActivity: now }));
      return current.id;
    }
  } catch (_) {
    // A malformed or blocked sessionStorage value simply starts a new session.
  }
  const id = uuid();
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, lastActivity: now }));
  return id;
}

function currentPath(value) {
  if (!value || typeof window === "undefined") return null;
  try {
    return new URL(value, window.location.origin).pathname;
  } catch (_) {
    return String(value).split(/[?#]/)[0].slice(0, 512);
  }
}

function recaptchaToken(action, timeoutMs = 2500) {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) return null;

  return new Promise((resolve) => {
    let settled = false;
    let poll = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (poll) window.clearInterval(poll);
      resolve(typeof value === "string" && value.length <= 8192 ? value : null);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);

    const executeWhenReady = () => {
      const enterprise = window.grecaptcha?.enterprise;
      if (!enterprise?.ready || !enterprise?.execute) return false;
      try {
        enterprise.ready(() => {
          if (settled) return;
          Promise.resolve(enterprise.execute(siteKey, { action }))
            .then(finish)
            .catch(() => finish(null));
        });
        return true;
      } catch {
        finish(null);
        return true;
      }
    };

    if (!executeWhenReady()) {
      poll = window.setInterval(() => {
        if (executeWhenReady() && poll) {
          window.clearInterval(poll);
          poll = null;
        }
      }, 50);
    }
  });
}

// A small per-tab outbox survives same-tab navigation/reload. No idle polling:
// only failed deliveries get a backoff timer; online/pageshow resume pending work.
function deliveryQueue() {
  const existing = deliveryQueues.get(window);
  if (existing) return existing;
  const owner = window;
  const pending = new Map();
  let timer = null;
  const active = () => typeof window !== "undefined" && window === owner;
  const permitted = () => active() && getAnalyticsConsent() === "granted";
  const publicPage = () => !isPrivateAnalyticsPage(owner.location.href);
  const visible = () => owner.document.visibilityState !== "hidden" && owner.navigator.onLine !== false;
  const inFlight = () => [...pending.values()].filter(e => e.sending || e.waiting).length;
  const prune = () => {
    for (const [id, entry] of pending) {
      if (Date.now() - Date.parse(entry.payload.localTime) > PENDING_TTL_MS) pending.delete(id);
    }
  };
  const save = () => {
    prune();
    try {
      if (!pending.size) owner.sessionStorage.removeItem(PENDING_KEY);
      else owner.sessionStorage.setItem(PENDING_KEY, JSON.stringify([...pending.values()]
        .map(({ payload, attempts, nextAt }) => ({ payload, attempts, nextAt }))));
    } catch { /* Memory delivery still works when browser storage is unavailable. */ }
  };
  const clear = () => {
    pending.clear();
    if (timer !== null) owner.clearTimeout(timer);
    timer = null;
    save();
  };
  const schedule = () => {
    if (timer !== null) owner.clearTimeout(timer);
    timer = null;
    if (!permitted()) { if (active()) clear(); return; }
    prune();
    if (!publicPage() || !visible() || inFlight() >= MAX_DELIVERIES) return;
    const ready = [...pending.values()].filter(e => !e.sending && !e.waiting);
    if (!ready.length) return;
    const next = Math.min(...ready.map(e => e.nextAt || 0));
    timer = owner.setTimeout(() => { timer = null; flush(); }, Math.max(1000, next - Date.now()));
  };
  const send = async (entry, token = null) => {
    if (!permitted() || pending.get(entry.payload.eventId) !== entry) return;
    entry.sending = true;
    entry.waiting = false;
    entry.attempts++;
    let delay = Math.min(60000, 1000 * 2 ** Math.min(entry.attempts, 6)) + Math.floor(Math.random() * 500);
    try {
      const response = await fetch("/api/track", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...entry.payload, ...(token ? { recaptchaToken: token } : {}) }),
        keepalive: true,
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
      });
      const ack = response?.ok && response.status !== 204 ? await response.json() : null;
      if ((response?.ok && ack?.ok === true && ack.eventId === entry.payload.eventId)
          || response?.status === 204
          || (response?.status >= 400 && response.status < 500 && ![408, 429].includes(response.status))) {
        pending.delete(entry.payload.eventId);
      } else if (response?.status === 429) {
        const retryAfter = response.headers?.get?.("Retry-After");
        const seconds = Number(retryAfter);
        const retryMs = retryAfter && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(retryMs) && retryMs > 0) delay = Math.max(delay, retryMs);
      }
    } catch { /* Keep the same event ID after network errors or lost acknowledgements. */ }
    finally {
      entry.sending = false;
      entry.nextAt = Date.now() + delay;
      save();
      schedule();
    }
  };
  const attempt = (entry, urgent = false) => {
    if (!permitted()) { if (active()) clear(); return; }
    if (entry.sending || (!urgent && entry.waiting) || pending.get(entry.payload.eventId) !== entry) return;
    if (owner.navigator.onLine === false || !publicPage()) return;
    if (!entry.waiting && inFlight() >= MAX_DELIVERIES) return;
    // Navigation must not wait for the optional risk SDK. It is not an ingest gate.
    const generation = (entry.generation || 0) + 1;
    entry.generation = generation;
    const token = urgent || entry.attempts ? null : recaptchaToken(entry.payload.event);
    if (!token) { void send(entry); return; }
    entry.waiting = true;
    void token.then(value => {
      if (entry.generation !== generation || pending.get(entry.payload.eventId) !== entry) return;
      void send(entry, value);
    });
  };
  const flush = (urgent = false) => {
    if (!permitted()) { if (active()) clear(); return; }
    prune();
    for (const entry of pending.values()) {
      if (urgent ? entry.waiting || !entry.attempts : visible() && entry.nextAt <= Date.now()) attempt(entry, urgent);
    }
    schedule();
  };
  try {
    const raw = owner.sessionStorage.getItem(PENDING_KEY);
    const saved = raw && byteLength(raw) <= MAX_PENDING_BYTES ? JSON.parse(raw) : [];
    for (const entry of (Array.isArray(saved) ? saved : []).slice(0, MAX_PENDING)) {
      const p = entry?.payload;
      if (!p || !ALLOWED_EVENTS.has(p.event) || typeof p.eventId !== "string"
          || !/^[a-zA-Z0-9-]{12,100}$/.test(p.eventId) || isPrivateAnalyticsPage(p.page)
          || p.consentState !== "granted" || !Number.isFinite(Date.parse(p.localTime))
          || Date.parse(p.localTime) > Date.now() || Date.now() - Date.parse(p.localTime) > PENDING_TTL_MS) continue;
      delete p.recaptchaToken;
      pending.set(p.eventId, { payload: p, attempts: Math.min(20, Math.max(0, Number(entry.attempts) || 0)),
        nextAt: Math.min(Date.now() + PENDING_TTL_MS, Math.max(0, Number(entry.nextAt) || 0)) });
    }
  } catch { /* A malformed local queue is discarded. */ }
  const queue = {
    clear, flush,
    enqueue(payload, urgent) {
      prune();
      const entry = { payload, attempts: 0, nextAt: 0 };
      if (byteLength(JSON.stringify(entry)) > 8000) return false;
      while (pending.size >= MAX_PENDING || (pending.size && byteLength(JSON.stringify([...pending.values()])) + byteLength(JSON.stringify(entry)) + 1024 > MAX_PENDING_BYTES)) {
        const oldest = [...pending.values()].find(item => !item.sending && !item.waiting);
        if (!oldest) return false;
        pending.delete(oldest.payload.eventId);
      }
      pending.set(payload.eventId, entry);
      save();
      attempt(entry, urgent);
      schedule();
      return true;
    },
  };
  deliveryQueues.set(owner, queue);
  owner.addEventListener("online", () => flush());
  owner.addEventListener("pageshow", () => flush());
  owner.addEventListener("pagehide", () => flush(true));
  owner.document.addEventListener("visibilitychange", () => flush(owner.document.visibilityState === "hidden"));
  flush();
  return queue;
}

export function trackBehavior(eventName, context = {}) {
  if (typeof window === "undefined" || !ALLOWED_EVENTS.has(eventName)) return false;
  if (isPrivateAnalyticsPage(context.page) || isPrivateAnalyticsPage(window.location.href)) return false;
  if (isBrowserAnalyticsDisabled(window.location.hostname)) return false;
  const target = eventName === 'outbound_link_clicked'
    ? publicOutboundTarget(context.target) : currentPath(context.target);
  if (eventName === 'outbound_link_clicked' && !target) return false;
  const consentState = getAnalyticsConsent();
  if (consentState === "denied") return false;

  const page = currentPath(context.page || window.location.href);
  const localTime = new Date().toISOString();
  // Queue public-page events immediately; a later admin login must not cancel them.
  // Analytics is anonymous and does not need the account's authentication token.
  try {
    const identified = getAnalyticsConsent() === "granted";
    const payload = {
      eventId: uuid(),
      schemaVersion: 2,
      event: eventName,
      localTime,
      consentState: getAnalyticsConsent(),
      page,
      target,
      referrer: publicOutboundTarget(context.referrer ?? document.referrer) || null,
      sessionId: identified ? getSessionId() : null,
      anonymousId: identified ? getAnonymousId() : null,
      properties: context.properties || {},
    };

    return deliveryQueue().enqueue(payload, context.leaving === true);
  } catch { return false; }
}

export async function trackClick(clickEvent, targetUrl) {
  if (typeof window === 'undefined' || isBrowserAnalyticsDisabled(window.location.hostname)
      || isPrivateAnalyticsPage(window.location.href) || isPrivateAnalyticsPage(targetUrl)
      || getAnalyticsConsent() === 'denied') return false;
  const page = currentPath(window.location.href);
  const localTime = new Date().toISOString();
  try {
    await fetch('/api/click', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clickEvent, targetUrl, localTime, page }),
    });
    return true;
  } catch { return false; }
}

export function startPageBehaviorTracking(page, { recordPageView = true, routeTransition = false } = {}) {
  if (typeof window === "undefined" || isBrowserAnalyticsDisabled(window.location.hostname)
      || isPrivateAnalyticsPage(page) || isPrivateAnalyticsPage(window.location.href)) {
    return () => {};
  }
  if (getAnalyticsConsent() !== "granted") return () => {};
  deliveryQueue().flush();
  let timer = null;
  let peakScrollY = 0;
  let reported = 0;
  let stopped = false;
  let previousScrollY = window.scrollY;
  let awaitingRouteScroll = routeTransition && previousScrollY > 0;
  if (recordPageView) trackBehavior("page_view", { page });

  const sample = (leaving = false) => {
    timer = null;
    if (stopped || getAnalyticsConsent() !== "granted"
        || (!leaving && document.visibilityState === "hidden")
        || currentPath(window.location.href) !== currentPath(page)) return;
    const scrollable = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) - window.innerHeight;
    if (scrollable <= 0) return;
    // Scroll offsets can be fractional while scrollHeight is rounded to pixels.
    const percentage = peakScrollY >= scrollable - 1 ? 100
      : Math.min(100, Math.max(0, peakScrollY / scrollable * 100));
    const checkpoint = Math.floor(percentage / 25) * 25;
    peakScrollY = window.scrollY;
    if (checkpoint > reported) {
      // Skip intermediate checkpoints after a fast scroll: at most four events per page.
      if (trackBehavior("read_progress", { page, leaving, properties: { progressPercent: checkpoint } })) reported = checkpoint;
      if (reported === 100) window.removeEventListener("scroll", onScroll);
    }
  };

  const onScroll = () => {
    if (stopped || reported === 100) return;
    const y = window.scrollY;
    // Next can finish routing before its smooth scroll-to-top finishes. Those
    // decreasing offsets belong to the transition, not reading the new page.
    if (awaitingRouteScroll && y <= previousScrollY) { previousScrollY = y; return; }
    awaitingRouteScroll = false;
    previousScrollY = y;
    peakScrollY = Math.max(peakScrollY, y);
    // Only read document geometry once per second, never in the scroll handler.
    if (timer === null) timer = window.setTimeout(sample, 1000);
  };
  const flushProgress = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      sample(true);
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flushProgress();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", flushProgress);
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (!routeTransition && window.scrollY > 0) onScroll();
  return ({ discard = false } = {}) => {
    if (stopped) return;
    if (!discard) flushProgress();
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pagehide", flushProgress);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
