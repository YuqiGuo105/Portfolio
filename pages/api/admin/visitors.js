import { requireAdminUser } from "../../../src/lib/agentServiceProxy";
import { supabaseServer } from "../../../src/supabase/supabaseServer";

const PROD_DEFAULT = "https://portfolio-analytics-aggregator-702193211434.us-central1.run.app";
const EXPORT_FORMATS = new Set(["csv", "json"]);
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_ROWS = boundedInteger(process.env.ADMIN_VISITOR_EXPORT_MAX_ROWS, 5_000, 100, 10_000);
const EXPORT_CONCURRENCY = 5;
const ALLOWED_QUERY = new Set([
  "from", "to", "hours", "q", "event", "path", "country", "city",
  "device", "browser", "referrer", "sessionId", "includeAdmin", "page", "size",
]);
const CONTENT_ROUTES = [
  { prefix: "/work-single/", table: "Projects", type: "project" },
  { prefix: "/blog-single/", table: "Blogs", type: "tech blog" },
  { prefix: "/life-blog/", table: "life_blogs", type: "life blog" },
];

export const config = {
  api: {
    responseLimit: false,
  },
};

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
  const format = firstQueryValue(req.query.format)?.toLowerCase();
  if (format && !EXPORT_FORMATS.has(format)) {
    return res.status(400).json({
      error: "invalid_export_format",
      message: "Export format must be csv or json.",
    });
  }

  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (format) {
      const exported = await loadExportRows(base, token, params);
      return sendExport(res, format, exported);
    }

    const payload = await fetchVisitorPage(base, token, params);
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
    return res.status(error.status || 502).json({
      error: error.code || "analytics_unreachable",
      message: error.message || "Visitor query failed.",
    });
  }
}

async function fetchVisitorPage(base, token, params) {
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
    if (!upstream.ok) {
      const error = new Error(readErrorMessage(body) || `Visitor query failed: ${upstream.status}`);
      error.status = upstream.status;
      error.code = "analytics_query_failed";
      throw error;
    }
    try {
      return JSON.parse(body);
    } catch {
      const error = new Error("Analytics service returned an invalid response.");
      error.status = 502;
      error.code = "invalid_analytics_response";
      throw error;
    }
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Visitor query timed out.");
      timeoutError.status = 504;
      timeoutError.code = "analytics_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadExportRows(base, token, queryParams) {
  const firstParams = new URLSearchParams(queryParams);
  firstParams.set("page", "0");
  firstParams.set("size", String(EXPORT_PAGE_SIZE));

  const firstPage = await fetchVisitorPage(base, token, firstParams);
  const reportedTotal = Math.max(0, Number(firstPage.page?.totalElements || 0));
  const rowLimit = Math.min(reportedTotal, EXPORT_MAX_ROWS);
  const totalPages = Math.ceil(rowLimit / EXPORT_PAGE_SIZE);
  const stableParams = new URLSearchParams(queryParams);
  stableParams.delete("hours");
  if (firstPage.from) stableParams.set("from", firstPage.from);
  if (firstPage.to) stableParams.set("to", firstPage.to);
  stableParams.set("size", String(EXPORT_PAGE_SIZE));

  const pageNumbers = Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 1);
  const remainingPages = await mapWithConcurrency(pageNumbers, EXPORT_CONCURRENCY, async (pageNumber) => {
    const pageParams = new URLSearchParams(stableParams);
    pageParams.set("page", String(pageNumber));
    return fetchVisitorPage(base, token, pageParams);
  });
  const items = [
    ...(Array.isArray(firstPage.items) ? firstPage.items : []),
    ...remainingPages.flatMap((page) => (Array.isArray(page.items) ? page.items : [])),
  ].slice(0, EXPORT_MAX_ROWS);

  return {
    items,
    from: firstPage.from || null,
    to: firstPage.to || null,
    total: reportedTotal,
    truncated: reportedTotal > items.length,
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

function sendExport(res, format, exported) {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `visitor-logs-${date}.${format}`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Export-Row-Count", String(exported.items.length));
  res.setHeader("X-Export-Truncated", String(exported.truncated));

  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(JSON.stringify({
      exportedAt: new Date().toISOString(),
      from: exported.from,
      to: exported.to,
      count: exported.items.length,
      totalMatching: exported.total,
      truncated: exported.truncated,
      items: exported.items,
    }, null, 2));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  return res.status(200).send(toCsv(exported.items));
}

function toCsv(items) {
  const columns = [
    ["event_time", (item) => item.eventTime],
    ["event_name", (item) => item.eventName],
    ["event_id", (item) => item.eventId],
    ["page_url", (item) => item.pageUrl],
    ["target_url", (item) => item.targetUrl],
    ["referrer", (item) => item.referrer],
    ["country", (item) => item.country],
    ["region", (item) => item.region],
    ["city", (item) => item.city],
    ["latitude", (item) => item.latitude],
    ["longitude", (item) => item.longitude],
    ["device_type", (item) => item.deviceType],
    ["browser", (item) => item.browser],
    ["os", (item) => item.os],
    ["bot", (item) => item.bot],
    ["ip_address", (item) => item.ipAddress],
    ["session_id", (item) => item.sessionId],
    ["anonymous_id", (item) => item.anonymousId],
    ["user_agent", (item) => item.userAgent],
    ["properties", (item) => item.properties],
  ];
  const rows = [
    columns.map(([header]) => csvCell(header)).join(","),
    ...items.map((item) => columns.map(([, read]) => csvCell(read(item))).join(",")),
  ];
  return `\uFEFF${rows.join("\r\n")}`;
}

function csvCell(value) {
  if (value == null) return "\"\"";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function readErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed.message || parsed.error || "";
  } catch {
    return String(body || "").slice(0, 500);
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

function firstQueryValue(value) {
  const normalized = Array.isArray(value) ? value[0] : value;
  return typeof normalized === "string" && normalized.trim() ? normalized.trim() : null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
