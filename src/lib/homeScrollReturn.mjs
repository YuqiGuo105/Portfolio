const STORAGE_KEY = 'yuqi.home-return.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function homeUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.origin !== new URL(base).origin) return null;
    return url.pathname === '/' || /^\/home\/[^/]+\/?$/.test(url.pathname) ? url : null;
  } catch { return null; }
}

// Home-only restoration leaves Next's scrolling and browser history on other pages alone.
export function startHomeScrollReturn(router, win = window) {
  const doc = win.document;
  let currentUrl = win.location.href;
  let checkpoint = null;
  let pending = null;
  let historyNavigation = false;
  let stopRestoring = () => {};

  function read() {
    try { checkpoint = JSON.parse(win.sessionStorage.getItem(STORAGE_KEY)) || checkpoint; }
    catch { /* Storage may be unavailable in private or embedded browsers. */ }
    if (!checkpoint || !Number.isFinite(checkpoint.y) || checkpoint.y < 0
      || !Number.isFinite(checkpoint.at) || Date.now() - checkpoint.at > MAX_AGE_MS
      || checkpoint.at > Date.now() || !homeUrl(checkpoint.url, currentUrl)) return null;
    return checkpoint;
  }

  function save() {
    if (!homeUrl(currentUrl, win.location.href)) return;
    const y = Math.max(0, win.scrollY);
    let anchor = null;
    let offset = 0;
    // A section-relative position survives changes in content height above it.
    for (const section of doc.querySelectorAll('.wrapper section[id]')) {
      const rect = section.getBoundingClientRect();
      if (rect.height > 0 && rect.top <= 1 && rect.bottom > 0) {
        anchor = section.id;
        offset = -rect.top;
      }
    }
    checkpoint = { url: currentUrl, y, anchor, offset, at: Date.now() };
    try { win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoint)); }
    catch { /* Keep the checkpoint in memory for client-side navigation. */ }
  }

  function restore(position) {
    stopRestoring();
    let frame = null;
    let stopped = false;
    const apply = () => {
      frame = null;
      if (stopped) return;
      const anchor = typeof position.anchor === 'string' ? doc.getElementById(position.anchor) : null;
      const top = anchor && Number.isFinite(position.offset)
        ? anchor.getBoundingClientRect().top + win.scrollY + position.offset : position.y;
      const max = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);
      const y = Math.max(0, Math.min(top, max));
      if (Math.abs(win.scrollY - y) > 1) {
        const previous = doc.documentElement.style.scrollBehavior;
        doc.documentElement.style.scrollBehavior = 'auto';
        win.scrollTo(0, y);
        doc.documentElement.style.scrollBehavior = previous;
      }
    };
    const schedule = () => {
      if (!stopped && frame === null) frame = win.requestAnimationFrame(apply);
    };
    const observer = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    const stop = () => {
      if (stopped) return;
      stopped = true;
      observer?.disconnect();
      if (frame !== null) win.cancelAnimationFrame(frame);
      win.clearTimeout(timeout);
      for (const event of events) win.removeEventListener(event, stop, true);
    };
    const timeout = win.setTimeout(stop, 4000);
    for (const event of events) win.addEventListener(event, stop, { capture: true, passive: true });
    observer?.observe(doc.body);
    for (const section of doc.querySelectorAll('.wrapper section[id]')) observer?.observe(section);
    stopRestoring = stop;
    // Next applies its own top/hash scroll at route completion; restore after that paint is queued.
    schedule();
  }

  // Next's popstate listener predates React effects. Use its hook so the flag is
  // set before routeChangeStart, even when returning to a URL with a hash.
  router.beforePopState(() => { historyNavigation = true; return true; });
  const onStart = url => {
    stopRestoring();
    const fromHome = homeUrl(currentUrl, win.location.href);
    const toHome = homeUrl(url, win.location.href);
    if (fromHome && !toHome) save();
    pending = !fromHome && toHome && (!toHome.hash || historyNavigation) ? read() : null;
    historyNavigation = false;
  };
  const onComplete = url => {
    currentUrl = new URL(url, win.location.href).href;
    if (pending) restore(pending);
    pending = null;
  };
  const onError = () => { pending = null; historyNavigation = false; stopRestoring(); };
  const onHashStart = () => { pending = null; historyNavigation = false; stopRestoring(); };
  const routes = { routeChangeStart: onStart, routeChangeComplete: onComplete,
    routeChangeError: onError, hashChangeStart: onHashStart, hashChangeComplete: onComplete };
  for (const [event, handler] of Object.entries(routes)) router.events.on(event, handler);
  win.addEventListener('pagehide', save);

  // Plain same-tab links can reload the document. Direct visits and explicit section links stay put.
  const initialHome = homeUrl(currentUrl, currentUrl);
  const navigation = win.performance?.getEntriesByType?.('navigation')?.[0];
  let internalReturn = false;
  try {
    const referrer = new URL(doc.referrer);
    internalReturn = referrer.origin === win.location.origin && !homeUrl(referrer.href, currentUrl);
  } catch { /* No referrer is normal for a direct visit. */ }
  if (initialHome && !initialHome.hash && navigation?.type === 'navigate' && internalReturn && read()) {
    restore(checkpoint);
  }

  return () => {
    stopRestoring();
    for (const [event, handler] of Object.entries(routes)) router.events.off(event, handler);
    router.beforePopState(() => true);
    win.removeEventListener('pagehide', save);
  };
}
