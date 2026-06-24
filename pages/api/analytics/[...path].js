// Same-origin proxy → portfolio-analytics-platform aggregator service.
//
// Why a proxy: the aggregator runs on Render and the Portfolio runs on
// Vercel, so a direct browser call needs a CORS allow-list and exposes
// the backend URL. Going through this Next.js route hides the upstream
// origin, keeps cookies same-origin, and lets us add caching + auth later.
//
// Configure the upstream with `ANALYTICS_API_URL` (e.g.
// `https://portfolio-analytics-aggregator.onrender.com`).

const UPSTREAM = (process.env.ANALYTICS_API_URL || "http://localhost:8093").replace(/\/$/, "");

export default async function handler(req, res) {
  const { path = [] } = req.query;
  const subPath = Array.isArray(path) ? path.join("/") : String(path);

  // Forward only safe methods.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Whitelist the public read prefix; nothing else from the aggregator
  // should be reachable via this proxy.
  if (!subPath.startsWith("visits/")) {
    return res.status(404).json({ error: "not_found" });
  }

  // Rebuild query string without the catch-all `path` param.
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === "path") continue;
    if (Array.isArray(v)) v.forEach((vv) => search.append(k, vv));
    else if (v != null) search.append(k, String(v));
  }
  const qs = search.toString();
  const url = `${UPSTREAM}/api/public/${subPath}${qs ? `?${qs}` : ""}`;

  try {
    const upstreamRes = await fetch(url, {
      method: req.method,
      headers: { accept: "application/json" },
    });
    const body = await upstreamRes.text();
    res.status(upstreamRes.status);
    res.setHeader("content-type", upstreamRes.headers.get("content-type") || "application/json");
    // Cache the public read endpoints lightly so a refresh-spam doesn't hit
    // the free-tier Render dyno every time.
    res.setHeader("cache-control", "public, max-age=30, s-maxage=60, stale-while-revalidate=120");
    return res.send(body);
  } catch (err) {
    return res.status(502).json({ error: "upstream_unreachable", detail: err.message });
  }
}
