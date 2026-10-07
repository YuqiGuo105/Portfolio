/**
 * Tiny localStorage wrapper for subscriber id + token.
 * Used by SubscribeDialog and NotificationBell.
 */

const KEY = "portfolioSubscriber:v1";
const CHANGED = "portfolio:subscriber-changed";

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
    window.dispatchEvent(new window.Event(CHANGED));
  } catch (_) {
    /* quota or private mode — ignore */
  }
}

export function clearSubscriber() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new window.Event(CHANGED));
  } catch (_) {
    /* ignore */
  }
}

export function watchSubscriber(listener) {
  const update = () => listener(loadSubscriber());
  const onStorage = event => { if (event.key === KEY || event.key === null) update(); };
  window.addEventListener(CHANGED, update);
  window.addEventListener("storage", onStorage);
  update();
  return () => {
    window.removeEventListener(CHANGED, update);
    window.removeEventListener("storage", onStorage);
  };
}
