import { requireAdminUser } from "../../../src/lib/agentServiceProxy";

const PROD_DEFAULT = "https://portfolio-analytics-aggregator-702193211434.us-central1.run.app";
const ALLOWED_QUERY = new Set(["from", "to", "hours", "q", "event", "path", "country", "city", "device", "browser", "referrer", "sessionId", "bot", "includeAdmin"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!await requireAdminUser(req, res)) return;
  const token = process.env.ANALYTICS_SERVICE_TOKEN || process.env.NOTIFICATION_SERVICE_TOKEN;
  if (!token) return res.status(503).json({ error: "config_missing", message: "Visitor overview is not configured." });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (ALLOWED_QUERY.has(key) && value != null) params.set(key, String(Array.isArray(value) ? value[0] : value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const base = (process.env.ANALYTICS_API_URL || PROD_DEFAULT).replace(/\/+$/, "");
    const upstream = await fetch(`${base}/api/admin/visitor-overview?${params}`, {
      headers: { Accept: "application/json", "X-Internal-Token": token }, signal: controller.signal,
    });
    if (!upstream.ok) return res.status(upstream.status === 400 ? 400 : 502).json({
      error: "overview_unavailable", message: upstream.status === 400 ? "Check the time range and filters." : "Visitor overview could not be loaded.",
    });
    return res.status(200).json(await upstream.json());
  } catch (error) {
    return res.status(502).json({ error: "analytics_unreachable", message: error.name === "AbortError" ? "Visitor overview timed out." : "Visitor overview could not be loaded." });
  } finally { clearTimeout(timeout); }
}
