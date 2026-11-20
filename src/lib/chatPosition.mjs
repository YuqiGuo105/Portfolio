const STORAGE_KEY = 'chatWidgetOffset';

export function normalizeChatOffset(value) {
  const coordinate = number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 100000 ? number : 0;
  return {
    x: coordinate(value?.x),
    y: coordinate(value?.y),
  };
}

export function clampChatOffset(requested, rect, current, viewport) {
  const next = normalizeChatOffset(requested);
  const previous = normalizeChatOffset(current);
  if (!rect || ![rect.left, rect.top, rect.width, rect.height, viewport?.width, viewport?.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return next;

  const axis = (value, base, size, start, extent) => {
    const gap = Math.min(8, Math.max(0, (extent - size) / 2));
    const min = start + gap - base;
    const max = start + extent - gap - base - size;
    // If the keyboard leaves less space than the panel, keep its header reachable.
    return Math.round(Math.max(min, Math.min(max, value)) * 100) / 100;
  };
  return {
    x: axis(next.x, rect.left - previous.x, rect.width, viewport.left || 0, viewport.width),
    y: axis(next.y, rect.top - previous.y, rect.height, viewport.top || 0, viewport.height),
  };
}

// Event-driven: no frame loop while idle, and position storage is not required.
export function createChatPosition(root, win) {
  let offset;
  try { offset = JSON.parse(win.localStorage.getItem(STORAGE_KEY)); } catch { /* Optional storage. */ }
  offset = normalizeChatOffset(offset);
  let frame = 0;
  let observed = null;
  let disposed = false;
  const viewport = () => ({
    left: win.visualViewport?.offsetLeft || 0,
    top: win.visualViewport?.offsetTop || 0,
    width: win.visualViewport?.width || win.innerWidth,
    height: win.visualViewport?.height || win.innerHeight,
  });
  const persist = () => {
    try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(offset)); } catch { /* Optional storage. */ }
  };
  const moveTo = (next) => {
    if (disposed) return;
    const bounds = viewport();
    root.style.setProperty('--cw-viewport-height', `${bounds.height}px`);
    const panel = root.querySelector('.bot-container, .launch-button');
    offset = clampChatOffset(next, panel?.getBoundingClientRect(), offset, bounds);
    root.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  };
  const refresh = () => {
    if (disposed) return;
    const panel = root.querySelector('.bot-container, .launch-button');
    if (panel !== observed) {
      observer?.disconnect();
      if (panel) observer?.observe(panel);
      observed = panel;
    }
    moveTo(offset);
    if (panel) persist();
  };
  const schedule = () => {
    if (disposed || frame) return;
    frame = win.requestAnimationFrame(() => { frame = 0; refresh(); });
  };
  const observer = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
  root.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  win.addEventListener('resize', schedule);
  win.visualViewport?.addEventListener('resize', schedule);
  win.visualViewport?.addEventListener('scroll', schedule);
  refresh();
  return {
    getOffset: () => ({ ...offset }),
    moveTo,
    refresh,
    persist,
    dispose() {
      disposed = true;
      if (frame) win.cancelAnimationFrame(frame);
      observer?.disconnect();
      win.removeEventListener('resize', schedule);
      win.visualViewport?.removeEventListener('resize', schedule);
      win.visualViewport?.removeEventListener('scroll', schedule);
    },
  };
}
