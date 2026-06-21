/**
 * Server-side proxy → Spring notification service.
 *
 * Why a proxy? Three reasons:
 *  - keeps the Spring service URL configurable on Vercel via NOTIFICATION_SERVICE_URL
 *  - avoids browser CORS preflights from the Portfolio origin
 *  - injects the X-Internal-Token shared secret server-side so the browser never sees it
 *
 * Env required:
 *   NOTIFICATION_SERVICE_URL    e.g. https://portfolio-notification-service-xxxx.run.app
 *   NOTIFICATION_SERVICE_TOKEN  shared secret, must match the Spring service's
 *                               INTERNAL_API_TOKEN env / portfolio.internal-token property.
 */

function getBase() {
  const base = process.env.NOTIFICATION_SERVICE_URL;
  if (!base) {
    return null;
  }
  return base.replace(/\/+$/, "");
}

function getInternalToken() {
  const t = process.env.NOTIFICATION_SERVICE_TOKEN;
  if (!t || typeof t !== "string") return null;
  return t;
}

export async function forward(
  req,
  res,
  { path, method = "GET", forwardBody = true, forwardQuery = true }
) {
  const base = getBase();
  if (!base) {
    res.status(500).json({
      error: "config_missing",
      message:
        "NOTIFICATION_SERVICE_URL env var is not set on this deployment.",
    });
    return;
  }

  const token = getInternalToken();
  if (!token) {
    res.status(500).json({
      error: "config_missing",
      message:
        "NOTIFICATION_SERVICE_TOKEN env var is not set on this deployment.",
    });
    return;
  }

  let url = `${base}${path}`;
  if (forwardQuery && req.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((vv) => params.append(k, vv));
      else params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const init = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Server-side only. The browser never sees this token because this code
      // runs in a Next.js API route on Vercel, not in the client bundle.
      "X-Internal-Token": token,
    },
  };
  if (forwardBody && method !== "GET" && method !== "HEAD") {
    init.body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : "{}";
  }

  let upstream;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    res.status(502).json({ error: "upstream_unreachable", message: err.message });
    return;
  }

  const text = await upstream.text();
  res.status(upstream.status);
  // Pass through Content-Type if present, else JSON.
  const ct = upstream.headers.get("content-type") || "application/json";
  res.setHeader("Content-Type", ct);
  res.send(text);
}

export function methodGuard(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader("Allow", allowed.join(", "));
    res.status(405).json({ error: "method_not_allowed" });
    return false;
  }
  return true;
}
