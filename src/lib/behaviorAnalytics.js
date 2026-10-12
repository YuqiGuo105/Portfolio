import { isBrowserAnalyticsDisabled } from "./analyticsHostFilter";
import { isPrivateAnalyticsPage } from "./analyticsPagePolicy.mjs";

const CONSENT_KEY = "yuqi_analytics_consent";
const ANON_COOKIE = "yuqi_analytics_id";
const SESSION_KEY = "yuqi_analytics_session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

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
  const value = window.localStorage.getItem(CONSENT_KEY);
  // First-party analytics is enabled by default for this owner-operated site;
  // explicit browser/user privacy signals always override that default.
  return value === "granted" || value === "denied" ? value : "granted";
}

export function setAnalyticsConsent(value) {
  if (typeof window === "undefined" || !["granted", "denied"].includes(value)) return;
  window.localStorage.setItem(CONSENT_KEY, value);
  if (value === "denied") {
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

function deliverBehavior(payload, token) {
  if (token) payload.recaptchaToken = token;
  return fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

export function trackBehavior(eventName, context = {}) {
  if (typeof window === "undefined" || !ALLOWED_EVENTS.has(eventName)) return false;
  if (isPrivateAnalyticsPage(context.page) || isPrivateAnalyticsPage(window.location.href)) return false;
  if (isBrowserAnalyticsDisabled(window.location.hostname)) return false;
  const consentState = getAnalyticsConsent();
  if (consentState === "denied") return false;

  const page = currentPath(context.page || window.location.href);
  const localTime = new Date().toISOString();
  // Queue public-page events immediately; a later admin login must not cancel them.
  // Analytics is anonymous and does not need the account's authentication token.
  try {
    const identified = getAnalyticsConsent() === "granted";
    const payload = {
      schemaVersion: 2,
      event: eventName,
      localTime,
      consentState: getAnalyticsConsent(),
      page,
      target: currentPath(context.target),
      referrer: context.referrer ?? document.referrer ?? null,
      sessionId: identified ? getSessionId() : null,
      anonymousId: identified ? getAnonymousId() : null,
      properties: context.properties || {},
    };

    const token = recaptchaToken(eventName);
    if (token) {
      void token.then((value) => deliverBehavior(payload, value));
    } else {
      void deliverBehavior(payload, null);
    }
  } catch { return false; }
  return true;
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

export function startPageBehaviorTracking(page, { recordPageView = true } = {}) {
  if (typeof window === "undefined" || isBrowserAnalyticsDisabled(window.location.hostname)
      || isPrivateAnalyticsPage(page) || isPrivateAnalyticsPage(window.location.href)) {
    return () => {};
  }
  if (getAnalyticsConsent() !== "granted") return () => {};
  let timer = null;
  let peakScrollY = 0;
  let reported = 0;
  let stopped = false;
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
      reported = checkpoint;
      // Skip intermediate checkpoints after a fast scroll: at most four events per page.
      trackBehavior("read_progress", { page, properties: { progressPercent: checkpoint } });
      if (reported === 100) window.removeEventListener("scroll", onScroll);
    }
  };

  const onScroll = () => {
    if (stopped || reported === 100) return;
    peakScrollY = Math.max(peakScrollY, window.scrollY);
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
