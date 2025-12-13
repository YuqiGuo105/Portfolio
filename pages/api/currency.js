// pages/api/currency.js

// Free / no-key currency data source:
// https://open.er-api.com/v6/latest/USD (open access, attribution required)
// See docs: https://www.exchangerate-api.com/docs/free

const FALLBACK_BASE_RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155.12,
  CNY: 7.23,
};

// Cache rates by base currency to reduce latency and external calls.
// Note: In serverless, cache is per warm instance (still very helpful).
const RATE_CACHE = new Map(); // base -> { rates, updatedAtMs, expiresAtMs }
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FETCH_TIMEOUT_MS = 2500;

const computeFallbackRate = (base, target) => {
  const normalizedBase = base.toUpperCase();
  const normalizedTarget = target.toUpperCase();
  const baseRate = FALLBACK_BASE_RATES[normalizedBase];
  const targetRate = FALLBACK_BASE_RATES[normalizedTarget];

  if (!baseRate || !targetRate) return null;
  return targetRate / baseRate;
};

const normalizeCurrency = (value, fallback) => {
  const v = (value ?? fallback ?? "").toString().trim().toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : fallback;
};

const safeAmount = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
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

const getRatesForBase = async (base) => {
  const now = Date.now();
  const cached = RATE_CACHE.get(base);
  if (cached && cached.expiresAtMs > now && cached.rates) {
    return { rates: cached.rates, updatedAtMs: cached.updatedAtMs, source: "cache" };
  }

  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  const resp = await fetchJsonWithTimeout(url, FETCH_TIMEOUT_MS);

  if (!resp.ok) {
    throw new Error(`ExchangeRate-API request failed with ${resp.status}`);
  }

  const json = await resp.json();

  // Expect: { result: "success", time_last_update_unix, rates: { ... } }
  if (json?.result !== "success" || !json?.rates) {
    throw new Error("ExchangeRate-API returned unexpected payload");
  }

  const updatedAtMs = json?.time_last_update_unix
    ? Number(json.time_last_update_unix) * 1000
    : now;

  const expiresAtMs = now + CACHE_TTL_MS;

  RATE_CACHE.set(base, {
    rates: json.rates,
    updatedAtMs,
    expiresAtMs,
  });

  return { rates: json.rates, updatedAtMs, source: "live" };
};

export default async function handler(req, res) {
  const base = normalizeCurrency(req.query?.base, "USD");
  const target = normalizeCurrency(req.query?.target, "EUR");
  const amount = safeAmount(req.query?.amount ?? "1");

  try {
    const { rates, updatedAtMs, source } = await getRatesForBase(base);

    const apiRate = rates?.[target];
    const rate =
      typeof apiRate === "number" && Number.isFinite(apiRate)
        ? apiRate
        : computeFallbackRate(base, target);

    if (rate === null) throw new Error("Unable to determine exchange rate");

    // CDN cache (Vercel/Netlify) + stale revalidate for snappy responses
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");

    res.status(200).json({
      amount,
      base,
      target,
      rate,
      timestamp: updatedAtMs,
      fallback: !(typeof apiRate === "number" && Number.isFinite(apiRate)),
      meta: { source },
    });
  } catch (error) {
    console.error("Currency API error", error);

    const fallbackRate = computeFallbackRate(base, target);

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
    res.status(200).json({
      amount,
      base,
      target,
      rate: fallbackRate,
      timestamp: Date.now() - 60 * 60 * 1000,
      fallback: true,
      meta: { source: "fallback", reason: error?.message ?? null },
    });
  }
}
