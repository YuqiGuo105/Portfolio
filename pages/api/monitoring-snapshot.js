// pages/api/monitoring-snapshot.js
//
// Server-side proxy that renders the Grafana dashboard as a PNG image.
// Grafana Cloud blocks iframe embedding (X-Frame-Options: deny + frame-ancestors 'none'),
// so we fetch a rendered PNG using our service account token and stream it back
// with a short cache. Client displays it as <img>.

const GRAFANA_URL = "https://loyalcaravan951.grafana.net";
const DASHBOARD_UID = "spring_boot_21";
const DASHBOARD_SLUG = "spring-boot-3-x-statistics";
const CACHE_SECONDS = 300; // 5 minutes
const RENDER_TIMEOUT_MS = 20000;

let cache = { buffer: null, contentType: null, fetchedAtMs: 0 };

export default async function handler(req, res) {
  const token = process.env.GRAFANA_RENDER_TOKEN;

  if (!token) {
    res.status(503).json({ error: "GRAFANA_RENDER_TOKEN not configured" });
    return;
  }

  const now = Date.now();
  const cacheAgeMs = now - cache.fetchedAtMs;

  // Serve from in-memory cache if fresh
  if (cache.buffer && cacheAgeMs < CACHE_SECONDS * 1000) {
    res.setHeader("Content-Type", cache.contentType || "image/png");
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`
    );
    res.setHeader("X-Cache", "HIT");
    res.status(200).send(cache.buffer);
    return;
  }

  const width = Number.parseInt(req.query.width, 10) || 1200;
  const height = Number.parseInt(req.query.height, 10) || 800;

  const renderUrl =
    `${GRAFANA_URL}/render/d/${DASHBOARD_UID}/${DASHBOARD_SLUG}` +
    `?orgId=1&width=${width}&height=${height}&tz=America/Los_Angeles&from=now-1h&to=now`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

  try {
    const upstream = await fetch(renderUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      // Fall back to stale cache if we have one
      if (cache.buffer) {
        res.setHeader("Content-Type", cache.contentType || "image/png");
        res.setHeader("Cache-Control", "public, max-age=60");
        res.setHeader("X-Cache", "STALE");
        res.status(200).send(cache.buffer);
        return;
      }
      res.status(upstream.status).json({
        error: "Grafana render failed",
        status: upstream.status,
      });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    cache = { buffer, contentType, fetchedAtMs: now };

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`
    );
    res.setHeader("X-Cache", "MISS");
    res.status(200).send(buffer);
  } catch (err) {
    clearTimeout(timer);
    // Serve stale cache on error if we have one
    if (cache.buffer) {
      res.setHeader("Content-Type", cache.contentType || "image/png");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.setHeader("X-Cache", "STALE-ON-ERROR");
      res.status(200).send(cache.buffer);
      return;
    }
    res.status(502).json({
      error: "Failed to render Grafana dashboard",
      message: err?.message || String(err),
    });
  }
}
