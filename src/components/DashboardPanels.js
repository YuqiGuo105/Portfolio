"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase/supabaseClient";
const RotatingGlobe = dynamic(() => import("./RotatingGlobe"), { ssr: false });

/* ============================================================
   Helpers
   ============================================================ */

const formatCurrency = (value, currency) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
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

const useDebouncedValue = (value, delayMs) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
};

const buildLocationLabel = (r) => {
  const city = r?.city ? String(r.city).trim() : "";
  const region = r?.region ? String(r.region).trim() : "";
  const country = r?.country ? String(r.country).trim() : "";
  if (city && region) return `${city}, ${region}`;
  if (city && country) return `${city}, ${country}`;
  if (region && country) return `${region}, ${country}`;
  return country || "Unknown";
};

const buildPinLabel = (r) => {
  const region = r?.region ? String(r.region).trim() : "";
  const country = r?.country ? String(r.country).trim() : "";
  if (region) return region;
  return country || "Unknown";
};

// derive "device" from UA
const buildDeviceLabelFromUa = (uaRaw) => {
  const ua = String(uaRaw || "").trim();
  if (!ua) return "Unknown";

  if (/vercel-screenshot/i.test(ua)) return "Vercel Screenshot";
  if (/googlebot/i.test(ua)) return "Googlebot";
  if (/ahrefsbot/i.test(ua)) return "AhrefsBot";
  if (/bytespider/i.test(ua)) return "Bytespider";
  if (/\b(bot|spider|crawler)\b/i.test(ua)) return "Bot/Crawler";

  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/macintosh/i.test(ua)) return "macOS";
  if (/windows nt/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";

  return "Other";
};

/* ============================================================
   Visitors performance helpers
   ============================================================ */

const VISITOR_CACHE_KEY = "yuqi_visitors_cache_v4";

const safeParseJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * Aggregate pins by (region || country). One label => one pin.
 * lat/lng averaged for stability.
 */
