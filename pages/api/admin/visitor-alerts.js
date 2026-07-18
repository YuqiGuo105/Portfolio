import { requireAdminUser } from "../../../src/lib/agentServiceProxy";

const PROD_DEFAULT = "https://portfolio-analytics-alerts-702193211434.us-central1.run.app";

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
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

  const base = (process.env.ANALYTICS_ALERTS_API_URL || PROD_DEFAULT).replace(/\/+$/, "");
  const headers = { Accept: "application/json", "X-Internal-Token": token };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    if (req.method === 'POST') {
      return await handleRuleChange(req, res, { auth, base, headers, signal: controller.signal });
    }

    const requestedHours = Number.parseInt(String(req.query.hours || "24"), 10);
    const hours = Math.max(1, Math.min(Number.isFinite(requestedHours) ? requestedHours : 24, 24 * 90));
    const incidentParams = new URLSearchParams({ hours: String(hours), limit: "25" });
    if (process.env.ANALYTICS_SITE_ID) {
      incidentParams.set("siteId", process.env.ANALYTICS_SITE_ID);
    }
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
    if (error instanceof RequestValidationError) {
      return res.status(400).json({ error: "invalid_request", message: error.message });
    }
    return res.status(502).json({
      error: "alerts_unreachable",
      message: error.name === "AbortError" ? "Alert query timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleRuleChange(req, res, { auth, base, headers, signal }) {
  const operation = String(req.body?.operation || "").trim().toLowerCase();
  let path;
  let payload;

  if (operation === "prepare") {
    const creating = req.body?.ruleId === null || req.body?.ruleId === undefined || req.body?.ruleId === "";
    const ruleId = creating ? null : parsePositiveInteger(req.body?.ruleId, "ruleId");
    const reason = requiredString(req.body?.reason, "reason", 400);
    payload = {
      action: creating ? "CREATE" : "UPDATE",
      ruleId,
      patch: sanitizeRulePatch(req.body?.patch),
      reason,
      actor: auth.email,
    };
    path = "/api/alert-rules/changes/prepare";
  } else if (operation === "apply") {
    const changeId = requiredString(req.body?.changeId, "changeId", 80);
    if (!/^chg_[a-z0-9]+$/i.test(changeId)) {
      return res.status(400).json({ error: "invalid_request", message: "changeId is invalid." });
    }
    payload = {
      changeId,
      idempotencyKey: `admin-visitor-alert:${changeId}`,
    };
    path = "/api/alert-rules/changes/apply";
  } else {
    return res.status(400).json({
      error: "invalid_request",
      message: "operation must be prepare or apply.",
    });
  }

  const upstream = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return res.status(upstream.status).json({
      error: "alerts_upstream_error",
      message: body.error || body.message || `Alert service returned ${upstream.status}.`,
    });
  }
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(body);
}

function sanitizeRulePatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError("patch is required.");
  }
  const geoLevel = allowedValue(value.geoLevel, "geoLevel", ["GLOBAL", "COUNTRY", "REGION", "METRO"]);
  return {
    siteId: requiredString(value.siteId, "siteId", 120),
    name: requiredString(value.name, "name", 160),
    eventType: requiredString(value.eventType, "eventType", 80),
    geoLevel,
    geoAreaId: geoLevel === "GLOBAL" ? "" : optionalString(value.geoAreaId, 120),
    granularity: allowedValue(value.granularity, "granularity", ["5m", "1d"]),
    threshold: parseNonNegativeInteger(value.threshold, "threshold"),
    comparator: allowedValue(value.comparator, "comparator", [">=", "<="]),
    cooldownSeconds: parsePositiveInteger(value.cooldownSeconds, "cooldownSeconds", 60),
    enabled: parseBoolean(value.enabled, "enabled"),
  };
}

function allowedValue(value, field, allowed) {
  const normalized = String(value || "").trim();
  if (!allowed.includes(normalized)) {
    throw new RequestValidationError(`${field} is invalid.`);
  }
  return normalized;
}

function requiredString(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new RequestValidationError(`${field} is required.`);
  if (normalized.length > maxLength) {
    throw new RequestValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function optionalString(value, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length > maxLength) {
    throw new RequestValidationError(`geoAreaId must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function parsePositiveInteger(value, field, minimum = 1) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new RequestValidationError(`${field} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RequestValidationError(`${field} must be a non-negative integer.`);
  }
  return parsed;
}

function parseBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw new RequestValidationError(`${field} must be a boolean.`);
  }
  return value;
}

class RequestValidationError extends Error {}
