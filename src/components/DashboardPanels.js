"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "../supabase/supabaseClient"

const getHoursSince = (timestamp) => {
  if (!timestamp) return null
  const ts = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime()
  if (!Number.isFinite(ts)) return null
  const diffMs = Date.now() - ts
  const hours = diffMs / (1000 * 60 * 60)
  return Math.max(hours, 0)
}

const weatherIcon = (
  <svg width="42" height="42" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="16" cy="16" r="8" stroke="var(--accent-color)" strokeWidth="2.5" fill="none" />
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
)

const DashboardPanels = () => {
  // ---- Visitor summary (from visitor_logs & visitor_clicks) ----
  const [visitorSummary, setVisitorSummary] = useState({
    totalVisits: null,
    totalClicks: null,
    topCountry: null,
    lastVisitAt: null,
    last30Days: [], // [{ date: "YYYY-MM-DD", visits: number }]
  })
  const [isVisitorLoading, setIsVisitorLoading] = useState(true)
  const [visitorError, setVisitorError] = useState(null)

  // Currency converter
  const [currency, setCurrency] = useState({
    amount: 1,
    base: "USD",
    target: "EUR",
    rate: 0.8589,
    timestamp: Date.now(),
    fallback: true,
  })
  const [amount, setAmount] = useState("1")
  const [baseCurrency, setBaseCurrency] = useState("USD")
  const [targetCurrency, setTargetCurrency] = useState("EUR")

  // Weather panel
  const [weather, setWeather] = useState({
    temperature: 49,
    weatherDescription: "Partly cloudy",
    sunrise: null,
    sunset: null,
    location: null,
    fetchedAt: Date.now(),
    fallback: true,
  })
  const [isWeatherLoading, setIsWeatherLoading] = useState(true)

  // ---- Fetch visitor summary (Supabase) ----
  useEffect(() => {
    const fetchVisitorSummary = async () => {
      setIsVisitorLoading(true)
      try {
        const now = new Date()
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(now.getDate() - 30)

        // 1) Last 30 days visits from visitor_logs
        const { data: logs, error: logsError } = await supabase
          .from("visitor_logs")
          .select("local_time, country")
          .gte("local_time", thirtyDaysAgo.toISOString())
          .order("local_time", { ascending: true })

        if (logsError) {
          throw logsError
        }

        const buckets = new Map() // dateStr -> count
        const countryCount = new Map()
        let lastVisitAt = null

        for (const log of logs || []) {
          const d = new Date(log.local_time)
          if (!Number.isNaN(d.getTime())) {
            const dateStr = d.toISOString().slice(0, 10) // YYYY-MM-DD
            buckets.set(dateStr, (buckets.get(dateStr) || 0) + 1)

            if (!lastVisitAt || d > lastVisitAt) {
              lastVisitAt = d
            }
          }

          if (log.country) {
            const c = log.country
            countryCount.set(c, (countryCount.get(c) || 0) + 1)
          }
        }

        const last30Days = Array.from(buckets.entries())
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([date, visits]) => ({ date, visits }))

        let topCountry = null
        let topCountryCount = 0
        countryCount.forEach((count, country) => {
          if (count > topCountryCount) {
            topCountryCount = count
            topCountry = country
          }
        })

        // 2) All-time total visits
        const { count: totalVisits, error: totalVisitsError } = await supabase
          .from("visitor_logs")
          .select("*", { count: "exact", head: true })

        if (totalVisitsError) {
          throw totalVisitsError
        }

        // 3) All-time total clicks
        const { count: totalClicks, error: totalClicksError } = await supabase
          .from("visitor_clicks")
          .select("*", { count: "exact", head: true })

        if (totalClicksError) {
          throw totalClicksError
        }

        setVisitorSummary({
          totalVisits: totalVisits ?? null,
          totalClicks: totalClicks ?? null,
          topCountry,
          lastVisitAt,
          last30Days,
        })
        setVisitorError(null)
      } catch (error) {
        console.error("Failed to load visitor summary from Supabase", error)
        setVisitorError("Unable to load visitor data")
      } finally {
        setIsVisitorLoading(false)
      }
    }

    fetchVisitorSummary()
  }, [])

  // ---- Currency ----
  useEffect(() => {
    const fetchCurrency = async () => {
      try {
        const params = new URLSearchParams({
          base: baseCurrency,
          target: targetCurrency,
          amount: amount || "1",
        })
        const response = await fetch(`/api/currency?${params.toString()}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const json = await response.json()
        if (json?.rate) {
          setCurrency(json)
        }
      } catch (error) {
        console.error("Failed to load currency data", error)
      }
    }

    fetchCurrency()
  }, [baseCurrency, targetCurrency, amount])

  // ---- Weather ----
  useEffect(() => {
    const fetchWeather = async () => {
      setIsWeatherLoading(true)
      try {
        const response = await fetch("/api/weather")
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const json = await response.json()
        if (json) {
          setWeather(json)
        }
      } catch (error) {
        console.error("Failed to load weather data", error)
      } finally {
        setIsWeatherLoading(false)
      }
    }

    fetchWeather()
  }, [])

  // ---- Derived values ----
  const convertedAmount = useMemo(() => {
    const amt = Number.parseFloat(amount)
    if (Number.isNaN(amt) || !currency?.rate) return null
    return amt * currency.rate
  }, [amount, currency])

  const [temperatureUnit, setTemperatureUnit] = useState("C")

  const toggleTemperatureUnit = () => {
    setTemperatureUnit((current) => (current === "F" ? "C" : "F"))
  }

  const displayTemperature = useMemo(() => {
    if (isWeatherLoading || weather.temperature === null || weather.temperature === undefined) {
      return "--"
    }

    if (temperatureUnit === "C") {
      const celsius = ((weather.temperature - 32) * 5) / 9
      return `${Math.round(celsius)}°C`
    }

    return `${Math.round(weather.temperature)}°F`
  }, [isWeatherLoading, weather.temperature, temperatureUnit])

  const hoursAgoLabel = (timestamp) => {
    const hours = getHoursSince(timestamp)
    if (hours === null) return "Updated just now"
    if (hours < 1) {
      const minutes = Math.max(Math.round(hours * 60), 1)
      return `Updated > ${minutes} min ago`
    }
    return `Updated > ${Math.round(hours)} hr ago`
  }

  const formatTime = (value) => {
    if (!value) return "—"
    const date = typeof value === "number" ? new Date(value) : new Date(value)
    if (Number.isNaN(date.getTime())) return "—"
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  }

  // ---- Last 30 days chart data (柱状图) ----
  const last30Total = useMemo(() => {
    if (!Array.isArray(visitorSummary.last30Days)) return null
    return visitorSummary.last30Days.reduce((sum, p) => sum + (p.visits || 0), 0)
  }, [visitorSummary.last30Days])

  const chartPoints = useMemo(() => {
    const pts = Array.isArray(visitorSummary.last30Days) ? visitorSummary.last30Days : []
    if (!pts.length) return []

    const max = Math.max(...pts.map((p) => p.visits || 0))
    if (max <= 0) return []

    return pts.map((p) => {
      const label = p.date ? p.date.slice(5) : "" // MM-DD
      const value = p.visits || 0
      return {
        label,
        value,
        height: (value / max) * 100,
      }
    })
  }, [visitorSummary.last30Days])

  return (
    <section className="dashboard-wrapper" id="market-weather-dashboard">
      <div className="dashboard-container">
        {/* Visitor summary */}
        <div className="dashboard-card market-card">
          <header>
            <h3>Visitor Summary</h3>
          </header>

          {isVisitorLoading ? (
            <p className="row-sub">Loading visitor data…</p>
          ) : visitorError ? (
            <p className="row-sub">{visitorError}</p>
          ) : (
            <>
              <div className="market-rows">
                <div className="market-row">
                  <div className="row-main">
                    <span className="symbol">Total visits (all time)</span>
                    <span className="price">{visitorSummary.totalVisits ?? "—"}</span>
                  </div>
                </div>

                <div className="market-row">
                  <div className="row-main">
                    <span className="symbol">Last 30 days visits</span>
                    <span className="price">{last30Total ?? "—"}</span>
                  </div>
                  <div className="visitor-chart">
                    {chartPoints.length === 0 ? (
                      <span className="chart-empty">No data for the last 30 days</span>
                    ) : (
                      <div className="chart-bars" aria-hidden="true">
                        {chartPoints.map((p, index) => (
                          <div key={p.label || index} className="chart-bar-wrapper">
                            <div className="chart-bar" style={{ height: `${p.height || 0}%` }} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="market-row">
                  <div className="row-main">
                    <span className="symbol">Total clicks</span>
                    <span className="price">{visitorSummary.totalClicks ?? "—"}</span>
                  </div>
                </div>

                <div className="market-row">
                  <div className="row-main">
                    <span className="symbol">Top location</span>
                    <span className="price">{visitorSummary.topCountry || "—"}</span>
                  </div>
                </div>
              </div>

              <div className="row-sub">
                <span className="timestamp">
                  {visitorSummary.lastVisitAt
                    ? `Last visit: ${hoursAgoLabel(visitorSummary.lastVisitAt)}`
                    : "No visits yet"}
                </span>
                {" · "}
                <Link href="/visitors/page" className="timestamp">
                  Read more
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Currency converter */}
        <div className="dashboard-card currency-card">
          <header>
            <h3>Currency Converter</h3>
          </header>
          <div className="currency-rate">
            <span className="timestamp">{hoursAgoLabel(currency.timestamp)}</span>
          </div>
          <div className="converter-form">
            <label className="input-group">
              <span>Amount</span>
              <input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            <label className="input-group">
              <span>From</span>
              <select value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value)}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="JPY">JPY</option>
                <option value="CNY">CNY</option>
              </select>
            </label>
            <label className="input-group">
              <span>To</span>
              <select value={targetCurrency} onChange={(event) => setTargetCurrency(event.target.value)}>
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
            Data provided by IHS Markit and other public market data sources. Rates are for informational purposes only.
          </p>
        </div>

        {/* Weather panel */}
        <div className="dashboard-card weather-card">
          <header>
            <h3>Weather</h3>
          </header>
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
          --dashboard-bg: #f8f8fb;
          --card-bg: #ffffff;
          --card-border: rgba(15, 23, 42, 0.06);
          --card-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
          --heading-color: #1a1c2d;
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
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1.5rem;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 1.5rem;
        }

        .dashboard-card {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: 18px;
          padding: 1.75rem;
          box-shadow: var(--card-shadow);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          color: var(--text-primary);
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
          color: var(--heading-color);
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
          grid-template-columns: 1fr auto;
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
          justify-self: end;
          font-variant-numeric: tabular-nums;
        }

        .row-sub {
          font-size: 0.75rem;
          color: var(--text-muted);
          letter-spacing: 0.04em;
        }

        .timestamp a,
        a.timestamp {
          text-decoration: none;
        }

        .timestamp a:hover,
        a.timestamp:hover {
          text-decoration: underline;
        }

        /* Visitor chart (柱状图) */
        .visitor-chart {
          margin-top: 0.35rem;
        }

        .chart-bars {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 52px;
        }

        .chart-bar-wrapper {
          flex: 1;
          min-width: 2px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.25);
          overflow: hidden;
        }

        .chart-bar {
          width: 100%;
          background: linear-gradient(180deg, #4f46e5, #6366f1);
          border-radius: 999px 999px 0 0;
          transition: height 0.25s ease-out;
        }

        :global(body.dark-skin) #market-weather-dashboard .chart-bar {
          background: linear-gradient(180deg, #6366f1, #4f46e5);
        }

        .chart-empty {
          font-size: 0.75rem;
          color: var(--text-muted);
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
          border: 1px solid var(--input-border);
          border-radius: 10px;
          padding: 0.6rem 0.75rem;
          font-size: 0.95rem;
          background: var(--input-bg);
          color: var(--input-text);
          font-family: inherit;
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
          color: var(--conversion-text);
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
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.4),
            0 2px 4px rgba(79, 70, 229, 0.2);
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
          .dashboard-container {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 768px) {
          .dashboard-container {
            grid-template-columns: 1fr;
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
  )
}

export default DashboardPanels
