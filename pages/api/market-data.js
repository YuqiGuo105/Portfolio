// pages/api/market-data.js

// Free / no-key market data source (JSON):
// https://query1.finance.yahoo.com/v8/finance/chart/GS
// Note: data may be delayed / not real-time for all symbols.

const SYMBOLS = [
  { label: "GS", yahoo: "GS", currency: "USD", shortName: "Goldman Sachs Group, Inc." },
  { label: "SPX", yahoo: "^GSPC", currency: "USD", shortName: "S&P 500 Index" },
  { label: "UKX", yahoo: "^FTSE", currency: "GBP", shortName: "FTSE 100 Index" },
  { label: "NDX", yahoo: "^NDX", currency: "USD", shortName: "NASDAQ 100 Index" },
  { label: "NKY", yahoo: "^N225", currency: "JPY", shortName: "Nikkei 225" },
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

const parseYahooChart = (payload) => {
  const result = payload?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];

  let lastIdx = -1;
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    if (parseNumber(closes[i]) !== null) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < 0) return null;

  const close = parseNumber(closes[lastIdx]);
  const open = parseNumber(opens[lastIdx]);
  const tsSec = timestamps[lastIdx];

  const timestamp = Number.isFinite(tsSec) ? tsSec * 1000 : Date.now();

  return {
    open,
    close,
    timestamp,
    shortName: result.meta?.shortName ?? null,
  };
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

const fetchWithTimeout = async (url, ms) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json,*/*" },
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchYahooQuote = async (symbol) => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const resp = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!resp.ok) throw new Error(`Yahoo request failed for ${symbol} with ${resp.status}`);

  const json = await resp.json();
  const parsed = parseYahooChart(json);
  if (!parsed) throw new Error(`Yahoo returned no usable chart data for ${symbol}`);

  return parsed;
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
    const missing = [];
    const data = await Promise.all(SYMBOLS.map(async (cfg, index) => {
      try {
        const quote = await fetchYahooQuote(cfg.yahoo);
        if (quote.open === null || quote.close === null) {
          missing.push(cfg.label);
          return buildFallbackItem(cfg.label, now, index);
        }

        const change = quote.close - quote.open;
        const changePercent = quote.open ? (change / quote.open) * 100 : null;

        return {
          label: cfg.label,
          price: quote.close,
          currency: cfg.currency,
          change: Number.isFinite(change) ? Number(change.toFixed(2)) : null,
          changePercent: Number.isFinite(changePercent) ? Number(changePercent.toFixed(2)) : null,
          timestamp: quote.timestamp ?? now,
          shortName: quote.shortName ?? cfg.shortName ?? cfg.label,
        };
      } catch {
        missing.push(cfg.label);
        return buildFallbackItem(cfg.label, now, index);
      }
    })).then((rows) => rows.filter(Boolean));

    if (!data.length) throw new Error("Yahoo returned no usable data");

    const payload = {
      data,
      meta: {
        source: "yahoo-finance",
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
