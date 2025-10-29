export default async function handler(req, res) {
  const { base = "USD", target = "EUR", amount = "1" } = req.query;

  try {
    const response = await fetch(
      `https://api.exchangerate.host/latest?base=${encodeURIComponent(
        base
      )}&symbols=${encodeURIComponent(target)}`
    );

    if (!response.ok) {
      throw new Error(`ExchangeRate request failed with ${response.status}`);
    }

    const json = await response.json();
    const rate = json?.rates?.[target.toUpperCase()] ?? null;
    const timestamp = json?.date ? new Date(json.date).getTime() : Date.now();

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    res.status(200).json({
      amount: Number(amount),
      base: base.toUpperCase(),
      target: target.toUpperCase(),
      rate,
      timestamp,
    });
  } catch (error) {
    console.error("Currency API error", error);
    res.status(200).json({
      amount: Number(amount),
      base: base.toUpperCase(),
      target: target.toUpperCase(),
      rate: 0.8589,
      timestamp: Date.now() - 60 * 60 * 1000,
      fallback: true,
    });
  }
}
