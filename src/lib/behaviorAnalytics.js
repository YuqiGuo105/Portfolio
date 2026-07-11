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

export function trackBehavior(eventName, context = {}) {
  if (typeof window === "undefined" || !ALLOWED_EVENTS.has(eventName)) return false;
  const consentState = getAnalyticsConsent();
  if (consentState === "denied") return false;

  const identified = consentState === "granted";
  const payload = {
    schemaVersion: 2,
    event: eventName,
    localTime: new Date().toISOString(),
    consentState,
    page: currentPath(context.page || window.location.href),
    target: currentPath(context.target),
    referrer: context.referrer ?? document.referrer ?? null,
    sessionId: identified ? getSessionId() : null,
    anonymousId: identified ? getAnonymousId() : null,
    properties: context.properties || {},
  };

  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
  return true;
}

export function startPageBehaviorTracking(page) {
  const startedAt = Date.now();
  const milestones = new Set();
  trackBehavior("page_view", { page });

  const onScroll = () => {
    if (getAnalyticsConsent() !== "granted") return;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return;
    const percentage = Math.min(100, Math.round((window.scrollY / scrollable) * 100));
    for (const milestone of [25, 50, 75, 100]) {
      if (percentage >= milestone && !milestones.has(milestone)) {
        milestones.add(milestone);
        trackBehavior("read_progress", { page, properties: { progressPercent: milestone } });
      }
    }
  };

  const flushEngagement = () => {
    const seconds = Math.min(3600, Math.round((Date.now() - startedAt) / 1000));
    if (seconds >= 5) {
      trackBehavior("engaged_time", { page, properties: { engagedSeconds: seconds } });
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", flushEngagement, { once: true });
  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pagehide", flushEngagement);
    flushEngagement();
  };
}
