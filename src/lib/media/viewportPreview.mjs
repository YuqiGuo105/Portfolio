const PREVIEW_STARTED = 'yuqi:media-preview-start';
let sharedController;

// One observer and dwell timer serve every cover; scrolling never starts a download.
export function createViewportPreviewController({ window: win, document: doc, navigator: nav, IntersectionObserver: Observer }, dwellMs = 1000) {
  const entries = new Map();
  const touch = win.matchMedia('(hover: none), (pointer: coarse)');
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = null;
  let active = null;
  let automatic = false;
  let touching = false;
  const cancel = () => { win.clearTimeout(timer); timer = null; };
  const allowed = () => touch.matches && !reduced.matches && !nav.connection?.saveData && !doc.hidden;
  const stopActive = () => { const previous = active; active = null; automatic = false; previous?.stop(); };
  const schedule = () => {
    cancel();
    if (!allowed()) { if (automatic || doc.hidden) stopActive(); return; }
    if (touching) return;
    timer = win.setTimeout(() => {
      timer = null;
      if (!allowed() || touching) return;
      let candidate = null;
      let distance = Infinity;
      for (const entry of entries.values()) {
        if (entry.ratio < 0.65 || entry.blocked || !entry.element.isConnected) continue;
        const rect = entry.element.getBoundingClientRect();
        const offset = Math.abs(rect.top + rect.height / 2 - win.innerHeight / 2);
        if (offset < distance) { candidate = entry; distance = offset; }
      }
      if (candidate === active) return;
      stopActive();
      if (candidate) { active = candidate; candidate.start(); automatic = true; }
    }, dwellMs);
  };
  const observer = new Observer(changes => {
    for (const change of changes) {
      const entry = entries.get(change.target);
      if (!entry) continue;
      entry.ratio = change.isIntersecting ? change.intersectionRatio : 0;
      entry.visibility?.(change.isIntersecting);
      if (!change.isIntersecting) entry.blocked = false;
      if (entry === active && (!change.isIntersecting || (touch.matches && entry.ratio < 0.65))) stopActive();
    }
    schedule();
  }, { threshold: [0, 0.65, 1] });
  const pointerDown = event => {
    if (event.pointerType !== 'touch') return;
    touching = true;
    cancel();
  };
  const pointerUp = event => {
    if (event.pointerType !== 'touch') return;
    touching = false;
    schedule();
  };
  const visibility = () => {
    touching = false;
    if (doc.hidden) for (const entry of entries.values()) if (entry !== active) entry.stop();
    schedule();
  };
  const previewStarted = event => {
    cancel();
    const next = entries.get(event.detail) || null;
    for (const entry of entries.values()) if (entry !== next) entry.stop();
    active = next;
    automatic = false;
  };
  const scrollOptions = { passive: true, capture: true };
  doc.addEventListener('scroll', schedule, scrollOptions);
  doc.addEventListener('pointerdown', pointerDown, scrollOptions);
  doc.addEventListener('pointerup', pointerUp, scrollOptions);
  doc.addEventListener('pointercancel', pointerUp, scrollOptions);
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('resize', schedule, { passive: true });
  win.addEventListener(PREVIEW_STARTED, previewStarted);
  touch.addEventListener?.('change', schedule);
  reduced.addEventListener?.('change', schedule);
  nav.connection?.addEventListener?.('change', schedule);
  return {
    register(element, handlers) {
      const entry = { ...handlers, element, ratio: 0, blocked: false };
      entries.set(element, entry);
      observer.observe(element);
      return {
        suppress() {
          entry.blocked = true;
          if (active === entry) active = null;
          cancel();
        },
        unregister() {
          if (active === entry) active = null;
          observer.unobserve(element);
          entries.delete(element);
          schedule();
        },
      };
    },
    get size() { return entries.size; },
    dispose() {
      cancel();
      observer.disconnect();
      entries.clear();
      active = null;
      doc.removeEventListener('scroll', schedule, scrollOptions);
      doc.removeEventListener('pointerdown', pointerDown, scrollOptions);
      doc.removeEventListener('pointerup', pointerUp, scrollOptions);
      doc.removeEventListener('pointercancel', pointerUp, scrollOptions);
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('resize', schedule);
      win.removeEventListener(PREVIEW_STARTED, previewStarted);
      touch.removeEventListener?.('change', schedule);
      reduced.removeEventListener?.('change', schedule);
      nav.connection?.removeEventListener?.('change', schedule);
    },
  };
}

export function registerViewportPreview(element, handlers) {
  if (!sharedController) sharedController = createViewportPreviewController({ window, document, navigator, IntersectionObserver });
  const controller = sharedController;
  const subscription = controller.register(element, handlers);
  return {
    suppress: subscription.suppress,
    unregister() {
      subscription.unregister();
      if (!controller.size) { controller.dispose(); sharedController = null; }
    },
  };
}
