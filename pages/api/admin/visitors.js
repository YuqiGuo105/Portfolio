import { requireAdminUser } from "../../../src/lib/agentServiceProxy";

const PROD_DEFAULT = "https://portfolio-analytics-aggregator-702193211434.us-central1.run.app";
const ALLOWED_QUERY = new Set([
  "from", "to", "hours", "q", "event", "path", "country", "city",
  "device", "browser", "referrer", "sessionId", "page", "size",
]);

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
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(body);
  } catch (error) {
    return res.status(502).json({
      error: "analytics_unreachable",
      message: error.name === "AbortError" ? "Visitor query timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
}
