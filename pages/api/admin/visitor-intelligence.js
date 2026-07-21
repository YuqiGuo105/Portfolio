import { requireAdminUser } from "../../../src/lib/agentServiceProxy";
import { supabaseServer } from "../../../src/supabase/supabaseServer";

const PROD_DEFAULT = "https://portfolio-analytics-aggregator-702193211434.us-central1.run.app";
const SAMPLE_SIZE = 100;
const ALLOWED_QUERY = new Set([
  "from", "to", "hours", "q", "event", "path", "country", "city",
  "device", "browser", "referrer", "sessionId", "includeAdmin",
]);
const CONTENT_ROUTES = [
  { prefix: "/work-single/", table: "Projects", type: "project" },
  { prefix: "/blog-single/", table: "Blogs", type: "tech blog" },
  { prefix: "/life-blog/", table: "life_blogs", type: "life blog" },
];
const FUNNEL_STEPS = [
  { key: "home", label: "Homepage", description: "Loaded the main portfolio page" },
  { key: "project", label: "Project interest", description: "Opened or landed on a project page" },
  { key: "resume", label: "Resume intent", description: "Viewed resume / CV content" },
  { key: "contact", label: "Contact or subscribe", description: "Reached contact or subscription flow" },
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const auth = await requireAdminUser(req, res);
  if (!auth) return;

  const token = process.env.ANALYTICS_SERVICE_TOKEN || process.env.NOTIFICATION_SERVICE_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: "config_missing",
      message: "ANALYTICS_SERVICE_TOKEN is not configured.",
    });
  }

  const params = new URLSearchParams({ page: "0", size: String(SAMPLE_SIZE) });
  for (const [key, value] of Object.entries(req.query)) {
    if (!ALLOWED_QUERY.has(key) || value == null) continue;
    params.set(key, String(Array.isArray(value) ? value[0] : value));
  }

  const base = (process.env.ANALYTICS_API_URL || PROD_DEFAULT).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(`${base}/api/admin/visitors?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "X-Internal-Token": token,
      },
      signal: controller.signal,
    });
    const body = await upstream.text();
    res.setHeader("Cache-Control", "private, no-store");
    if (!upstream.ok) {
      res.status(upstream.status);
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
      return res.send(body);
    }

    const payload = JSON.parse(body);
    const items = Array.isArray(payload.items) ? payload.items : [];
    const contentByPath = await loadContentReferences(items);
    return res.status(200).json(buildIntelligence(payload, contentByPath));
  } catch (error) {
    return res.status(502).json({
      error: "analytics_unreachable",
      message: error.name === "AbortError" ? "Visitor intelligence query timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildIntelligence(payload, contentByPath) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    from: payload.from,
    to: payload.to,
    sampledEvents: items.length,
    totalEvents: payload.page?.totalElements || payload.summary?.totalEvents || items.length,
    uniqueVisitors: payload.summary?.uniqueVisitors || countUnique(items, visitorKey),
    funnel: buildFunnel(items),
    attribution: buildAttribution(items),
    topContent: buildTopContent(items, contentByPath),
    cohort: buildCohort(items),
  };
}

function buildFunnel(items) {
  const stepVisitors = new Map(FUNNEL_STEPS.map((step) => [step.key, new Set()]));
  for (const item of items) {
    const key = visitorKey(item);
    if (!key) continue;
    for (const step of matchedFunnelSteps(item)) {
      stepVisitors.get(step)?.add(key);
    }
  }
  const first = Math.max(1, stepVisitors.get("home")?.size || countUnique(items, visitorKey));
  let previous = first;
  return FUNNEL_STEPS.map((step) => {
    const visitors = stepVisitors.get(step.key)?.size || 0;
    const fromStartRate = visitors / first;
    const fromPreviousRate = visitors / Math.max(1, previous);
    previous = visitors || previous;
    return {
      ...step,
      visitors,
      fromStartRate,
      fromPreviousRate,
    };
  });
}

function matchedFunnelSteps(item) {
  const event = String(item.eventName || "").toLowerCase();
  const page = normalizePath(item.pageUrl);
  const target = normalizePath(item.targetUrl);
  const steps = new Set();
  if (event === "page_view" && page === "/") steps.add("home");
  if (event === "project_open" || routeFor(page)?.type === "project" || routeFor(target)?.type === "project") {
    steps.add("project");
  }
  if (page === "/cv" || page === "/resume" || target === "/cv" || target === "/resume") steps.add("resume");
  if (page === "/contact" || target === "/contact" || event.includes("subscribe")) steps.add("contact");
  return steps;
}

function buildAttribution(items) {
  const groups = new Map();
  for (const item of items) {
    const source = sourceFor(item.referrer);
    const current = groups.get(source.key) || {
      source: source.label,
      sourceType: source.type,
      visitors: new Set(),
      events: 0,
      projectOpens: 0,
      resumeViews: 0,
      contactActions: 0,
      engagedSeconds: 0,
    };
    current.events += 1;
    current.visitors.add(visitorKey(item));
    if (matchedFunnelSteps(item).has("project")) current.projectOpens += 1;
    if (matchedFunnelSteps(item).has("resume")) current.resumeViews += 1;
    if (matchedFunnelSteps(item).has("contact")) current.contactActions += 1;
    current.engagedSeconds += engagedSeconds(item);
    groups.set(source.key, current);
  }
  return [...groups.values()]
    .map((group) => ({
      source: group.source,
      sourceType: group.sourceType,
      visitors: group.visitors.size,
      events: group.events,
      projectOpens: group.projectOpens,
      resumeViews: group.resumeViews,
      contactActions: group.contactActions,
      engagedSeconds: group.engagedSeconds,
      qualityScore: group.projectOpens * 3 + group.resumeViews * 4 + group.contactActions * 6 + Math.min(10, Math.round(group.engagedSeconds / 30)),
    }))
    .sort((a, b) => b.qualityScore - a.qualityScore || b.events - a.events)
    .slice(0, 6);
}

function buildTopContent(items, contentByPath) {
  const groups = new Map();
  for (const item of items) {
    const paths = [normalizePath(item.targetUrl), normalizePath(item.pageUrl)].filter(Boolean);
    const path = paths.find((candidate) => routeFor(candidate));
    if (!path) continue;
    const route = routeFor(path);
    const key = `${route.type}:${path}`;
    const current = groups.get(key) || {
      path,
      type: route.type,
      title: contentByPath.get(path)?.title || path,
      coverUrl: contentByPath.get(path)?.coverUrl || null,
      events: 0,
      opens: 0,
      visitors: new Set(),
      engagedSeconds: 0,
    };
    current.events += 1;
    current.visitors.add(visitorKey(item));
    if (String(item.eventName || "").toLowerCase().includes("open")) current.opens += 1;
    current.engagedSeconds += engagedSeconds(item);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((item) => ({
      path: item.path,
      type: item.type,
      title: item.title,
      coverUrl: item.coverUrl,
      events: item.events,
      opens: item.opens,
      visitors: item.visitors.size,
      engagedSeconds: item.engagedSeconds,
      score: item.opens * 4 + item.visitors * 2 + Math.min(10, Math.round(item.engagedSeconds / 30)),
    }))
    .sort((a, b) => b.score - a.score || b.events - a.events)
    .slice(0, 5);
}

function buildCohort(items) {
  const groups = new Map();
  for (const item of items) {
    const key = visitorKey(item);
    if (!key) continue;
    const time = Date.parse(item.eventTime);
    const current = groups.get(key) || {
      events: 0,
      first: Number.isFinite(time) ? time : null,
      last: Number.isFinite(time) ? time : null,
      days: new Set(),
      steps: new Set(),
    };
    current.events += 1;
    if (Number.isFinite(time)) {
      current.first = current.first == null ? time : Math.min(current.first, time);
      current.last = current.last == null ? time : Math.max(current.last, time);
      current.days.add(new Date(time).toISOString().slice(0, 10));
    }
    for (const step of matchedFunnelSteps(item)) current.steps.add(step);
    groups.set(key, current);
  }
  const visitors = [...groups.values()];
  const returning = visitors.filter((visitor) => visitor.days.size > 1 || (visitor.last - visitor.first) >= 30 * 60 * 1000).length;
  const multiStep = visitors.filter((visitor) => visitor.steps.size >= 2).length;
  const totalEvents = visitors.reduce((sum, visitor) => sum + visitor.events, 0);
  return {
    visitors: visitors.length,
    returningVisitors: returning,
    multiStepVisitors: multiStep,
    averageEventsPerVisitor: visitors.length ? totalEvents / visitors.length : 0,
    returningRate: visitors.length ? returning / visitors.length : 0,
    multiStepRate: visitors.length ? multiStep / visitors.length : 0,
  };
}

async function loadContentReferences(items) {
  const requested = new Map();
  for (const item of items) {
    collectRoute(requested, item.pageUrl);
    collectRoute(requested, item.targetUrl);
  }
  const groups = new Map();
  for (const route of requested.values()) {
    const current = groups.get(route.table) || { route, ids: [] };
    current.ids.push(route.id);
    groups.set(route.table, current);
  }
  const settled = await Promise.allSettled(
    [...groups.values()].map(async ({ route, ids }) => {
      const { data, error } = await supabaseServer
        .from(route.table)
        .select("id,title,image_url")
        .in("id", [...new Set(ids)]);
      if (error) throw error;
      return (data || []).map((row) => ({ route, row }));
    }),
  );
  const contentByPath = new Map();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const { route, row } of result.value) {
      const path = `${route.prefix}${encodeURIComponent(row.id)}`;
      contentByPath.set(path, {
        title: row.title || "Untitled content",
        coverUrl: row.image_url || null,
      });
    }
  }
  return contentByPath;
}

function collectRoute(requested, value) {
  const path = normalizePath(value);
  if (!path || requested.has(path)) return;
  const route = routeFor(path);
  if (!route) return;
  const encodedId = path.slice(route.prefix.length).split("/")[0];
  if (!encodedId) return;
  try {
    requested.set(path, { ...route, id: decodeURIComponent(encodedId) });
  } catch {
    // Keep the raw path visible, but skip metadata lookup for malformed ids.
  }
}

function routeFor(path) {
  return CONTENT_ROUTES.find((candidate) => path?.startsWith(candidate.prefix));
}

function sourceFor(referrer) {
  const host = referrerHost(referrer);
  if (!host) return { key: "direct", label: "Direct", type: "direct" };
  if (host.includes("google.")) return { key: host, label: "Google", type: "search" };
  if (host.includes("github.")) return { key: host, label: "GitHub", type: "developer" };
  if (host.includes("linkedin.")) return { key: host, label: "LinkedIn", type: "social" };
  return { key: host, label: host, type: "referral" };
}

function referrerHost(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return String(value).replace(/^www\./, "");
  }
}

function normalizePath(value) {
  if (!value) return "";
  try {
    return new URL(value, "https://www.yuqi.site").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return String(value).split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  }
}

function visitorKey(item) {
  return item.sessionId || item.anonymousId || item.ipAddress || item.eventId || "";
}

function countUnique(items, mapper) {
  return new Set(items.map(mapper).filter(Boolean)).size;
}

function engagedSeconds(item) {
  const value = item.properties?.engagedSeconds;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(3600, number) : 0;
}
