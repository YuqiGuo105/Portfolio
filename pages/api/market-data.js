const SYMBOLS = [
  { label: "GS", ticker: "GS" },
  { label: "SPX", ticker: "^GSPC" },
  { label: "UKX", ticker: "^FTSE" },
  { label: "NDX", ticker: "^NDX" },
  { label: "NKY", ticker: "^N225" },
];

const BASELINE_DATA = [
  {
    label: "GS",
    price: 792.09,
    currency: "USD",
    change: 2.1,
    changePercent: 0.27,
    shortName: "Goldman Sachs Group, Inc.",
  },
  {
    label: "SPX",
    price: 6890.89,
    currency: "USD",
    change: 15.73,
    changePercent: 0.23,
    shortName: "S&P 500 Index",
  },
  {
    label: "UKX",
    price: 9696.74,
    currency: "GBP",
    change: 42.92,
    changePercent: 0.44,
    shortName: "FTSE 100 Index",
  },
  {
    label: "NDX",
    price: 26012.16,
    currency: "USD",
    change: 190.61,
    changePercent: 0.74,
    shortName: "NASDAQ 100 Index",
  },
  {
    label: "NKY",
    price: 51092.28,
    currency: "JPY",
    change: 873.1,
    changePercent: 1.74,
    shortName: "Nikkei 225",
  },
];

const yahooQuoteUrl = (tickers) => {
  const params = new URLSearchParams({ symbols: tickers });
  return `https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`;
};

const toQuote = (symbol, result) => {
  if (!result) return null;
  return {
    label: symbol.label,
    price: result.regularMarketPrice ?? null,
    currency: result.currency ?? "USD",
    change: result.regularMarketChange ?? null,
    changePercent: result.regularMarketChangePercent ?? null,
    timestamp: result.regularMarketTime ? result.regularMarketTime * 1000 : null,
    shortName: result.shortName ?? symbol.label,
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
    const changePercent = basePrice
      ? (change / basePrice) * 100
      : item.changePercent ?? 0;

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

export default async function handler(req, res) {
  try {
    const tickers = SYMBOLS.map((item) => item.ticker).join(",");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    let response;
    try {
      response = await fetch(yahooQuoteUrl(tickers), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response) {
      throw new Error("Yahoo Finance request did not complete");
    }

    if (!response.ok) {
      throw new Error(`Yahoo Finance request failed with ${response.status}`);
    }

    const json = await response.json();
    const results = json?.quoteResponse?.result ?? [];

    const mapped = SYMBOLS.map((symbol) => {
      const match = results.find((item) => item.symbol === symbol.ticker);
      return toQuote(symbol, match);
    }).filter(Boolean);

    if (!mapped.length) {
      throw new Error("Yahoo Finance returned no data");
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    res.status(200).json({
      data: mapped,
      meta: {
        source: "live",
        updatedAt: Date.now(),
      },
      fallback: false,
    });
  } catch (error) {
    console.error("Market data error", error);
    const payload = simulateFromBaseline(error);
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate");
    res.status(200).json(payload);
  }
}
