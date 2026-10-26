import { parseTileRequest, upstreamTileUrl } from "../../../../../src/lib/globeTiles.mjs";

// Same-origin proxy for the visitor globe's close-up imagery: NASA GIBS Blue Marble, public domain.
// The tiles never change, so a good response is cached for a month in browsers and a year on the CDN;
// the globe keeps its base texture wherever a tile fails.
const TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024;
const CACHE_TILE = "public, max-age=2592000, s-maxage=31536000, immutable";

async function fetchTile(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "image/jpeg,image/png;q=0.9" },
      signal: controller.signal,
    });
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!response.ok || !type.startsWith("image/")) return { status: response.ok ? 502 : response.status };
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > MAX_BYTES) return { status: 502 };
    return { status: 200, type, body };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  const tile = parseTileRequest(req.query);
  if (!tile) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(404).end();
  }

  const url = upstreamTileUrl(tile, process.env.MAP_TILE_UPSTREAM);
  let result = { status: 502 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await fetchTile(url);
    } catch (error) {
      result = { status: 504, message: error?.message };
    }
    // Retry once on a timeout or upstream error; a 4xx will not fix itself.
    if (result.status === 200 || (result.status >= 400 && result.status < 500)) break;
  }

  if (result.status !== 200) {
    console.warn("Globe tile unavailable", { ...tile, status: result.status, message: result.message });
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).end();
  }

  res.setHeader("Content-Type", result.type);
  res.setHeader("Content-Length", String(result.body.length));
  res.setHeader("Cache-Control", CACHE_TILE);
  return req.method === "HEAD" ? res.status(200).end() : res.status(200).send(result.body);
}
