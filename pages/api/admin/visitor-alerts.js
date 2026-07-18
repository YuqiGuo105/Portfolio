import { requireAdminUser } from "../../../src/lib/agentServiceProxy";

const PROD_DEFAULT = "https://portfolio-analytics-alerts-702193211434.us-central1.run.app";

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

  const requestedHours = Number.parseInt(String(req.query.hours || "24"), 10);
  const hours = Math.max(1, Math.min(Number.isFinite(requestedHours) ? requestedHours : 24, 24 * 90));
  const base = (process.env.ANALYTICS_ALERTS_API_URL || PROD_DEFAULT).replace(/\/+$/, "");
  const incidentParams = new URLSearchParams({ hours: String(hours), limit: "25" });
  if (process.env.ANALYTICS_SITE_ID) {
    incidentParams.set("siteId", process.env.ANALYTICS_SITE_ID);
  }
  const headers = { Accept: "application/json", "X-Internal-Token": token };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const [rulesResponse, incidentsResponse] = await Promise.all([
      fetch(`${base}/api/alert-rules`, { headers, signal: controller.signal }),
      fetch(`${base}/api/incidents?${incidentParams.toString()}`, {
        headers,
        signal: controller.signal,
      }),
    ]);

    if (!rulesResponse.ok || !incidentsResponse.ok) {
      const failed = !rulesResponse.ok ? rulesResponse : incidentsResponse;
      const body = await failed.text();
      return res.status(failed.status).json({
        error: "alerts_upstream_error",
        message: body || `Alert service returned ${failed.status}.`,
      });
    }

    const [rules, incidents] = await Promise.all([
      rulesResponse.json(),
      incidentsResponse.json(),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({
      rules: Array.isArray(rules) ? rules : [],
      incidents: Array.isArray(incidents?.items) ? incidents.items : [],
      summary: incidents?.summary || { total: 0, notified: 0, pendingNotification: 0 },
    });
  } catch (error) {
    return res.status(502).json({
      error: "alerts_unreachable",
      message: error.name === "AbortError" ? "Alert query timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
}