const aggregatePinsByRegion = (rows, maxLabels = 1200) => {
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map();

  for (const r of list) {
    const lat = Number(r?.latitude);
    const lng = Number(r?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const label = buildPinLabel(r);

    let e = map.get(label);
    if (!e) {
      if (map.size >= maxLabels) continue;
      e = { sumLat: 0, sumLng: 0, n: 0 };
      map.set(label, e);
    }

    e.sumLat += lat;
    e.sumLng += lng;
    e.n += 1;
  }

  return Array.from(map.entries()).map(([label, e]) => {
    const lat = e.n ? e.sumLat / e.n : 0;
    const lng = e.n ? e.sumLng / e.n : 0;
    return { lat, lng, latitude: lat, longitude: lng, label };
  });
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

  // Visitors
  const [visitors, setVisitors] = useState({
    last30: 0,
    today: 0,
    unknownLocation: 0,
    pins: [],
    topSources: [],
    topDevices: [],
    fetchedAt: Date.now(),
  });
  const [isVisitorsLoading, setIsVisitorsLoading] = useState(true);

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

  /* ============================================================
     Market
     ============================================================ */
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

  /* ============================================================
     Currency
     ============================================================ */
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

  /* ============================================================
     Weather
     ============================================================ */
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

  /* ============================================================
     ✅ Visitors — "pins first, stats later" (FIX)
     PHASE -1: restore cache instantly
     PHASE 0: fetch latest located rows (VERY FAST) => pins immediately
     PHASE 1: 30-day sample => top sources
     PHASE 1b: counts + devices (estimated) => small payload
     PHASE 2: all-time aggregation (idle)
     ============================================================ */
  useEffect(() => {
    let mounted = true;

    const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));
    const runIdle =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (fn) => window.requestIdleCallback(fn, { timeout: 2500 })
        : (fn) => setTimeout(fn, 600);

    // PHASE -1: cache restore (instant)
    if (typeof window !== "undefined") {
      const cached = safeParseJson(localStorage.getItem(VISITOR_CACHE_KEY));
      if (cached?.pins?.length) {
        setVisitors((prev) => ({
          ...prev,
          ...cached,
          fetchedAt: cached.fetchedAt || Date.now(),
        }));
      }
    }

    const fetchVisitors = async () => {
      setIsVisitorsLoading(true);

      try {
        const now = new Date();
        const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const startTodayLocal = new Date(now);
        startTodayLocal.setHours(0, 0, 0, 0);

        const start30Iso = start30.toISOString();
        const startTodayIso = startTodayLocal.toISOString();

        // ---------------- PHASE 0 (CRITICAL): latest pins first ----------------
        // ✅ no gte(), smallest select, uses created_at desc index best
        const { data: latestRows, error: latestErr } = await supabase
          .from("visitor_logs")
          .select("latitude, longitude, region, country, created_at")
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .order("created_at", { ascending: false })
          .limit(120);

        if (latestErr) throw latestErr;

        const latestPins = aggregatePinsByRegion(latestRows || [], 320);

        if (!mounted) return;

        setVisitors((prev) => {
          const next = {
            ...prev,
            pins: latestPins,
            fetchedAt: Date.now(),
          };
          if (typeof window !== "undefined") {
            localStorage.setItem(VISITOR_CACHE_KEY, JSON.stringify(next));
          }
          return next;
        });

        // yield so globe can paint pins immediately
        await yieldToBrowser();

        // ---------------- PHASE 1: 30-day sample for Top sources ----------------
        // keep light: fewer columns, smaller limit
        const { data: sample30, error: sample30Err } = await supabase
          .from("visitor_logs")
          .select("latitude, longitude, country, region, city, created_at")
          .gte("created_at", start30Iso)
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .order("created_at", { ascending: false })
          .limit(360);

        if (sample30Err) throw sample30Err;

        const safeSample = Array.isArray(sample30) ? sample30 : [];

        const sourceCounts = new Map();
        for (const r of safeSample) {
          const label = buildLocationLabel(r);
          sourceCounts.set(label, (sourceCounts.get(label) || 0) + 1);
        }
        const topSources = Array.from(sourceCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([label, count]) => ({ label, count }));

        if (!mounted) return;

        setVisitors((prev) => {
          const next = { ...prev, topSources, fetchedAt: Date.now() };
          if (typeof window !== "undefined") {
            localStorage.setItem(VISITOR_CACHE_KEY, JSON.stringify(next));
          }
          return next;
        });

        await yieldToBrowser();

        // ---------------- PHASE 1b: counts + devices (estimated, small) ----------------
        const COUNT_MODE = "estimated";

        const [total30Res, totalTodayRes, located30Res, deviceRes] = await Promise.all([
          supabase
            .from("visitor_logs")
            .select("id", { count: COUNT_MODE, head: true })
            .gte("created_at", start30Iso),
          supabase
            .from("visitor_logs")
            .select("id", { count: COUNT_MODE, head: true })
            .gte("created_at", startTodayIso),
          supabase
            .from("visitor_logs")
            .select("id", { count: COUNT_MODE, head: true })
            .gte("created_at", start30Iso)
            .not("latitude", "is", null)
            .not("longitude", "is", null),
          supabase
            .from("visitor_logs")
            .select("ua, created_at")
            .gte("created_at", start30Iso)
            .order("created_at", { ascending: false })
            .limit(900),
        ]);

        if (total30Res.error) throw total30Res.error;
        if (totalTodayRes.error) throw totalTodayRes.error;
        if (located30Res.error) throw located30Res.error;
        if (deviceRes.error) throw deviceRes.error;

        const total30 = Number(total30Res.count || 0);
        const totalToday = Number(totalTodayRes.count || 0);
        const located30 = Number(located30Res.count || 0);
        const unknownLocation = Math.max(total30 - located30, 0);

        const deviceRows = Array.isArray(deviceRes.data) ? deviceRes.data : [];
        const deviceCounts = new Map();
        for (const r of deviceRows) {
          const label = buildDeviceLabelFromUa(r?.ua);
          deviceCounts.set(label, (deviceCounts.get(label) || 0) + 1);
        }
        const topDevices = Array.from(deviceCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([label, count]) => ({ label, count }));

        if (!mounted) return;

        setVisitors((prev) => {
          const next = {
            ...prev,
            last30: total30,
            today: totalToday,
            unknownLocation,
            topDevices,
            fetchedAt: Date.now(),
          };
          if (typeof window !== "undefined") {
            localStorage.setItem(VISITOR_CACHE_KEY, JSON.stringify(next));
          }
          return next;
        });

        // ---------------- PHASE 2: all-time aggregated pins (idle) ----------------
        runIdle(async () => {
          if (!mounted) return;

          const PAGE_SIZE = 900;
          const MAX_PAGES = 12;
          const MAX_LABELS = 1800;

          let from = 0;
          let pageCount = 0;

          const merged = new Map();
          // seed with latest pins so we never regress to "none"
          for (const p of latestPins) {
            merged.set(p.label, { sumLat: p.lat, sumLng: p.lng, n: 1 });
          }

          while (mounted) {
            if (pageCount >= MAX_PAGES) break;
            if (merged.size >= MAX_LABELS) break;

            const { data: page, error: pageErr } = await supabase
              .from("visitor_logs")
              .select("latitude, longitude, region, country, created_at")
              .not("latitude", "is", null)
              .not("longitude", "is", null)
              .order("created_at", { ascending: false })
              .range(from, from + PAGE_SIZE - 1);

            if (pageErr) throw pageErr;

            const safePage = Array.isArray(page) ? page : [];
            for (const r of safePage) {
              const lat = Number(r?.latitude);
              const lng = Number(r?.longitude);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

              const label = buildPinLabel(r);

              let e = merged.get(label);
              if (!e) {
                if (merged.size >= MAX_LABELS) break;
                e = { sumLat: 0, sumLng: 0, n: 0 };
                merged.set(label, e);
              }
              e.sumLat += lat;
              e.sumLng += lng;
              e.n += 1;
            }

            if (safePage.length < PAGE_SIZE) break;

            from += PAGE_SIZE;
            pageCount += 1;
            if (pageCount % 2 === 0) await yieldToBrowser();
          }

          if (!mounted) return;

          const pinsAll = Array.from(merged.entries()).map(([label, e]) => {
            const lat = e.n ? e.sumLat / e.n : 0;
            const lng = e.n ? e.sumLng / e.n : 0;
            return { lat, lng, latitude: lat, longitude: lng, label };
          });

          setVisitors((prev) => {
            const next = { ...prev, pins: pinsAll, fetchedAt: Date.now() };
            if (typeof window !== "undefined") {
              localStorage.setItem(VISITOR_CACHE_KEY, JSON.stringify(next));
            }
            return next;
          });
        });
      } catch (e) {
        console.error("Failed to load visitors from Supabase", e);
      } finally {
        if (mounted) setIsVisitorsLoading(false);
      }
    };

    fetchVisitors();

    return () => {
      mounted = false;
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
    if (isWeatherLoading || weather.temperature === null || weather.temperature === undefined) {
      return "--";
    }
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

    if (marketMeta?.source === "simulated" || marketFallback) {
      return { marketBadgeText: "Fallback data.", marketBadgeClassName: "badge badge-warning" };
    }

    if (marketMeta?.source === "stooq") {
      const partial = marketMeta?.partial?.length
        ? ` · partial: ${marketMeta.partial.join(", ")}`
        : "";
      return { marketBadgeText: `delayed quotes (stooq)${partial}`, marketBadgeClassName: "badge" };
    }

    if (marketMeta?.source && marketMeta.source !== "yahoo-finance") {
      return {
        marketBadgeText: `cached snapshot · source: ${marketMeta.source}`,
        marketBadgeClassName: "badge badge-warning",
      };
    }

    return { marketBadgeText: null, marketBadgeClassName: "badge" };
  }, [isMarketLoading, marketFallback, marketMeta]);

  return (
    <section className="dashboard-wrapper" id="market-weather-dashboard">
      <div className="section-heading">
        <div className="overtitle">
          <h3 id="tour-real-time-data">Real-Time Data</h3>
        </div>
      </div>

      <div className="dashboard-container">
        <div className="dashboard-card-1 market-card">
          <header>
            <h3>Market Data</h3>
            {marketBadgeText && <span className={marketBadgeClassName}>{marketBadgeText}</span>}
          </header>

          <div className="market-rows">
            {marketData.map((item) => {
              const changeValue =
                typeof item.change === "number" && !Number.isNaN(item.change) ? item.change : null;
              const changePercent =
                typeof item.changePercent === "number" && !Number.isNaN(item.changePercent)
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
                  <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                    <option value="CNY">CNY</option>
                  </select>
                </label>

                <label className="input-group">
                  <span>To</span>
                  <select value={targetCurrency} onChange={(e) => setTargetCurrency(e.target.value)}>
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
            </div>
          </div>
        </div>

        {/* Visitors */}
        <div className="dashboard-card-4 visitors-card">
          <header>
            <h3>Visitor Insights</h3>
            <p className="card-subtitle">A quick snapshot of who’s dropping by.</p>
          </header>

          <div className="visitors-body">
            <div className="visitors-globe-pane">
              <div className="globe-frame" aria-hidden="true">
                <RotatingGlobe pins={visitors.pins} supabase={supabase} />
              </div>

              <div className="visitors-stats">
                <div className="stat">
                  <span className="stat-label">LAST 30 DAYS</span>
                  <span className="stat-value">{visitors.last30}</span>
                </div>

                <div className="stat">
                  <span className="stat-label">TODAY</span>
                  <span className="stat-value">{visitors.today}</span>
                </div>

                <div className="stat-sub">
                  <span className="timestamp">
                    {isVisitorsLoading ? "Updating…" : hoursAgoLabel(visitors.fetchedAt)}
                  </span>
                </div>
              </div>
            </div>

            <aside className="visitors-side">
              <div className="side-title">Top sources</div>
              <div className="side-list">
                {(visitors.topSources || []).map((s) => (
                  <div className="side-item" key={s.label}>
                    <span className="side-label">{s.label}</span>
                    <span className="side-count">{s.count}</span>
                  </div>
                ))}
                {!visitors.topSources?.length && <div className="side-empty">No data yet</div>}
              </div>

              <div className="side-divider" aria-hidden="true" />

              <div className="side-title">Top devices</div>
              <div className="side-list">
                {(visitors.topDevices || []).map((d) => (
                  <div className="side-item" key={d.label}>
                    <span className="side-label">{d.label}</span>
                    <span className="side-count">{d.count}</span>
                  </div>
                ))}
                {!visitors.topDevices?.length && <div className="side-empty">No data yet</div>}
              </div>

              <div className="side-footnote">MapReduce by Hadoop</div>
            </aside>
          </div>
        </div>
      </div>

      <style jsx>{`
        /* ✅ unchanged: keep your original CSS exactly */
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

        /* ... keep rest of your CSS unchanged ... */

        .section-heading {
          max-width: 840px;
          margin: 0 auto 32px auto;
          text-align: center;
          color: var(--text-primary);
        }
        .section-heading .overtitle {
          letter-spacing: 0.01em;
          font-size: 12px;
          text-transform: none;
          color: var(--text-muted);
          font-weight: 600;
        }
        .section-heading .overtitle h3 {
          margin: 8px 0 12px;
          font-size: 32px;
          font-weight: 700;
          letter-spacing: -0.01em;
          text-transform: none;
          color: var(--text-primary);
        }
        .section-heading .section-intro {
          margin: 0 auto;
          max-width: 640px;
          color: var(--text-secondary);
          font-size: 15px;
          line-height: 1.65;
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

        .dashboard-card-1 h3,
        .dashboard-card-2 h3,
        .dashboard-card-3 h3,
        .dashboard-card-4 h3 {
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

        .currency-card .timestamp {
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

        /* Visitors */
        .dashboard-card-4 {
          flex: 1 1 100%;
          width: 100%;
          max-width: 1500px;
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: 18px;
          padding: 20px;
          box-shadow: var(--card-shadow);
          display: flex;
          flex-direction: column;
          gap: 1rem;
          color: var(--text-primary);
        }

        .dashboard-card-4 header {
          display: flex;
          height: 110px;
          border-radius: 30px;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          text-align: center;
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

        .dashboard-card-4 .card-subtitle {
          margin: 0;
          font-size: 0.9rem;
          color: #fdfdfd;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
        }

        .visitors-body {
          display: grid;
          grid-template-columns: 3fr 1fr;
          gap: 1rem;
          align-items: stretch;
        }

        .globe-frame {
          width: 100%;
          height: 420px;
          border-radius: 18px;
          border: 1px solid var(--card-border);
          touch-action: none;
          cursor: grab;
          background: radial-gradient(
            circle at 30% 30%,
            rgba(255, 255, 255, 0.08),
            rgba(0, 0, 0, 0) 55%
          ),
          radial-gradient(
            circle at 70% 80%,
            rgba(79, 70, 229, 0.1),
            rgba(0, 0, 0, 0) 60%
          ),
          rgba(15, 23, 42, 0.35);
          display: grid;
          place-items: center;
          overflow: hidden;
          position: relative;
        }

        .globe-frame:active {
          cursor: grabbing;
        }

        .visitors-globe-pane {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }

        .visitors-stats {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .stat {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .stat-label {
          font-size: 0.7rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .stat-value {
          font-size: 1.9rem;
          font-weight: 650;
          font-variant-numeric: tabular-nums;
          color: var(--text-primary);
        }

        .stat-sub {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-size: 0.78rem;
          color: var(--text-muted);
        }

        .visitors-side {
          border-radius: 18px;
          border: 1px solid var(--card-border);
          background: rgba(15, 23, 42, 0.08);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          min-height: 360px;
        }

        :global(body.dark-skin) .visitors-side {
          background: rgba(15, 23, 42, 0.55);
        }

        .side-title {
          font-size: 0.8rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 650;
        }

        .side-list {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }

        .side-item {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          font-size: 0.9rem;
          color: var(--text-primary);
        }

        .side-label {
          max-width: 75%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-secondary);
        }

        .side-count {
          font-variant-numeric: tabular-nums;
          font-weight: 650;
        }

        .side-empty {
          font-size: 0.9rem;
          color: var(--text-muted);
        }

        .side-divider {
          height: 1px;
          width: 100%;
          background: var(--card-border);
          opacity: 0.9;
          margin: 0.25rem 0;
        }

        .side-footnote {
          margin-top: auto;
          font-size: 0.75rem;
          color: var(--text-subtle);
          letter-spacing: 0.03em;
          display: flex;
          justify-content: center;
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
          .column-container,
          .dashboard-card-4 {
            width: 100%;
            max-width: 100%;
          }

          .visitors-body {
            grid-template-columns: 1fr;
          }

          .visitors-side {
            min-height: auto;
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

          .globe-frame {
            min-height: 320px;
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
