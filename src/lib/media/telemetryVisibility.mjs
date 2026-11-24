// One observer and two lifecycle listeners for all players, idle when unmounted.
export function createTelemetryVisibility(win) {
  const entries = new Map();
  const exposures = new Map();
  let observer;
  function cancel(entry) { win.clearTimeout(entry.timer); entry.timer = null; }
  function schedule(entry) {
    cancel(entry);
    if (!entry.visible || win.document.hidden) return;
    entry.timer = win.setTimeout(() => {
      entry.timer = null;
      if (!entry.visible || win.document.hidden) return;
      const now = Date.now();
      if ((exposures.get(entry.key) || 0) > now - 300000) return;
      if (entry.impression()) {
        exposures.delete(entry.key);
        exposures.set(entry.key, now);
        while (exposures.size > 200) exposures.delete(exposures.keys().next().value);
      }
    }, 1000);
  }
  function flush() { for (const entry of entries.values()) { cancel(entry); entry.boundary(); } }
  function visibility() {
    if (win.document.hidden) flush();
    else for (const entry of entries.values()) schedule(entry);
  }
  function attach() {
    if (typeof win.IntersectionObserver === 'function') observer = new win.IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = entries.get(change.target);
        if (!entry) continue;
        const visible = change.isIntersecting !== false && change.intersectionRatio >= 0.5;
        if (entry.visible && !visible) entry.boundary();
        entry.visible = visible;
        schedule(entry);
      }
    }, { threshold: [0, 0.5] });
    win.document.addEventListener('visibilitychange', visibility);
    win.addEventListener('pagehide', flush);
  }
  return {
    observe(element, callbacks) {
      if (!element) return { visible: () => false, unregister() {} };
      if (!entries.size) attach();
      const entry = { ...callbacks, visible: false, timer: null };
      entries.set(element, entry);
      observer?.observe(element);
      return { visible: () => entry.visible && !win.document.hidden, unregister() {
        cancel(entry); observer?.unobserve(element); entries.delete(element);
        if (!entries.size) {
          observer?.disconnect(); observer = null;
          win.document.removeEventListener('visibilitychange', visibility);
          win.removeEventListener('pagehide', flush);
        }
      } };
    },
  };
}

let shared;
export function observeTelemetryVisibility(element, callbacks) {
  shared ||= createTelemetryVisibility(window);
  return shared.observe(element, callbacks);
}
