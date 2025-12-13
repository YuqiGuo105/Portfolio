// pages/api/market-data.js

// Free / no-key market data source (CSV):
// https://stooq.com/q/l/?s=gs.us,^spx&f=sd2t2ohlcv&h&e=csv
// Note: data may be delayed / not real-time for all symbols.

const SYMBOLS = [
  { label: "GS", stooq: "gs.us", currency: "USD", shortName: "Goldman Sachs Group, Inc." },
  { label: "SPX", stooq: "^spx", currency: "USD", shortName: "S&P 500 Index" },
  { label: "UKX", stooq: "^ftse", currency: "GBP", shortName: "FTSE 100 Index" },
  { label: "NDX", stooq: "^ndx", currency: "USD", shortName: "NASDAQ 100 Index" },
  { label: "NKY", stooq: "^n225", currency: "JPY", shortName: "Nikkei 225" },
];

// Keep your baseline snapshot and simulated fallback behavior.
const BASELINE_DATA = [
  { label: "GS", price: 792.09, currency: "USD", change: 2.1, changePercent: 0.27, shortName: "Goldman Sachs Group, Inc." },
  { label: "SPX", price: 6890.89, currency: "USD", change: 15.73, changePercent: 0.23, shortName: "S&P 500 Index" },
  { label: "UKX", price: 9696.74, currency: "GBP", change: 42.92, changePercent: 0.44, shortName: "FTSE 100 Index" },
  { label: "NDX", price: 26012.16, currency: "USD", change: 190.61, changePercent: 0.74, shortName: "NASDAQ 100 Index" },
  { label: "NKY", price: 51092.28, currency: "JPY", change: 873.1, changePercent: 1.74, shortName: "Nikkei 225" },
];

const FETCH_TIMEOUT_MS = 2500;

// Short TTL because market data may change; CDN cache still reduces latency a lot.
const MARKET_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
let MARKET_CACHE = { payload: null, expiresAtMs: 0 };

const parseNumber = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const parseTimestampMs = (dateStr, timeStr) => {
  if (!dateStr) return null;
  const t = (timeStr && timeStr.trim()) ? timeStr.trim() : "00:00:00";
  const d = new Date(`${dateStr}T${t}`);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const parseStooqCsv = (csvText) => {
  const text = (csvText ?? "").trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  // Expected header:
  // Symbol,Date,Time,Open,High,Low,Close,Volume
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iSymbol = idx("Symbol");
  const iDate = idx("Date");
  const iTime = idx("Time");
  const iOpen = idx("Open");
  const iClose = idx("Close");

  if (iSymbol < 0 || iDate < 0 || iOpen < 0 || iClose < 0) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",").map((s) => s.trim());
    const symbol = cols[iSymbol]?.toLowerCase();
    if (!symbol) continue;

    const open = parseNumber(cols[iOpen]);
    const close = parseNumber(cols[iClose]);

    const dateStr = cols[iDate] || null;
    const timeStr = iTime >= 0 ? (cols[iTime] || null) : null;
    const ts = parseTimestampMs(dateStr, timeStr);

    rows.push({ symbol, open, close, ts });
  }

  return rows;
};

const simulateFromBaseline = (error) => {
  const now = Date.now();
  const simulated = BASELINE_DATA.map((item, index) => {
    const basePrice = item.price - (item.change ?? 0);
    const wave = Math.sin(now / (1000 * 60 * 10) + index);
    const variance = 1 + wave * 0.18;
    const change = (item.change ?? 0) * variance;
    const price = basePrice + change;
    const changePercent = basePrice ? (change / basePrice) * 100 : item.changePercent ?? 0;

    return {
      ...item,
      price: Number(price.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      timestamp: now - index * 12 * 60 * 1000,
    };
  });

  return {
    data: simulated,
    meta: {
      source: "simulated",
      updatedAt: now,
      reason: error?.message ?? null,
    },
    fallback: true,
  };
};

const buildFallbackItem = (label, now, index) => {
  const base = BASELINE_DATA.find((x) => x.label === label);
  if (!base) return null;

  const basePrice = base.price - (base.change ?? 0);
  const wave = Math.sin(now / (1000 * 60 * 10) + index);
  const variance = 1 + wave * 0.18;
  const change = (base.change ?? 0) * variance;
  const price = basePrice + change;
  const changePercent = basePrice ? (change / basePrice) * 100 : base.changePercent ?? 0;

  return {
    ...base,
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    timestamp: now - index * 12 * 60 * 1000,
  };
};

const fetchTextWithTimeout = async (url, ms) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/csv,*/*" },
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timeout);
  }
};

export default async function handler(req, res) {
  const now = Date.now();

  // Hot cache path (fastest)
  if (MARKET_CACHE.payload && MARKET_CACHE.expiresAtMs > now) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
    res.status(200).json(MARKET_CACHE.payload);
    return;
  }

  try {
    const stooqSymbols = SYMBOLS.map((s) => s.stooq).join(",");
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(
      stooqSymbols
    )}&f=sd2t2ohlcv&h&e=csv`;

    const resp = await fetchTextWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!resp.ok) throw new Error(`Stooq request failed with ${resp.status}`);

    const csv = await resp.text();
    const rows = parseStooqCsv(csv);

    const bySymbol = new Map();
    for (const r of rows) bySymbol.set(r.symbol, r);

    const missing = [];
    const data = SYMBOLS.map((cfg, index) => {
      const r = bySymbol.get(cfg.stooq.toLowerCase());
      if (!r || r.open === null || r.close === null) {
        missing.push(cfg.label);
        return buildFallbackItem(cfg.label, now, index);
      }

      const change = r.close - r.open;
      const changePercent = r.open ? (change / r.open) * 100 : null;

      return {
        label: cfg.label,
        price: r.close,
        currency: cfg.currency,
        change: Number.isFinite(change) ? Number(change.toFixed(2)) : null,
        changePercent: Number.isFinite(changePercent) ? Number(changePercent.toFixed(2)) : null,
        timestamp: r.ts ?? now,
        shortName: cfg.shortName ?? cfg.label,
      };
    }).filter(Boolean);

    if (!data.length) throw new Error("Stooq returned no usable data");

    const payload = {
      data,
      meta: {
        source: "stooq",
        updatedAt: now,
        partial: missing.length ? missing : null,
      },
      fallback: missing.length > 0,
    };

    // Update warm cache
    MARKET_CACHE = { payload, expiresAtMs: now + MARKET_CACHE_TTL_MS };

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
    res.status(200).json(payload);
  } catch (error) {
    console.error("Market data error", error);

    const payload = simulateFromBaseline(error);
    MARKET_CACHE = { payload, expiresAtMs: now + 60 * 1000 }; // short cache for fallback

    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=86400");
    res.status(200).json(payload);
  }
}
