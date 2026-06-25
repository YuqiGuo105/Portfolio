import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import Layout from "../src/layout/Layout";
import SeoHead from "../src/components/SeoHead";

const RotatingGlobe = dynamic(() => import("../src/components/RotatingGlobe"), {
  ssr: false,
});

// Defaults to a same-origin proxy (`/api/analytics/*`) so the page works
// out-of-the-box on Vercel without a public CORS exception. Override via
// `NEXT_PUBLIC_ANALYTICS_API_URL` to point straight at Render in prod.
const API_BASE = (process.env.NEXT_PUBLIC_ANALYTICS_API_URL || "/api/analytics").replace(/\/$/, "");

// The aggregator now speaks `window=7d|30d|90d|all`. We send `days` only
// as a fallback for older backend revisions; new code paths key on `window`.
// The label is kept short so the tab row stays compact on mobile.
const RANGE_OPTIONS = [
  { id: "7d",  label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "all", label: "All time" },
];

const num = (v) => (typeof v === "number" ? v : Number(v ?? 0));

const formatCount = (v) => {
  const n = num(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
};

const formatDay = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch (_e) {
    return iso;
  }
};

export default function AnalyticsPage() {
  const [window, setWindow] = useState("30d");
  const [summary, setSummary] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Force the global header into dark mode while on this page so it
  // blends with the dark-navy analytics background instead of showing
  // the jarring cream light-skin bar. Header.js skips its own body-class
  // override on /analytics (see DARK_PAGES list there), so this is the
  // sole controller of the body class while on this route.
  useEffect(() => {
    const body = document.body;
    const prev = Array.from(body.classList);
    body.classList.remove("home", "page", "light-skin");
    body.classList.add("dark-skin");
    return () => {
      body.classList.remove("dark-skin");
      prev.forEach((c) => body.classList.add(c));
    };
  }, []);

  const load = useCallback(async (rangeWindow) => {
    setLoading(true);
    setError(null);
    try {
      const qs = `window=${encodeURIComponent(rangeWindow)}`;
      const [s, m] = await Promise.all([
        fetch(`${API_BASE}/visits/summary?${qs}`).then((r) => {
          if (!r.ok) throw new Error(`summary ${r.status}`);
          return r.json();
        }),
        fetch(`${API_BASE}/visits/markers?${qs}`).then((r) => {
          if (!r.ok) throw new Error(`markers ${r.status}`);
          return r.json();
        }),
      ]);
      setSummary(s);
      setMarkers(Array.isArray(m) ? m : []);
    } catch (e) {
      setError(e.message || "failed to load analytics");
      setSummary(null);
      setMarkers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(window);
  }, [window, load]);

  const globePins = useMemo(() => {
    return markers
      .filter((m) => m.lat != null && m.lng != null)
      .map((m) => ({
        lat: Number(m.lat),
        lng: Number(m.lng),
        size: 0.55,
        color: "#fbbf24",
        label: `${m.name || m.country || m.geoAreaId}: ${formatCount(m.count)}`,
        count: num(m.count),
      }));
  }, [markers]);

  const totals = summary?.totals ?? {};

  return (
    <Layout>
      <SeoHead
        title="Visitor Analytics"
        description="Live analytics rollups for yuqi.site: top countries, devices, and a 30-day visitor time series."
      />
      <section className="analytics-section section-padding">
        <div className="container">
          <header className="analytics-header">
            <div>
              <Link href="/" passHref>
                <a className="back-link">← Back to dashboard</a>
              </Link>
              <h1 className="page-title">Visitor Analytics</h1>
              <p className="page-sub">
                Live rollups served by <code>portfolio-analytics-platform</code>.
                Data is enriched in-process, snapped to METRO floor, and stored at
                5-minute + 1-day granularities. No raw IPs leave the aggregator.
              </p>
            </div>

            <div className="range-tabs" role="tablist" aria-label="Time range">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  role="tab"
                  aria-selected={window === opt.id}
                  className={`range-tab${window === opt.id ? " is-active" : ""}`}
                  onClick={() => setWindow(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </header>

          {error && (
            <div className="alert alert-error" role="alert">
              Failed to load analytics: <code>{error}</code>. The aggregator
              might still be cold-starting; try again in a few seconds.
            </div>
          )}

          <div className="kpi-grid">
            <KpiCard title="Total events" value={loading ? "…" : formatCount(totals.events)} />
            <KpiCard title="Page views" value={loading ? "…" : formatCount(totals.pageViews)} />
            <KpiCard title="Clicks" value={loading ? "…" : formatCount(totals.clicks)} />
            <KpiCard title="Mapped locations" value={loading ? "…" : formatCount(markers.length)} />
          </div>

          <div className="globe-row">
            <div className="globe-large">
              {/* Pass supabase={false} (not null) so RotatingGlobe doesn't
                  fall back to the global supabaseClient and overwrite our
                  aggregator-sourced pins with the legacy visitor_pin_cells
                  table. `window` is forwarded so the in-globe viewport
                  re-fetch uses the same time window as the rest of the
                  dashboard. */}
              <RotatingGlobe
                pins={globePins}
                supabase={false}
                apiBase={API_BASE}
                window={window}
              />
            </div>
            <div className="globe-legend">
              <h3>Top countries</h3>
              <ol className="country-list">
                {(summary?.topCountries ?? []).slice(0, 12).map((row) => (
                  <li key={row.country}>
                    <span className="country-name">{row.country || "—"}</span>
                    <span className="country-count">{formatCount(row.count)}</span>
                  </li>
                ))}
                {!loading && !(summary?.topCountries ?? []).length && (
                  <li className="empty">No country data in this range yet.</li>
                )}
              </ol>
            </div>
          </div>

          <div className="charts-row">
            <section className="chart-card">
              <h3>Events per day</h3>
              <TimeSeries series={summary?.timeSeries ?? []} />
            </section>

            <section className="chart-card">
              <h3>Top devices</h3>
              <ul className="device-list">
                {(summary?.topDevices ?? []).map((d) => (
                  <li key={d.deviceType}>
                    <span className="device-name">{d.deviceType || "unknown"}</span>
                    <DeviceBar value={num(d.count)} total={num(totals.events) || 1} />
                    <span className="device-count">{formatCount(d.count)}</span>
                  </li>
                ))}
                {!loading && !(summary?.topDevices ?? []).length && (
                  <li className="empty">No device data in this range yet.</li>
                )}
              </ul>
            </section>
          </div>
        </div>
      </section>

      <style jsx>{`
        .analytics-section {
          background: #0b1020;
          color: #e2e8f0;
          min-height: 100vh;
          padding-top: 120px;
          padding-bottom: 80px;
        }
        /* Global .container has no horizontal padding; add it here so
           content doesn't touch the viewport edges on smaller screens. */
        .analytics-section .container {
          padding-left: 1.5rem;
          padding-right: 1.5rem;
        }
        .analytics-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 2rem;
          margin-bottom: 2.5rem;
          flex-wrap: wrap;
        }
        @media (max-width: 640px) {
          .analytics-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .range-tabs {
            width: 100%;
            justify-content: center;
          }
        }
        .back-link {
          color: #94a3b8;
          text-decoration: none;
          font-size: 0.9rem;
        }
        .back-link:hover { color: #fff; }
        .page-title {
          color: #fff;
          font-size: 2.4rem;
          margin: 0.6rem 0 0.4rem 0;
        }
        .page-sub {
          color: #94a3b8;
          max-width: 640px;
          line-height: 1.55;
        }
        .page-sub code {
          background: rgba(255, 255, 255, 0.08);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.85em;
        }

        .range-tabs {
          display: inline-flex;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          padding: 4px;
        }
        .range-tab {
          padding: 8px 16px;
          border-radius: 999px;
          background: transparent;
          color: #94a3b8;
          border: none;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.18s ease;
        }
        .range-tab.is-active {
          background: #6366f1;
          color: white;
        }

        .alert-error {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fecaca;
          padding: 12px 18px;
          border-radius: 10px;
          margin-bottom: 1.5rem;
        }

        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .globe-row {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 1.5rem;
          margin-bottom: 2rem;
        }
        @media (max-width: 900px) {
          .globe-row { grid-template-columns: 1fr; }
        }
        .globe-large {
          width: 100%;
          min-height: 480px;
          background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08), transparent 55%),
                      rgba(15, 23, 42, 0.5);
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          overflow: hidden;
          position: relative;
          display: grid;
          place-items: center;
        }
        .globe-legend {
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          padding: 1.2rem 1.4rem;
        }
        .globe-legend h3 { color: #fff; margin-top: 0; }
        .country-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .country-list li {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 0.92rem;
        }
        .country-list li.empty {
          color: #64748b;
          font-style: italic;
          border-bottom: none;
        }
        .country-name { color: #e2e8f0; }
        .country-count { color: #fbbf24; font-weight: 600; }

        .charts-row {
          display: grid;
          grid-template-columns: 1.6fr 1fr;
          gap: 1.5rem;
        }
        @media (max-width: 900px) {
          .charts-row { grid-template-columns: 1fr; }
        }
        .chart-card {
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          padding: 1.2rem 1.4rem;
        }
        .chart-card h3 { color: #fff; margin-top: 0; }

        .device-list { list-style: none; padding: 0; margin: 0; }
        .device-list li {
          display: grid;
          grid-template-columns: 90px 1fr 60px;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .device-list li.empty {
          display: block;
          color: #64748b;
          font-style: italic;
          border-bottom: none;
        }
        .device-name { text-transform: capitalize; color: #cbd5e1; }
        .device-count { color: #fbbf24; text-align: right; font-weight: 600; }
      `}</style>
    </Layout>
  );
}

function KpiCard({ title, value }) {
  return (
    <div className="kpi-card">
      <span className="kpi-title">{title}</span>
      <span className="kpi-value">{value}</span>
      <style jsx>{`
        .kpi-card {
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 1rem 1.2rem;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .kpi-title {
          color: #94a3b8;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .kpi-value {
          color: #fff;
          font-size: 1.7rem;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}

function DeviceBar({ value, total }) {
  const pct = Math.max(2, Math.round((value / total) * 100));
  return (
    <div className="bar-track" aria-hidden="true">
      <div className="bar-fill" style={{ width: `${pct}%` }} />
      <style jsx>{`
        .bar-track {
          height: 8px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #6366f1, #fbbf24);
          border-radius: 999px;
        }
      `}</style>
    </div>
  );
}

function TimeSeries({ series }) {
  if (!series.length) {
    return <p style={{ color: "#64748b", fontStyle: "italic" }}>No data in this range yet.</p>;
  }
  const max = Math.max(...series.map((d) => num(d.count))) || 1;
  return (
    <div className="ts-wrap" role="img" aria-label={`${series.length}-bucket time series`}>
      {series.map((d) => {
        const h = Math.max(4, Math.round((num(d.count) / max) * 140));
        return (
          <div className="ts-col" key={d.bucketTime}>
            <div className="ts-bar" style={{ height: `${h}px` }} title={`${formatDay(d.bucketTime)}: ${formatCount(d.count)}`} />
            <span className="ts-label">{formatDay(d.bucketTime)}</span>
          </div>
        );
      })}
      <style jsx>{`
        .ts-wrap {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          min-height: 170px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .ts-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          flex: 0 0 auto;
        }
        .ts-bar {
          width: 14px;
          background: linear-gradient(180deg, #6366f1, #fbbf24);
          border-radius: 4px 4px 0 0;
          transition: height 0.2s ease;
        }
        .ts-label {
          color: #94a3b8;
          font-size: 0.65rem;
          transform: rotate(-50deg);
          transform-origin: center;
          margin-top: 4px;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
