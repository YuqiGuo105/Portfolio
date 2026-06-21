/**
 * Tiny localStorage wrapper for subscriber id + token.
 * Used by SubscribeDialog and NotificationBell.
 */

const KEY = "portfolioSubscriber:v1";

export function loadSubscriber() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.subscriberId || !parsed.subscriberToken) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

export function saveSubscriber(subscriberId, subscriberToken, extra = {}) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ subscriberId, subscriberToken, ...extra })
    );
  } catch (_) {
    /* quota or private mode — ignore */
  }
}

export function clearSubscriber() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch (_) {
    /* ignore */
  }
}
