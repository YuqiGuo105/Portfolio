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
  // Mirror the global day/night toggle (Header.js writes `light-skin` /
  // `dark-skin` onto <body>). We mirror it onto a local state so this
  // page re-renders when the user flips the toggle.
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    const sync = () => setIsLight(body.classList.contains("light-skin"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(body, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
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
      <section className={`analytics-section section-padding ${isLight ? "theme-light" : "theme-dark"}`}>
        <div className="container">
          <header className="analytics-header">
            <div className="header-title">
              <Link href="/" passHref>
                <a className="back-link">← Back to dashboard</a>
              </Link>
              <h1 className="page-title">Visitor Analytics</h1>
              <p className="page-sub">
                Live rollups served by <a href="https://github.com/YuqiGuo105/portfolio-analytics-platform" target="_blank" rel="noopener noreferrer" className="repo-link"><code>portfolio-analytics-platform</code></a>.
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
        /* ---- theme variables ---- */
        .analytics-section.theme-dark {
          --bg:        #0b1020;
          --fg:        #e2e8f0;
          --muted:     #94a3b8;
          --strong:    #ffffff;
          --card-bg:   rgba(15, 23, 42, 0.5);
          --card-bd:   rgba(255, 255, 255, 0.08);
          --row-bd:    rgba(255, 255, 255, 0.06);
          --tab-bg:    rgba(15, 23, 42, 0.6);
          --bar-track: rgba(255, 255, 255, 0.08);
          --code-bg:   rgba(255, 255, 255, 0.08);
          --back-hov:  #ffffff;
          --empty:     #64748b;
          --device:    #cbd5e1;
        }
        .analytics-section.theme-light {
          --bg:        #ffffff;
          --fg:        #1f2937;
          --muted:     #475569;
          --strong:    #0f172a;
          --card-bg:   #ffffff;
          --card-bd:   rgba(15, 23, 42, 0.10);
          --row-bd:    rgba(15, 23, 42, 0.08);
          --tab-bg:    #f1f5f9;
          --bar-track: rgba(15, 23, 42, 0.10);
          --code-bg:   rgba(15, 23, 42, 0.06);
          --back-hov:  #0f172a;
          --empty:     #64748b;
          --device:    #334155;
        }

        .analytics-section {
          background: var(--bg);
          color: var(--fg);
          min-height: 100vh;
          padding-top: 120px;
          padding-bottom: 80px;
        }
        /* Global .container has no horizontal padding; add it here and
           cap the inner width so content stays inside the viewport on
           every breakpoint. */
        .analytics-section .container {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          padding-left: clamp(1rem, 4vw, 2rem);
          padding-right: clamp(1rem, 4vw, 2rem);
          box-sizing: border-box;
        }

        .analytics-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1.5rem;
          margin-bottom: 2.5rem;
          flex-wrap: wrap;
          text-align: center;
        }
        .header-title {
          flex: 1 1 320px;
          min-width: 0;
          text-align: center;
        }
        @media (max-width: 700px) {
          .analytics-header {
            flex-direction: column;
            align-items: center;
          }
          .header-title { flex: 0 0 auto; width: 100%; }
          .range-tabs {
            width: 100%;
            justify-content: center;
            flex-wrap: wrap;
          }
          .range-tab {
            padding: 6px 12px;
            font-size: 0.8rem;
          }
        }

        .back-link {
          color: var(--muted);
          text-decoration: none;
          font-size: 0.9rem;
          display: inline-block;
          margin-bottom: 0.3rem;
        }
        .back-link:hover { color: var(--back-hov); }

        .page-title {
          color: var(--strong);
          font-size: clamp(1.8rem, 4vw, 2.4rem);
          margin: 0.4rem 0 0.6rem 0;
          text-align: center;
        }
        .page-sub {
          color: var(--muted);
          max-width: 640px;
          line-height: 1.55;
          margin: 0 auto;
          text-align: center;
        }
        .page-sub code {
          background: var(--code-bg);
          color: var(--strong);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.85em;
        }
        .repo-link {
          color: inherit;
          text-decoration: none;
        }
        .repo-link:hover code {
          background: #6366f1;
          color: #ffffff;
        }

        .range-tabs {
          display: inline-flex;
          align-items: center;
          background: var(--tab-bg);
          border: 1px solid var(--card-bd);
          border-radius: 999px;
          padding: 4px;
          align-self: center;
          gap: 2px;
        }
        .range-tab {
          padding: 8px 16px;
          border-radius: 999px;
          background: transparent;
          color: var(--muted);
          border: none;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.18s ease;
          white-space: nowrap;
        }
        .range-tab.is-active {
          background: #6366f1;
          color: #ffffff;
        }

        .alert-error {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #b91c1c;
          padding: 12px 18px;
          border-radius: 10px;
          margin-bottom: 1.5rem;
        }
        .analytics-section.theme-dark .alert-error { color: #fecaca; }

        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .globe-row {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
          gap: 1.5rem;
          margin-bottom: 2rem;
        }
        @media (max-width: 900px) {
          .globe-row { grid-template-columns: minmax(0, 1fr); }
        }
        .globe-large {
          width: 100%;
          min-width: 0;
          min-height: 480px;
          background: radial-gradient(circle at 30% 30%, rgba(99,102,241,0.18), transparent 55%),
                      var(--card-bg);
          border-radius: 18px;
          border: 1px solid var(--card-bd);
          overflow: hidden;
          position: relative;
          display: grid;
          place-items: center;
        }
        .globe-legend {
          background: var(--card-bg);
          border: 1px solid var(--card-bd);
          border-radius: 18px;
          padding: 1.2rem 1.4rem;
          min-width: 0;
        }
        .globe-legend h3 { color: var(--strong); margin-top: 0; }

        .country-list { list-style: none; padding: 0; margin: 0; }
        .country-list li {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          border-bottom: 1px solid var(--row-bd);
          font-size: 0.92rem;
        }
        .country-list li.empty {
          color: var(--empty);
          font-style: italic;
          border-bottom: none;
        }
        .country-name { color: var(--fg); }
        .country-count { color: #f59e0b; font-weight: 600; }

        .charts-row {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
          gap: 1.5rem;
          margin-bottom: 2rem;
        }
        @media (max-width: 900px) {
          .charts-row { grid-template-columns: minmax(0, 1fr); }
        }
        .chart-card {
          background: var(--card-bg);
          border: 1px solid var(--card-bd);
          border-radius: 18px;
          padding: 1.2rem 1.4rem;
          min-width: 0;
          overflow: hidden;
        }
        .chart-card h3 {
          color: var(--strong);
          margin-top: 0;
          text-align: center;
        }

        .device-list { list-style: none; padding: 0; margin: 0; }
        .device-list li {
          display: grid;
          grid-template-columns: minmax(0, 90px) minmax(0, 1fr) 60px;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
          border-bottom: 1px solid var(--row-bd);
        }
        .device-list li.empty {
          display: block;
          color: var(--empty);
          font-style: italic;
          border-bottom: none;
        }
        .device-name { text-transform: capitalize; color: var(--device); }
        .device-count { color: #f59e0b; text-align: right; font-weight: 600; }
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
          background: var(--card-bg, rgba(15, 23, 42, 0.5));
          border: 1px solid var(--card-bd, rgba(255, 255, 255, 0.08));
          border-radius: 14px;
          padding: 1.1rem 1.2rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          gap: 6px;
          min-height: 96px;
          min-width: 0;
        }
        .kpi-title {
          color: var(--muted, #94a3b8);
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .kpi-value {
          color: var(--strong, #fff);
          font-size: 1.7rem;
          font-weight: 700;
          line-height: 1.1;
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
          background: var(--bar-track, rgba(255, 255, 255, 0.08));
          border-radius: 999px;
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #6366f1, #f59e0b);
          border-radius: 999px;
        }
      `}</style>
    </div>
  );
}

function TimeSeries({ series }) {
  if (!series.length) {
    return <p className="ts-empty">No data in this range yet.<style jsx>{`
      .ts-empty { color: var(--empty, #64748b); font-style: italic; text-align: center; margin: 1rem 0; }
    `}</style></p>;
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
          justify-content: center;
          gap: 4px;
          min-height: 170px;
          width: 100%;
          max-width: 100%;
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
          background: linear-gradient(180deg, #6366f1, #f59e0b);
          border-radius: 4px 4px 0 0;
          transition: height 0.2s ease;
        }
        .ts-label {
          color: var(--muted, #94a3b8);
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
