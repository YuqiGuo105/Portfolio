export const BROWSER_ACTION_EVENT = "mr-pot:browser-action";
export const FLOWS = ["ask-agent", "publish-content", "send-notification", "track-visitor", "execute-mcp"];
export const TERMINAL_COMMANDS = ["help", "pwd", "ls projects", "ls articles", "cat resume.txt", "git log", "kubectl get pods"];

// No selectors, executable code, external URLs, writes or arbitrary shell input.
export function normalizeBrowserAction(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  switch (raw.type) {
    case "open_project":
      return typeof raw.projectId === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(raw.projectId)
        ? { type: raw.type, projectId: raw.projectId.toLowerCase() } : null;
    case "diagram_step":
      return FLOWS.includes(raw.flow) && Number.isInteger(raw.step) && raw.step >= 1 && raw.step <= 60
        ? { type: raw.type, flow: raw.flow, step: raw.step } : null;
    case "globe_city":
      return typeof raw.city === "string" && raw.city.trim().length > 0 && raw.city.length <= 80
        && typeof raw.lat === "number" && Number.isFinite(raw.lat) && Math.abs(raw.lat) <= 90
        && typeof raw.lng === "number" && Number.isFinite(raw.lng) && Math.abs(raw.lng) <= 180
        ? { type: raw.type, city: raw.city.trim(), lat: raw.lat, lng: raw.lng } : null;
    case "terminal_command":
      return TERMINAL_COMMANDS.includes(raw.command) ? { type: raw.type, command: raw.command } : null;
    default: return null;
  }
}

export function normalizeBrowserPlan(raw) {
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.actions) || !raw.actions.length || raw.actions.length > 4) return null;
  const actions = raw.actions.map(normalizeBrowserAction);
  if (actions.some(action => !action)) return null;
  return { schemaVersion: 1, autoStart: raw.autoStart === true, actions };
}

const targets = new Map();
const waiters = new Map();
export function registerBrowserTarget(name, handler) {
  targets.set(name, handler);
  waiters.get(name)?.forEach(resolve => resolve(handler));
  waiters.delete(name);
  return () => { if (targets.get(name) === handler) targets.delete(name); };
}

async function target(name, action, isActive) {
  let handler = targets.get(name);
  if (!handler) handler = await new Promise((resolve, reject) => {
    const ready = value => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => {
      waiters.get(name)?.delete(ready);
      reject(new Error("The destination is not ready. Please try again."));
    }, 8000);
    if (!waiters.has(name)) waiters.set(name, new Set());
    waiters.get(name).add(ready);
  });
  if (!isActive()) throw new Error("Page action expired.");
  return handler(action, isActive);
}

export async function executeBrowserAction(raw, router, isActive = () => true) {
  const action = normalizeBrowserAction(raw);
  if (!action || !isActive()) throw new Error("This page action is not allowed.");
  if (action.type === "open_project") {
    if (await router.push(`/work-single/${action.projectId}`) === false) throw new Error("Navigation cancelled.");
    return "Project page requested";
  }
  if (action.type === "diagram_step") {
    if (router.pathname !== "/architecture" && await router.push("/architecture") === false) throw new Error("Navigation cancelled.");
    return target("diagram", action, isActive);
  }
  if (action.type === "globe_city") {
    if (!targets.has("globe") && await router.push("/analytics") === false) throw new Error("Navigation cancelled.");
    return target("globe", action, isActive);
  }
  window.dispatchEvent(new CustomEvent("yuqi:open-terminal"));
  return target("terminal", action, isActive);
}

export function requestBrowserAction(action) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { done = true; reject(new Error("Page action timed out.")); }, 15000);
    window.dispatchEvent(new CustomEvent(BROWSER_ACTION_EVENT, { detail: {
      action,
      isActive: () => !done,
      complete: (error, result) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      },
    } }));
  });
}
