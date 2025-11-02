const FALLBACK_BASE_RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155.12,
  CNY: 7.23,
};

const computeFallbackRate = (base, target) => {
  const normalizedBase = base.toUpperCase();
  const normalizedTarget = target.toUpperCase();
  const baseRate = FALLBACK_BASE_RATES[normalizedBase];
  const targetRate = FALLBACK_BASE_RATES[normalizedTarget];

  if (!baseRate || !targetRate) {
    return null;
  }

  return targetRate / baseRate;
};

export default async function handler(req, res) {
  const { base = "USD", target = "EUR", amount = "1" } = req.query;
  const normalizedBase = base.toUpperCase();
  const normalizedTarget = target.toUpperCase();
  const numericAmount = Number.parseFloat(amount) || 0;

  try {
    const response = await fetch(
      `https://api.exchangerate.host/latest?base=${encodeURIComponent(
        normalizedBase
      )}&symbols=${encodeURIComponent(normalizedTarget)}`
    );

    if (!response.ok) {
      throw new Error(`ExchangeRate request failed with ${response.status}`);
    }

    const json = await response.json();
    const apiRate = json?.rates?.[normalizedTarget];
    const rate =
      typeof apiRate === "number" && Number.isFinite(apiRate)
        ? apiRate
        : computeFallbackRate(normalizedBase, normalizedTarget);
    const timestamp = json?.date ? new Date(json.date).getTime() : Date.now();

    if (rate === null) {
      throw new Error("Unable to determine exchange rate");
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    res.status(200).json({
      amount: numericAmount,
      base: normalizedBase,
      target: normalizedTarget,
      rate,
      timestamp,
      fallback: rate !== apiRate,
    });
  } catch (error) {
    console.error("Currency API error", error);
    const fallbackRate = computeFallbackRate(normalizedBase, normalizedTarget);

    res.status(200).json({
      amount: numericAmount,
      base: normalizedBase,
      target: normalizedTarget,
      rate: fallbackRate,
      timestamp: Date.now() - 60 * 60 * 1000,
      fallback: true,
    });
  }
}
