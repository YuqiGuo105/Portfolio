import { requireAdminUser } from "../../../src/lib/agentServiceProxy";
import { supabaseServer } from "../../../src/supabase/supabaseServer";

const PROD_DEFAULT = "https://portfolio-analytics-aggregator-702193211434.us-central1.run.app";
const ALLOWED_QUERY = new Set([
  "from", "to", "hours", "q", "event", "path", "country", "city",
  "device", "browser", "referrer", "sessionId", "includeAdmin", "page", "size",
]);
const CONTENT_ROUTES = [
  { prefix: "/work-single/", table: "Projects", type: "project" },
  { prefix: "/blog-single/", table: "Blogs", type: "tech blog" },
  { prefix: "/life-blog/", table: "life_blogs", type: "life blog" },
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

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (!ALLOWED_QUERY.has(key) || value == null) continue;
    const normalized = Array.isArray(value) ? value[0] : value;
    params.set(key, String(normalized));
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

    return res.status(200).json({
      ...payload,
      items: items.map((item) => ({
        ...item,
        pageContent: contentByPath.get(normalizePath(item.pageUrl)) || null,
        targetContent: contentByPath.get(normalizePath(item.targetUrl)) || null,
      })),
    });
  } catch (error) {
    return res.status(502).json({
      error: "analytics_unreachable",
      message: error.name === "AbortError" ? "Visitor query timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
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
        id: String(row.id),
        type: route.type,
        title: row.title || row.name || "Untitled content",
        coverUrl: firstValue(row.image_url),
        canonicalUrl: path,
      });
    }
  }
  return contentByPath;
}

function collectRoute(requested, value) {
  const path = normalizePath(value);
  if (!path || requested.has(path)) return;
  const route = CONTENT_ROUTES.find((candidate) => path.startsWith(candidate.prefix));
  if (!route) return;
  const encodedId = path.slice(route.prefix.length).split("/")[0];
  if (!encodedId) return;
  try {
    requested.set(path, { ...route, id: decodeURIComponent(encodedId) });
  } catch {
    // A malformed path remains visible as raw visitor data but is not queried.
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

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}
