export default async function handler(req, res) {
  const symbols = [
    { label: "GS", ticker: "GS" },
    { label: "SPX", ticker: "^GSPC" },
    { label: "UKX", ticker: "^FTSE" },
    { label: "NDX", ticker: "^NDX" },
    { label: "NKY", ticker: "^N225" },
  ];

  try {
    const yahooSymbols = symbols.map((item) => item.ticker).join(",");
    const response = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
        yahooSymbols
      )}`
    );

    if (!response.ok) {
      throw new Error(`Yahoo Finance request failed with ${response.status}`);
    }

    const json = await response.json();
    const results = json?.quoteResponse?.result ?? [];

    const mapped = symbols.map((symbol) => {
      const match = results.find((item) => item.symbol === symbol.ticker);
      if (!match) {
        return null;
      }
      return {
        label: symbol.label,
        price: match.regularMarketPrice ?? null,
        currency: match.currency ?? "USD",
        change: match.regularMarketChange ?? null,
        changePercent: match.regularMarketChangePercent ?? null,
        timestamp: match.regularMarketTime ? match.regularMarketTime * 1000 : null,
        shortName: match.shortName ?? symbol.label,
      };
    }).filter(Boolean);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    res.status(200).json({ data: mapped });
  } catch (error) {
    console.error("Market data error", error);
    res.status(200).json({
      data: [
        {
          label: "GS",
          price: 792.09,
          currency: "USD",
          change: 2.1,
          changePercent: 0.27,
          timestamp: Date.now() - 2 * 60 * 60 * 1000,
          shortName: "Goldman Sachs Group, Inc.",
        },
        {
          label: "SPX",
          price: 6890.89,
          currency: "USD",
          change: 15.73,
          changePercent: 0.23,
          timestamp: Date.now() - 3 * 60 * 60 * 1000,
          shortName: "S&P 500 Index",
        },
        {
          label: "UKX",
          price: 9696.74,
          currency: "GBP",
          change: 42.92,
          changePercent: 0.44,
          timestamp: Date.now() - 4 * 60 * 60 * 1000,
          shortName: "FTSE 100 Index",
        },
        {
          label: "NDX",
          price: 26012.16,
          currency: "USD",
          change: 190.61,
          changePercent: 0.74,
          timestamp: Date.now() - 1.5 * 60 * 60 * 1000,
          shortName: "NASDAQ 100 Index",
        },
        {
          label: "NKY",
          price: 51092.28,
          currency: "JPY",
          change: 873.1,
          changePercent: 1.74,
          timestamp: Date.now() - 5 * 60 * 60 * 1000,
          shortName: "Nikkei 225",
        },
      ],
      fallback: true,
    });
  }
}
