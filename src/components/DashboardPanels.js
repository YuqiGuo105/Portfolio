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
    return `${value.toFixed(2)} ${currency}`;
  }
};

const getHoursSince = (timestamp) => {
  if (!timestamp) return null;
  const diffMs = Date.now() - timestamp;
  const hours = diffMs / (1000 * 60 * 60);
  return Math.max(hours, 0);
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
  const [currency, setCurrency] = useState({
    amount: 1,
    base: "USD",
    target: "EUR",
    rate: 0.8589,
    timestamp: Date.now(),
    fallback: true,
  });
  const [amount, setAmount] = useState("1");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [targetCurrency, setTargetCurrency] = useState("EUR");
  const [weather, setWeather] = useState({
    temperature: 49,
    weatherDescription: "Partly cloudy",
    sunrise: null,
    sunset: null,
    location: null,
    fetchedAt: Date.now(),
    fallback: true,
  });
  const [isWeatherLoading, setIsWeatherLoading] = useState(true);

  useEffect(() => {
    const fetchMarket = async () => {
      try {
        const response = await fetch("/api/market-data");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (json?.data) {
          setMarketData(json.data);
        }
        setMarketFallback(Boolean(json?.fallback));
        setMarketMeta(json?.meta ?? null);
      } catch (error) {
        console.error("Failed to load market data", error);
      }
    };

    fetchMarket();
  }, []);

  useEffect(() => {
    const fetchCurrency = async () => {
      try {
        const params = new URLSearchParams({
          base: baseCurrency,
          target: targetCurrency,
          amount: amount || "1",
        });
        const response = await fetch(`/api/currency?${params.toString()}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (json?.rate) {
          setCurrency(json);
        }
      } catch (error) {
        console.error("Failed to load currency data", error);
      }
    };

    fetchCurrency();
  }, [baseCurrency, targetCurrency, amount]);

  useEffect(() => {
    const fetchWeather = async () => {
      setIsWeatherLoading(true);
      try {
        const response = await fetch("/api/weather");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (json) {
          setWeather(json);
        }
      } catch (error) {
        console.error("Failed to load weather data", error);
      } finally {
        setIsWeatherLoading(false);
      }
    };

    fetchWeather();
  }, []);

  const convertedAmount = useMemo(() => {
    const amt = parseFloat(amount);
    if (Number.isNaN(amt) || !currency?.rate) return null;
    return amt * currency.rate;
  }, [amount, currency]);

  const [temperatureUnit, setTemperatureUnit] = useState("F");

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

    if (temperatureUnit === "C") {
      const celsius = ((weather.temperature - 32) * 5) / 9;
      return `${Math.round(celsius)}°C`;
    }

    return `${Math.round(weather.temperature)}°F`;
  }, [isWeatherLoading, weather.temperature, temperatureUnit]);

  const { marketBadgeText, marketBadgeClassName } = useMemo(() => {
    if (marketMeta?.source && marketMeta.source !== "live") {
      const text =
        marketMeta.source === "simulated"
          ? "live feed unavailable · showing simulated snapshot"
          : `cached snapshot · source: ${marketMeta.source}`;

      return { text, className: "badge badge-warning" };
    }

    if (marketFallback) {
      return { text: "live feed unavailable · showing sample", className: "badge" };
    }

    return { text: null, className: "badge" };
  }, [marketFallback, marketMeta]);

  const hoursAgoLabel = (timestamp) => {
    const hours = getHoursSince(timestamp);
    if (hours === null) return "Updated just now";
    if (hours < 1) {
      const minutes = Math.max(Math.round(hours * 60), 1);
      return `as of > ${minutes} min ago`;
    }
    return `as of > ${Math.round(hours)} hr ago`;
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
        <div className="dashboard-card market-card">
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
              const changeSign =
                changeValue !== null ? (changeValue >= 0 ? "+" : "") : "";
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
                        {changePercent !== null
                          ? `${changeSign}${changePercent.toFixed(2)}%`
                          : "—"}
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

        <div className="dashboard-card currency-card">
          <header>
            <h3>Currency Converter</h3>
          </header>
          <div className="currency-rate">
            <span className="rate">
              1 {currency.base} equals {currency.rate?.toFixed(4) ?? "—"} {currency.target}
            </span>
            <span className="timestamp">{hoursAgoLabel(currency.timestamp)}</span>
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
          <div className="conversion-output">
            {convertedAmount !== null ? (
              <span>
                {amount || 1} {baseCurrency} ≈ {convertedAmount.toFixed(4)} {targetCurrency}
              </span>
            ) : (
              <span>Enter an amount to convert</span>
            )}
          </div>
          <p className="disclaimer">
            Data provided by IHS Markit and other public market data sources. Rates are for
            informational purposes only.
          </p>
        </div>

        <div className="dashboard-card weather-card">
          <header>
            <h3>Weather</h3>
          </header>
          <div className="weather-main">
            <div className="icon-wrapper" aria-hidden="true">
              {weatherIcon}
            </div>
            <div className="weather-info">
              <div className="temperature">{displayTemperature}</div>
              <button
                type="button"
                className="unit-toggle"
                onClick={toggleTemperatureUnit}
                aria-label={`Switch to ${temperatureUnit === "F" ? "Celsius" : "Fahrenheit"}`}
              >
                Show °{temperatureUnit === "F" ? "C" : "F"}
              </button>
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
              </div>
            </div>
          </div>
          <footer>
            <span className="provider">Powered by AccuWeather</span>
            <span className="timestamp">{hoursAgoLabel(weather.fetchedAt)}</span>
          </footer>
        </div>
      </div>

      <style jsx>{`
        .dashboard-wrapper {
          background: #f8f8fb;
          padding: 3rem 0;
          font-family: "Inter", "Segoe UI", "Roboto", sans-serif;
        }

        .dashboard-container {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1.5rem;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 1.5rem;
        }

        .dashboard-card {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 18px;
          padding: 1.75rem;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .dashboard-card header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .dashboard-card h3 {
          font-size: 1.35rem;
          font-weight: 600;
          margin: 0;
          color: #1a1c2d;
        }

        .badge {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #ef4444;
          background: rgba(239, 68, 68, 0.12);
          padding: 0.35rem 0.5rem;
          border-radius: 999px;
          font-weight: 600;
        }

        .badge.badge-warning {
          color: #b45309;
          background: rgba(251, 191, 36, 0.18);
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
          grid-template-columns: 1fr auto auto auto;
          gap: 0.75rem;
          align-items: baseline;
          color: #111827;
          font-size: 0.95rem;
        }

        .symbol {
          font-weight: 600;
          letter-spacing: 0.04em;
        }

        .price {
          justify-self: end;
          font-variant-numeric: tabular-nums;
        }

        .currency {
          color: #6b7280;
          font-size: 0.85rem;
        }

        .change {
          justify-self: end;
          font-weight: 600;
          font-size: 0.85rem;
        }

        .change .percent {
          color: #16a34a;
        }

        .change.negative {
          color: #dc2626;
        }

        .change.positive {
          color: #16a34a;
        }

        .change.neutral {
          color: #6b7280;
        }

        .row-sub {
          font-size: 0.75rem;
          color: #6b7280;
          letter-spacing: 0.04em;
        }

        .currency-card .currency-rate {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .currency-card .rate {
          font-size: 1.1rem;
          font-weight: 600;
          color: #111827;
        }

        .currency-card .timestamp,
        .disclaimer {
          font-size: 0.75rem;
          color: #6b7280;
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
          color: #374151;
        }

        input,
        select {
          border: 1px solid rgba(148, 163, 184, 0.6);
          border-radius: 10px;
          padding: 0.6rem 0.75rem;
          font-size: 0.95rem;
          background: #ffffff;
          color: #111827;
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
          font-size: 0.9rem;
          font-weight: 500;
          color: #1f2937;
        }

        .disclaimer {
          margin: 0;
          line-height: 1.4;
        }

        .weather-card {
          position: relative;
        }

        .weather-main {
          display: flex;
          gap: 1.25rem;
          align-items: center;
        }

        .icon-wrapper {
          --accent-color: #f97316;
          display: grid;
          place-items: center;
          background: rgba(249, 115, 22, 0.08);
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
          color: #111827;
          font-variant-numeric: tabular-nums;
        }

        .unit-toggle {
          align-self: flex-start;
          border: 1px solid rgba(99, 102, 241, 0.4);
          background: rgba(79, 70, 229, 0.08);
          color: #4338ca;
          border-radius: 999px;
          padding: 0.3rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease;
        }

        .unit-toggle:hover {
          background: rgba(79, 70, 229, 0.16);
          color: #312e81;
        }

        .unit-toggle:focus {
          outline: none;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.35);
        }

        .description {
          font-size: 0.95rem;
          color: #374151;
        }

        .location {
          font-size: 0.85rem;
          color: #6b7280;
        }

        .sun-times {
          display: flex;
          flex-direction: column;
          font-size: 0.78rem;
          color: #6b7280;
          letter-spacing: 0.04em;
        }

        .weather-card footer {
          margin-top: auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.75rem;
          color: #9ca3af;
        }

        .provider {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }

        .provider::before {
          content: "";
          display: inline-block;
          width: 14px;
          height: 14px;
          border-radius: 4px;
          border: 1.5px solid #f97316;
        }

        @media (max-width: 1024px) {
          .dashboard-container {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 768px) {
          .dashboard-container {
            grid-template-columns: 1fr;
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

          .converter-form {
            grid-template-columns: 1fr;
          }

          .sun-times {
            flex-direction: row;
            gap: 0.75rem;
          }
        }
      `}</style>
    </section>
  );
};

export default DashboardPanels;
