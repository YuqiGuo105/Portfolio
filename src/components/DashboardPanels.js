"use client";

import { useEffect, useMemo, useState } from "react";

const formatCurrency = (value, currency) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" ? 0 : 2,
    }).format(value);
  } catch (error) {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
};

const getHoursSince = (timestamp) => {
  if (!timestamp) return null;
  const diffMs = Date.now() - timestamp;
  const hours = diffMs / (1000 * 60 * 60);
  return Math.max(hours, 0);
};

// Debounce hook to reduce request spam & perceived latency.
const useDebouncedValue = (value, delayMs) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
};

const weatherIcon = (
  <svg
    width="42"
    height="42"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle
      cx="16"
      cy="16"
      r="8"
      stroke="var(--accent-color)"
      strokeWidth="2.5"
      fill="none"
    />
    <path
      d="M12 32h16a8 8 0 1 0-1.7-15.8"
      stroke="var(--accent-color)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path
      d="M8 32h16a6 6 0 1 1-0.2 12H10a6 6 0 1 1 2-11.6"
      stroke="var(--accent-color)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

const DashboardPanels = () => {
  const [marketData, setMarketData] = useState([]);
  const [marketFallback, setMarketFallback] = useState(false);
  const [marketMeta, setMarketMeta] = useState(null);
  const [isMarketLoading, setIsMarketLoading] = useState(true);

  const [currency, setCurrency] = useState({
    amount: 1,
    base: "USD",
    target: "EUR",
    rate: 0.8589,
    timestamp: Date.now(),
    fallback: true,
    meta: { source: "init" },
  });
  const [isCurrencyLoading, setIsCurrencyLoading] = useState(true);

  const [amount, setAmount] = useState("1");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [targetCurrency, setTargetCurrency] = useState("EUR");

  const debouncedAmount = useDebouncedValue(amount, 300);
  const debouncedBase = useDebouncedValue(baseCurrency, 150);
  const debouncedTarget = useDebouncedValue(targetCurrency, 150);

  const [weather, setWeather] = useState({
    temperature: 49,
    weatherDescription: "Partly cloudy",
    sunrise: null,
    sunset: null,
    location: null,
    fetchedAt: Date.now(),
    fallback: true,
    meta: { provider: "init" },
  });
  const [isWeatherLoading, setIsWeatherLoading] = useState(true);

  // Market (with abort + timeout)
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const fetchMarket = async () => {
      setIsMarketLoading(true);
      try {
        const response = await fetch("/api/market-data", { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();

        if (!mounted) return;

        if (json?.data) setMarketData(json.data);
        setMarketFallback(Boolean(json?.fallback));
        setMarketMeta(json?.meta ?? null);
      } catch (error) {
        // Keep previous data (better UX) instead of blanking out.
        console.error("Failed to load market data", error);
      } finally {
        if (mounted) setIsMarketLoading(false);
      }
    };

    fetchMarket();

    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  // Currency (debounced + abort previous request)
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const fetchCurrency = async () => {
      setIsCurrencyLoading(true);
      try {
        const params = new URLSearchParams({
          base: debouncedBase,
          target: debouncedTarget,
          amount: (debouncedAmount || "1").toString(),
        });

        const response = await fetch(`/api/currency?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();

        if (!mounted) return;

        if (json?.rate) setCurrency(json);
      } catch (error) {
        console.error("Failed to load currency data", error);
      } finally {
        if (mounted) setIsCurrencyLoading(false);
      }
    };

    fetchCurrency();

    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [debouncedBase, debouncedTarget, debouncedAmount]);

  // Weather (abort + timeout)
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const fetchWeather = async () => {
      setIsWeatherLoading(true);
      try {
        const response = await fetch("/api/weather", { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();

        if (!mounted) return;

        if (json) setWeather(json);
      } catch (error) {
        console.error("Failed to load weather data", error);
      } finally {
        if (mounted) setIsWeatherLoading(false);
      }
    };

    fetchWeather();

    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const convertedAmount = useMemo(() => {
    const amt = Number.parseFloat(amount);
    if (Number.isNaN(amt) || !currency?.rate) return null;
    return amt * currency.rate;
  }, [amount, currency]);

  const [temperatureUnit, setTemperatureUnit] = useState("C");

  const toggleTemperatureUnit = () => {
    setTemperatureUnit((current) => (current === "F" ? "C" : "F"));
  };

  const displayTemperature = useMemo(() => {
    if (
      isWeatherLoading ||
      weather.temperature === null ||
      weather.temperature === undefined
    ) {
      return "--";
    }

    // API returns Fahrenheit (we requested temperature_unit=fahrenheit)
    if (temperatureUnit === "C") {
      const celsius = ((weather.temperature - 32) * 5) / 9;
      return `${Math.round(celsius)}°C`;
    }

    return `${Math.round(weather.temperature)}°F`;
  }, [isWeatherLoading, weather.temperature, temperatureUnit]);

  const { marketBadgeText, marketBadgeClassName } = useMemo(() => {
    if (isMarketLoading) {
      return { marketBadgeText: "loading…", marketBadgeClassName: "badge badge-warning" };
    }

    if (marketMeta?.source && marketMeta.source !== "stooq") {
      const text =
        marketMeta.source === "simulated"
          ? "live feed unavailable · showing simulated snapshot"
          : `cached snapshot · source: ${marketMeta.source}`;
      return { marketBadgeText: text, marketBadgeClassName: "badge badge-warning" };
    }

    if (marketFallback) {
      return { marketBadgeText: "partial / fallback data", marketBadgeClassName: "badge" };
    }

    // For stooq, you may want to display "delayed" explicitly.
    if (marketMeta?.source === "stooq") {
      const partial = marketMeta?.partial?.length ? ` · partial: ${marketMeta.partial.join(", ")}` : "";
      return { marketBadgeText: `delayed quotes (stooq)${partial}`, marketBadgeClassName: "badge" };
    }

    return { marketBadgeText: null, marketBadgeClassName: "badge" };
  }, [isMarketLoading, marketFallback, marketMeta]);

  const hoursAgoLabel = (timestamp) => {
    const hours = getHoursSince(timestamp);
    if (hours === null) return "Updated just now";
    if (hours < 1) {
      const minutes = Math.max(Math.round(hours * 60), 1);
      return `Updated > ${minutes} min ago`;
    }
    return `Updated > ${Math.round(hours)} hr ago`;
  };

  const formatTime = (value) => {
    if (!value) return "—";
    const date = typeof value === "number" ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  return (
    <section className="dashboard-wrapper" id="market-weather-dashboard">
      <div className="dashboard-container">
        <div className="dashboard-card-1 market-card">
          <header>
            <h3>Market Data</h3>
            {marketBadgeText && (
              <span className={marketBadgeClassName}>{marketBadgeText}</span>
            )}
          </header>

          <div className="market-rows">
            {marketData.map((item) => {
              const changeValue =
                typeof item.change === "number" && !Number.isNaN(item.change)
                  ? item.change
                  : null;
              const changePercent =
                typeof item.changePercent === "number" &&
                !Number.isNaN(item.changePercent)
                  ? item.changePercent
                  : null;
              const changeSign = changeValue !== null ? (changeValue >= 0 ? "+" : "") : "";
              const changeColor =
                changeValue === null ? "neutral" : changeValue >= 0 ? "positive" : "negative";

              return (
                <div className="market-row" key={item.label}>
                  <div className="row-main">
                    <span className="symbol">{item.label}</span>
                    <span className="price">{formatCurrency(item.price, item.currency)}</span>
                    <span className="currency">{item.currency}</span>
                    <span className={`change ${changeColor}`}>
                      {changeValue !== null ? `${changeSign}${changeValue.toFixed(2)}` : "—"}
                      {", "}
                      <span className="percent">
                        {changePercent !== null ? `${changeSign}${changePercent.toFixed(2)}%` : "—"}
                      </span>
                    </span>
                  </div>
                  <div className="row-sub">
                    <span className="timestamp">{hoursAgoLabel(item.timestamp)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="column-container">
          <div className="dashboard-card-2 currency-card">
            <header>
              <h3>Currency Converter</h3>
            </header>

            <div className="output-container">
              <div className="conversion-output">
                {convertedAmount !== null ? (
                  <span>
                    {amount || 1} {baseCurrency} ≈ {convertedAmount.toFixed(4)} {targetCurrency}
                  </span>
                ) : (
                  <span>Enter an amount to convert</span>
                )}
              </div>

              <div className="converter-form">
                <label className="input-group">
                  <span>Amount</span>
                  <input
                    type="number"
                    min="0"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>

                <label className="input-group">
                  <span>From</span>
                  <select
                    value={baseCurrency}
                    onChange={(event) => setBaseCurrency(event.target.value)}
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                    <option value="CNY">CNY</option>
                  </select>
                </label>

                <label className="input-group">
                  <span>To</span>
                  <select
                    value={targetCurrency}
                    onChange={(event) => setTargetCurrency(event.target.value)}
                  >
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                    <option value="CNY">CNY</option>
                  </select>
                </label>
              </div>

              <div className="currency-rate">
                <span className="timestamp">
                  {isCurrencyLoading ? "Updating…" : hoursAgoLabel(currency.timestamp)}
                </span>
              </div>

              <p className="disclaimer">
                Rates powered by ExchangeRate-API (open access). Market quotes powered by Stooq (may be delayed).
              </p>
            </div>
          </div>

          <div className="dashboard-card-3 weather-card">
            <header>
              <h3>Weather</h3>
            </header>

            <div className="weather-container">
              <div className="weather-main">
                <div className="icon-wrapper" aria-hidden="true">
                  {weatherIcon}
                </div>

                <div className="weather-info">
                  <div className="temperature-row">
                    <div className="temperature">{displayTemperature}</div>
                    <button
                      type="button"
                      className="unit-toggle"
                      onClick={toggleTemperatureUnit}
                      aria-label={`Switch to ${temperatureUnit === "F" ? "Celsius" : "Fahrenheit"}`}
                    >
                      Show °{temperatureUnit === "F" ? "C" : "F"}
                    </button>
                  </div>

                  <div className="description">Outlook: {weather.weatherDescription}</div>

                  {weather.location && (
                    <div className="location">
                      {weather.location.city ? `${weather.location.city}, ` : ""}
                      {weather.location.region || weather.location.country}
                    </div>
                  )}

                  <div className="sun-times">
                    <span>Sunrise: {formatTime(weather.sunrise)}</span>
                    <span>Sunset: {formatTime(weather.sunset)}</span>
                    <span className="timestamp">{hoursAgoLabel(weather.fetchedAt)}</span>
                  </div>
                </div>
              </div>

              <footer>
                <span className="provider">Powered by Open-Meteo</span>
              </footer>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .dashboard-wrapper {
          --dashboard-bg: #f8f8fb;
          --card-bg: #e6ebee;
          --card-border: rgba(15, 23, 42, 0.06);
          --card-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
          --heading-color: white;
          --text-primary: #1f2937;
          --text-secondary: #374151;
          --text-muted: #6b7280;
          --text-subtle: #9ca3af;
          --badge-text: #ef4444;
          --badge-bg: rgba(239, 68, 68, 0.12);
          --badge-warning-text: #b45309;
          --badge-warning-bg: rgba(251, 191, 36, 0.18);
          --positive: #16a34a;
          --negative: #dc2626;
          --neutral: #6b7280;
          --input-bg: #ffffff;
          --input-border: rgba(148, 163, 184, 0.6);
          --input-text: #111827;
          --conversion-text: #1f2937;
          --weather-accent: #f97316;
          --weather-accent-bg: rgba(249, 115, 22, 0.08);
          --unit-toggle-bg: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          --unit-toggle-hover-bg: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
          --provider-indicator: #f97316;
          background: var(--dashboard-bg);
          padding: 3rem 0;
          font-family: "Inter", "Segoe UI", "Roboto", sans-serif;
        }

        :global(body.dark-skin) #market-weather-dashboard {
          --dashboard-bg: #0b1120;
          --card-bg: #111827;
          --card-border: rgba(148, 163, 184, 0.12);
          --card-shadow: 0 24px 40px rgba(15, 23, 42, 0.45);
          --heading-color: #e2e8f0;
          --text-primary: #e2e8f0;
          --text-secondary: #cbd5f5;
          --text-muted: #94a3b8;
          --text-subtle: #64748b;
          --badge-text: #fca5a5;
          --badge-bg: rgba(239, 68, 68, 0.25);
          --badge-warning-text: #fbbf24;
          --badge-warning-bg: rgba(251, 191, 36, 0.22);
          --positive: #22c55e;
          --negative: #f87171;
          --neutral: #94a3b8;
          --input-bg: rgba(15, 23, 42, 0.8);
          --input-border: rgba(148, 163, 184, 0.35);
          --input-text: #f8fafc;
          --conversion-text: #f1f5f9;
          --weather-accent: #f97316;
          --weather-accent-bg: rgba(249, 115, 22, 0.18);
          --unit-toggle-bg: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
          --unit-toggle-hover-bg: linear-gradient(135deg, #4338ca 0%, #312e81 100%);
          --provider-indicator: #f97316;
        }

        .dashboard-container {
          display: flex;
          justify-content: center;
          gap: 1.5rem;
          margin: 0 auto;
          padding: 0 1.5rem;
          flex-wrap: wrap;
          max-width: 1500px;
        }

        .dashboard-card-1 {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: 18px;
          padding: 20px;
          box-shadow: var(--card-shadow);
          display: flex;
          width: 400px;
          max-width: 100%;
          flex-direction: column;
          gap: 1.25rem;
          color: var(--text-primary);
        }

        .dashboard-card-1 header {
          display: flex;
          height: 150px;
          border-radius: 30px;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          background: radial-gradient(
              ellipse 120% 150% at 20% 135%,
              #3564c2 0%,
              #3564c2 22%,
              rgba(53, 100, 194, 0.4) 45%,
              rgba(53, 100, 194, 0) 75%
            ),
            #353636;
        }

        .dashboard-card-1 h3 {
          font-size: 1.35rem;
          font-weight: 600;
          margin: 0;
          color: var(--heading-color);
        }

        .column-container {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .dashboard-card-2 {
          background: var(--card-bg);
          width: 800px;
          max-width: 100%;
          height: 300px;
          border: 1px solid var(--card-border);
          border-radius: 18px;
          padding: 20px;
          box-shadow: var(--card-shadow);
          display: flex;
          color: var(--text-primary);
          gap: 15px;
        }

        .dashboard-card-2 header {
          display: flex;
          width: 550px;
          max-width: 100%;
          border-radius: 30px;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          background: radial-gradient(
              ellipse 120% 150% at 20% 135%,
              #3564c2 0%,
              #3564c2 22%,
              rgba(53, 100, 194, 0.4) 45%,
              rgba(53, 100, 194, 0) 75%
            ),
            #353636;
        }

        .dashboard-card-2 h3 {
          font-size: 1.35rem;
          font-weight: 600;
          margin: 0;
          color: var(--heading-color);
        }

        .output-container {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .dashboard-card-3 {
          width: 800px;
          max-width: 100%;
          height: 300px;
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: 18px;
          padding: 20px;
          box-shadow: var(--card-shadow);
          display: flex;
          justify-content: space-between;
          color: var(--text-primary);
        }

        .dashboard-card-3 header {
          display: flex;
          width: 303px;
          max-width: 100%;
          border-radius: 30px;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          background: radial-gradient(
              ellipse 120% 150% at 20% 135%,
              #3564c2 0%,
              #3564c2 22%,
              rgba(53, 100, 194, 0.4) 45%,
              rgba(53, 100, 194, 0) 75%
            ),
            #353636;
        }

        .dashboard-card-3 h3 {
          font-size: 1.35rem;
          font-weight: 600;
          margin: 0;
          color: var(--heading-color);
        }

        .badge {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--badge-text);
          background: var(--badge-bg);
          padding: 0.35rem 0.5rem;
          border-radius: 999px;
          font-weight: 600;
        }

        .badge.badge-warning {
          color: var(--badge-warning-text);
          background: var(--badge-warning-bg);
        }

        .market-rows {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .market-row {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .row-main {
          display: grid;
          grid-template-columns: 40px 100px 40px minmax(0, 1fr);
          gap: 0.75rem;
          align-items: baseline;
          color: var(--text-primary);
          font-size: 0.95rem;
        }

        .symbol {
          font-weight: 600;
          letter-spacing: 0.04em;
        }

        .price {
          justify-self: start;
          text-align: left;
          font-variant-numeric: tabular-nums;
        }

        .currency {
          color: var(--text-muted);
          font-size: 0.85rem;
        }

        .change {
          justify-self: end;
          font-weight: 600;
          font-size: 0.85rem;
        }

        .change .percent {
          color: var(--positive);
        }

        .change.negative {
          color: var(--negative);
        }

        .change.positive {
          color: var(--positive);
        }

        .change.neutral {
          color: var(--neutral);
        }

        .row-sub {
          font-size: 0.75rem;
          color: var(--text-muted);
          letter-spacing: 0.04em;
        }

        .currency-card .currency-rate {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .currency-card .timestamp,
        .disclaimer {
          font-size: 0.75rem;
          color: var(--text-muted);
          letter-spacing: 0.03em;
        }

        .converter-form {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.75rem;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          font-size: 0.8rem;
          color: var(--text-secondary);
        }

        input,
        select {
          height: 40px;
          border: 1px solid var(--input-border);
          border-radius: 10px;
          padding: 0rem 0.75rem;
          font-size: 0.95rem;
          background: var(--input-bg);
          color: var(--input-text);
          font-family: inherit;
        }

        .converter-form .input-group input,
        .converter-form .input-group select {
          width: 100%;
        }

        input:focus,
        select:focus {
          outline: none;
          border-color: #4f46e5;
          box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.15);
        }

        .conversion-output {
          font-size: 30px;
          font-weight: 500;
          color: var(--conversion-text);
        }

        .disclaimer {
          margin: 0;
          margin-top: 50px;
          line-height: 1.4;
        }

        .weather-card {
          position: relative;
        }

        .weather-container {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .weather-main {
          display: flex;
          justify-content: center;
          width: 400px;
          max-width: 100%;
          gap: 1.25rem;
          align-items: center;
        }

        .icon-wrapper {
          --accent-color: var(--weather-accent);
          display: grid;
          place-items: center;
          background: var(--weather-accent-bg);
          border-radius: 14px;
          padding: 0.75rem;
        }

        .weather-info {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .temperature {
          font-size: 2.25rem;
          font-weight: 600;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }

        .temperature-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .unit-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: var(--unit-toggle-bg);
          color: #ffffff;
          border-radius: 8px;
          padding: 0.4rem 0.75rem;
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 4px rgba(79, 70, 229, 0.2);
          white-space: nowrap;
        }

        .unit-toggle:hover {
          background: var(--unit-toggle-hover-bg);
          box-shadow: 0 4px 8px rgba(79, 70, 229, 0.3);
          transform: translateY(-1px);
        }

        .unit-toggle:active {
          transform: translateY(0);
          box-shadow: 0 1px 2px rgba(79, 70, 229, 0.3);
        }

        .unit-toggle:focus {
          outline: none;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.4), 0 2px 4px rgba(79, 70, 229, 0.2);
        }

        .description {
          font-size: 0.95rem;
          color: var(--text-secondary);
        }

        .location {
          font-size: 0.85rem;
          color: var(--text-muted);
        }

        .sun-times {
          display: flex;
          flex-direction: column;
          font-size: 0.78rem;
          color: var(--text-muted);
          letter-spacing: 0.04em;
        }

        .weather-card footer {
          margin-top: auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--text-subtle);
        }

        .provider {
          display: inline-flex;
          width: 400px;
          max-width: 100%;
          justify-content: center;
          align-items: center;
          gap: 0.35rem;
        }

        .provider::before {
          content: "";
          display: inline-block;
          width: 14px;
          height: 14px;
          border-radius: 4px;
          border: 1.5px solid var(--provider-indicator);
        }

        @media (max-width: 1024px) {
          .dashboard-wrapper {
            padding: 2rem 0;
          }

          .dashboard-container {
            justify-content: center;
            padding: 0 1rem;
          }

          .dashboard-card-1,
          .dashboard-card-2,
          .dashboard-card-3,
          .column-container {
            width: 100%;
            max-width: 100%;
          }

          .weather-main,
          .provider {
            width: 100%;
            max-width: 100%;
          }

          .dashboard-card-2 header,
          .dashboard-card-3 header {
            width: 100%;
            max-width: 100%;
          }
        }

        @media (max-width: 768px) {
          .dashboard-wrapper {
            padding: 1.5rem 0;
          }

          .dashboard-container {
            flex-direction: column;
            align-items: stretch;
            gap: 1rem;
          }

          .dashboard-card-1,
          .dashboard-card-2,
          .dashboard-card-3 {
            width: 100%;
            max-width: 100%;
          }

          .dashboard-card-2,
          .dashboard-card-3 {
            flex-direction: column;
            align-items: stretch;
            height: auto;
          }

          .dashboard-card-1 header {
            height: 100px;
          }

          .dashboard-card-2 header,
          .dashboard-card-3 header {
            width: 100%;
            height: 100px;
            max-width: 100%;
            margin-bottom: 0.75rem;
          }

          .conversion-output {
            font-size: 1.4rem;
          }

          .sun-times {
            flex-direction: row;
            gap: 0.75rem;
            flex-wrap: wrap;
          }

          .row-main {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            grid-template-areas:
              "symbol price"
              "currency change";
          }

          .symbol {
            grid-area: symbol;
          }

          .price {
            grid-area: price;
            justify-self: end;
          }

          .currency {
            grid-area: currency;
          }

          .change {
            grid-area: change;
            justify-self: end;
          }
        }
      `}</style>
    </section>
  );
};

export default DashboardPanels;
