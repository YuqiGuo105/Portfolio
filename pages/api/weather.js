// pages/api/weather.js

const WEATHER_CODE_MAP = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  80: "Rain showers",
  81: "Heavy rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

// Geo cache (per IP) to reduce latency spikes.
const GEO_CACHE = new Map(); // ip -> { location, expiresAtMs }
const GEO_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Weather cache (per lat/lon) to reduce repeat calls.
const WEATHER_CACHE = new Map(); // key -> { payload, expiresAtMs }
const WEATHER_TTL_MS = 10 * 60 * 1000; // 10 minutes

const GEO_TIMEOUT_MS = 1200;
const WEATHER_TIMEOUT_MS = 2200;

const isLocalIp = (ip) => {
  if (!ip) return true;
  const v = ip.toLowerCase();

  if (v === "::1" || v === "127.0.0.1" || v === "::ffff:127.0.0.1") return true;

  // Basic private IPv4 ranges
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  const m = v.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }

  // IPv6 private / link-local
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:")) return true;

  return false;
};

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(",")[0]?.trim() || req.socket?.remoteAddress;

  if (!raw) return null;

  // Remove IPv6 prefix and potential port part.
  // Examples: "::ffff:8.8.8.8", "1.2.3.4:12345"
  const stripped = raw.replace(/^::ffff:/, "").split(":")[0].trim();
  return stripped || null;
};

const fetchJsonWithTimeout = async (url, ms) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timeout);
  }
};

const getLocationByIp = async (ip) => {
  const now = Date.now();
  const cached = GEO_CACHE.get(ip);
  if (cached && cached.expiresAtMs > now && cached.location) {
    return { ...cached.location, _source: "cache" };
  }

  // Provider A (preferred): ipwho.org (no key)
  // Example endpoint from their repo: https://ipwho.org/ip/8.8.8.8
  try {
    const urlA = `https://ipwho.org/ip/${encodeURIComponent(ip)}`;
    const respA = await fetchJsonWithTimeout(urlA, GEO_TIMEOUT_MS);
    if (respA.ok) {
      const j = await respA.json();
      if (j && j.latitude && j.longitude) {
        const location = {
          city: j.city ?? null,
          region: j.region ?? null,
          country: j.country ?? null,
          latitude: j.latitude,
          longitude: j.longitude,
        };
        GEO_CACHE.set(ip, { location, expiresAtMs: now + GEO_TTL_MS });
        return { ...location, _source: "ipwho.org" };
      }
    }
  } catch (_) {
    // ignore and fallback
  }

  // Provider B (fallback): ipapi.co (no key, may rate limit)
  try {
    const urlB = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
    const respB = await fetchJsonWithTimeout(urlB, GEO_TIMEOUT_MS);
    if (respB.ok) {
      const j = await respB.json();
      if (j && j.latitude && j.longitude) {
        const location = {
          city: j.city ?? null,
          region: j.region ?? null,
          country: j.country_name ?? null,
          latitude: j.latitude,
          longitude: j.longitude,
        };
        GEO_CACHE.set(ip, { location, expiresAtMs: now + GEO_TTL_MS });
        return { ...location, _source: "ipapi.co" };
      }
    }
  } catch (_) {
    // ignore
  }

  return null;
};

export default async function handler(req, res) {
  try {
    const ip = getClientIp(req);

    let location = null;
    if (ip && !isLocalIp(ip)) {
      location = await getLocationByIp(ip);
    }

    if (!location) {
      // fallback to New York City
      location = {
        city: "New York",
        region: "NY",
        country: "United States",
        latitude: 40.7128,
        longitude: -74.006,
        fallback: true,
      };
    }

    const key = `${Number(location.latitude).toFixed(3)},${Number(location.longitude).toFixed(3)}`;
    const now = Date.now();
    const cachedWeather = WEATHER_CACHE.get(key);
    if (cachedWeather && cachedWeather.expiresAtMs > now && cachedWeather.payload) {
      res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
      res.status(200).json(cachedWeather.payload);
      return;
    }

    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(location.latitude)}` +
      `&longitude=${encodeURIComponent(location.longitude)}` +
      `&current=temperature_2m,weather_code` +
      `&daily=sunrise,sunset` +
      `&temperature_unit=fahrenheit` +
      `&timezone=auto`;

    const resp = await fetchJsonWithTimeout(weatherUrl, WEATHER_TIMEOUT_MS);
    if (!resp.ok) {
      throw new Error(`Open-Meteo request failed with ${resp.status}`);
    }

    const weatherJson = await resp.json();
    const current = weatherJson.current ?? {};
    const daily = weatherJson.daily ?? {};

    const payload = {
      location,
      temperature: current.temperature_2m ?? null,
      weatherCode: current.weather_code ?? null,
      weatherDescription: WEATHER_CODE_MAP[current.weather_code] ?? "Partly cloudy",
      sunrise: daily.sunrise?.[0] ?? null,
      sunset: daily.sunset?.[0] ?? null,
      fetchedAt: Date.now(),
      meta: { provider: "open-meteo" },
    };

    WEATHER_CACHE.set(key, { payload, expiresAtMs: now + WEATHER_TTL_MS });

    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
    res.status(200).json(payload);
  } catch (error) {
    console.error("Weather API error", error);

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
    res.status(200).json({
      location: { city: "New York", region: "NY", country: "United States" },
      temperature: 49,
      weatherCode: 2,
      weatherDescription: "Partly cloudy",
      sunrise: new Date().setHours(7, 53, 0, 0),
      sunset: new Date().setHours(18, 29, 0, 0),
      fetchedAt: Date.now() - 2 * 60 * 60 * 1000,
      fallback: true,
      meta: { provider: "fallback", reason: error?.message ?? null },
    });
  }
}
