export const SUBSCRIPTION_PROMPT_KEY = "portfolioSubscriptionPrompt:v1";
export const SUBSCRIPTION_PROMPT_DELAY_MS = 15_000;
export const SUBSCRIPTION_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SCROLL_REST_MS = 1500;
const shownInWindow = new WeakMap();

export function isSubscriptionPromptPage(page) {
  const path = String(page || "").split(/[?#]/)[0];
  return /^\/(?:$|blogs?\/?$|works(?:-list)?\/?$|(?:blog-single|work-single)(?:\/[^/]+)?\/?$)/.test(path);
}

export function recordSubscriptionPrompt(win, now = Date.now()) {
  shownInWindow.set(win, now);
  try { win.localStorage.setItem(SUBSCRIPTION_PROMPT_KEY, String(now)); } catch { /* Storage is optional. */ }
}

export function subscriptionPromptOnCooldown(win, now = Date.now()) {
  let shownAt = shownInWindow.get(win) || 0;
  try {
    const saved = Number(win.localStorage.getItem(SUBSCRIPTION_PROMPT_KEY));
    if (Number.isFinite(saved) && saved > 0) shownAt = Math.max(shownAt, saved);
  } catch { /* Keep the in-memory cooldown when storage is unavailable. */ }
  return shownAt > 0 && now - shownAt < SUBSCRIPTION_PROMPT_COOLDOWN_MS;
}

export function subscriptionPromptBlocked(doc) {
  const active = doc.activeElement;
  if (active?.matches('input, textarea, select') || active?.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  if (doc.body.classList.contains("no-scroll") || doc.body.style.overflow === "hidden") return true;
  return Boolean(doc.querySelector(
    '[aria-modal="true"], [role="dialog"], .menu-full-overlay.is-open, #__chat_widget_root .bot-container, .st-roaming-pet'
  ));
}

// Reading signals stay in the browser; no visitor records or new requests are needed.
export function startSubscriptionPrompt({ win, doc, page, hasSubscriber, onPrompt, ignoreCooldown = false, now = () => Date.now() }) {
  if (!isSubscriptionPromptPage(page) || hasSubscriber() || (!ignoreCooldown && subscriptionPromptOnCooldown(win, now()))) return () => {};
  let stopped = false;
  let elapsed = 0;
  let lastTick = now();
  let lastScroll = now();
  let reachedReadingPoint = false;
  const isHomepage = String(page).split(/[?#]/)[0] === "/";
  let available = !doc.hidden && !subscriptionPromptBlocked(doc);

  const onScroll = () => {
    if (doc.hidden || subscriptionPromptBlocked(doc)) return;
    lastScroll = now();
    if (isHomepage) {
      // Use the actual heading: page length changes with images and mobile layout.
      const heading = doc.getElementById("tour-background")?.getBoundingClientRect();
      reachedReadingPoint ||= win.scrollY > 0 && heading?.height > 0 && heading.top <= win.innerHeight * 0.75;
    } else {
      const scrollable = doc.documentElement.scrollHeight - win.innerHeight;
      reachedReadingPoint ||= scrollable > 0 && win.scrollY / scrollable >= 0.25;
    }
  };
  const stop = () => {
    stopped = true;
    win.clearInterval(timer);
    win.removeEventListener("scroll", onScroll);
    win.removeEventListener("resize", onScroll);
    doc.removeEventListener("visibilitychange", tick);
  };
  const tick = () => {
    if (stopped) return;
    const time = now();
    const canRead = !doc.hidden && !subscriptionPromptBlocked(doc);
    // Clamp suspended timers so returning to a sleeping tab cannot skip the delay.
    if (available && canRead) elapsed += Math.max(0, Math.min(1000, time - lastTick));
    lastTick = time;
    available = canRead;
    if (hasSubscriber() || (!ignoreCooldown && subscriptionPromptOnCooldown(win, time))) { stop(); return; }
    if (!canRead || (elapsed < SUBSCRIPTION_PROMPT_DELAY_MS && !reachedReadingPoint) || time - lastScroll < SCROLL_REST_MS) return;
    if (!ignoreCooldown) recordSubscriptionPrompt(win, time);
    stop();
    onPrompt();
  };
  const timer = win.setInterval(tick, 1000);
  win.addEventListener("scroll", onScroll, { passive: true });
  win.addEventListener("resize", onScroll);
  doc.addEventListener("visibilitychange", tick);
  // Hydration and back navigation can begin beyond the threshold without a new scroll.
  onScroll();
  return stop;
}
