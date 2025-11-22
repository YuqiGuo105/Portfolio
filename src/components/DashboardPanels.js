"use client"

import { useMemo, useState } from "react"

const formatNumber = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—"
  }
  return new Intl.NumberFormat("en-US").format(value)
}

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—"
  }
  return `${value.toFixed(1)}%`
}

const visitorLogs = [
  {
    id: 1,
    ip: "192.0.2.10",
    local_time: "2024-07-01T10:32:00Z",
    event: "page_view",
    ua: "Chrome 124 · macOS",
    country: "United States",
    region: "California",
    city: "San Francisco",
    latitude: 37.7749,
    longitude: -122.4194,
  },
  {
    id: 2,
    ip: "203.0.113.45",
    local_time: "2024-07-01T10:35:00Z",
    event: "page_view",
    ua: "Safari 17 · iOS",
    country: "United States",
    region: "New York",
    city: "New York",
    latitude: 40.7128,
    longitude: -74.006,
  },
  {
    id: 3,
    ip: "198.51.100.87",
    local_time: "2024-07-01T10:40:00Z",
    event: "demo_signup",
    ua: "Edge 123 · Windows",
    country: "Canada",
    region: "Ontario",
    city: "Toronto",
    latitude: 43.6532,
    longitude: -79.3832,
  },
  {
    id: 4,
    ip: "198.51.100.42",
    local_time: "2024-07-01T10:42:00Z",
    event: "page_view",
    ua: "Firefox 126 · Linux",
    country: "Germany",
    region: "Berlin",
    city: "Berlin",
    latitude: 52.52,
    longitude: 13.405,
  },
  {
    id: 5,
    ip: "203.0.113.18",
    local_time: "2024-07-01T10:50:00Z",
    event: "contact_form",
    ua: "Chrome 124 · Windows",
    country: "Australia",
    region: "New South Wales",
    city: "Sydney",
    latitude: -33.8688,
    longitude: 151.2093,
  },
]

const DashboardPanels = () => {
  const [activeEventFilter, setActiveEventFilter] = useState("all")

  const metrics = useMemo(() => {
    const totalVisits = visitorLogs.length
    const uniqueIps = new Set(visitorLogs.map((log) => log.ip)).size
    const uniqueCountries = new Set(visitorLogs.map((log) => log.country)).size
    const signupEvents = visitorLogs.filter((log) => log.event === "demo_signup").length
    const contactEvents = visitorLogs.filter((log) => log.event === "contact_form").length
    const engagementRate = totalVisits === 0 ? 0 : ((signupEvents + contactEvents) / totalVisits) * 100

    return {
      totalVisits,
      uniqueIps,
      engagementRate,
      signupEvents,
      uniqueCountries,
    }
  }, [])

  const trafficByLocation = useMemo(() => {
    const counts = visitorLogs.reduce((acc, log) => {
      if (!acc[log.country]) acc[log.country] = { count: 0, cities: new Set() }
      acc[log.country].count += 1
      if (log.city) acc[log.country].cities.add(log.city)
      return acc
    }, {})

    return Object.entries(counts)
      .map(([country, data]) => ({ country, count: data.count, cities: data.cities.size }))
      .sort((a, b) => b.count - a.count)
  }, [])

  const filteredVisitors = useMemo(() => {
    if (activeEventFilter === "all") return visitorLogs
    return visitorLogs.filter((log) => log.event === activeEventFilter)
  }, [activeEventFilter])

  const countryMarkers = useMemo(
    () =>
      trafficByLocation.map((location) => {
        const sample = visitorLogs.find((log) => log.country === location.country)
        return {
          ...location,
          latitude: sample?.latitude ?? 0,
          longitude: sample?.longitude ?? 0,
        }
      }),
    [trafficByLocation]
  )

  const countryToFlag = {
    "United States": "🇺🇸",
    Canada: "🇨🇦",
    Germany: "🇩🇪",
    Australia: "🇦🇺",
  }

  return (
    <section className="dashboard-wrapper" id="visitor-analytics-dashboard">
      <div className="dashboard-container">
        <div className="dashboard-card">
          <header>
            <h3>Visitor Overview</h3>
            <span className="badge">Live sample</span>
          </header>
          <div className="metrics-grid">
            <div className="metric">
              <p className="label">Total Visits</p>
              <p className="value">{formatNumber(metrics.totalVisits)}</p>
            </div>
            <div className="metric">
              <p className="label">Unique Visitors</p>
              <p className="value">{formatNumber(metrics.uniqueIps)}</p>
            </div>
            <div className="metric">
              <p className="label">Countries</p>
              <p className="value">{formatNumber(metrics.uniqueCountries)}</p>
            </div>
            <div className="metric">
              <p className="label">Engagement Rate</p>
              <p className="value accent">{formatPercent(metrics.engagementRate)}</p>
            </div>
            <div className="metric">
              <p className="label">Demo Signups</p>
              <p className="value">{formatNumber(metrics.signupEvents)}</p>
            </div>
          </div>
          <p className="muted">Aggregated from the latest visitor_logs entries.</p>
        </div>

        <div className="dashboard-card">
          <header>
            <h3>Geography</h3>
          </header>
          <div className="map-card">
            <div className="map" aria-hidden>
              {countryMarkers.map((marker) => (
                <div
                  key={marker.country}
                  className="map-marker"
                  style={{
                    left: `${50 + (marker.longitude / 180) * 50}%`,
                    top: `${50 - (marker.latitude / 90) * 30}%`,
                  }}
                  title={`${marker.country} · ${marker.count} visitors`}
                >
                  <span className="flag">{countryToFlag[marker.country] ?? "📍"}</span>
                  <span className="marker-count">{marker.count}</span>
                </div>
              ))}
              <div className="map-gradient" />
            </div>
            <div className="map-meta">
              <p className="value">{formatNumber(metrics.uniqueCountries)}</p>
              <p className="label">Countries this week</p>
            </div>
          </div>
          <div className="location-list">
            {trafficByLocation.map((location) => (
              <div className="location-row" key={location.country}>
                <div>
                  <p className="country">{location.country}</p>
                  <p className="subtext">{location.cities} cities</p>
                </div>
                <div className="count">{formatNumber(location.count)}</div>
              </div>
            ))}
          </div>
          <p className="muted">Top countries by recent traffic.</p>
        </div>

        <div className="dashboard-card">
          <header>
            <h3>Recent Visitors</h3>
            <div className="filter-group" role="group" aria-label="Event filter">
              {[
                { key: "all", label: "All" },
                { key: "page_view", label: "Views" },
                { key: "demo_signup", label: "Signups" },
                { key: "contact_form", label: "Contacts" },
              ].map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={`filter-button ${activeEventFilter === filter.key ? "active" : ""}`}
                  onClick={() => setActiveEventFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </header>
          <div className="visitor-list">
            {filteredVisitors.map((log) => (
              <div className="visitor-row" key={log.id}>
                <div className="visitor-main">
                  <div className="location">
                    <p className="city">{log.city}</p>
                    <p className="subtext">
                      {log.region ? `${log.region}, ` : ""}
                      {log.country}
                    </p>
                  </div>
                  <div className="event">{log.event.replace("_", " ")}</div>
                </div>
                <div className="visitor-meta">
                  <span className="ip">{log.ip}</span>
                  <span className="ua">{log.ua}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="muted">Live session stream with device fingerprint.</p>
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
          --badge-text: #10b981;
          --badge-bg: rgba(16, 185, 129, 0.12);
          --accent: #6366f1;
          background: var(--dashboard-bg);
          padding: 3rem 0;
          font-family: "Inter", "Segoe UI", "Roboto", sans-serif;
        }

        :global(body.dark-skin) #visitor-analytics-dashboard {
          --dashboard-bg: #0b1120;
          --card-bg: #111827;
          --card-border: rgba(148, 163, 184, 0.12);
          --card-shadow: 0 24px 40px rgba(15, 23, 42, 0.45);
          --heading-color: #e2e8f0;
          --text-primary: #e2e8f0;
          --text-secondary: #cbd5f5;
          --text-muted: #94a3b8;
          --text-subtle: #64748b;
          --badge-text: #34d399;
          --badge-bg: rgba(16, 185, 129, 0.18);
          --accent: #818cf8;
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
          flex-wrap: wrap;
        }

        .dashboard-card h3 {
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

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
        }

        .metric {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          padding: 1rem;
          border-radius: 12px;
          border: 1px solid var(--card-border);
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(16, 185, 129, 0.04));
        }

        .label {
          font-size: 0.9rem;
          color: var(--text-secondary);
          margin: 0;
        }

        .value {
          font-size: 1.4rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .value.accent {
          color: var(--accent);
        }

        .muted {
          margin: 0;
          color: var(--text-muted);
          font-size: 0.85rem;
        }

        .location-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .map-card {
          border: 1px solid var(--card-border);
          border-radius: 14px;
          padding: 1rem;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.07), rgba(16, 185, 129, 0.08));
          position: relative;
          overflow: hidden;
          display: grid;
          grid-template-columns: 3fr 1fr;
          gap: 1rem;
          align-items: center;
        }

        .map {
          position: relative;
          padding-top: 55%;
          border-radius: 12px;
          background: radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.35), transparent 30%),
            radial-gradient(circle at 80% 30%, rgba(255, 255, 255, 0.25), transparent 35%),
            linear-gradient(135deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.02));
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .map-gradient {
          position: absolute;
          inset: 0;
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 110' preserveAspectRatio='none'%3E%3Cpath d='M2,50 C20,30 50,20 80,35 C110,50 140,40 160,25 C180,10 198,20 198,20 L198,108 L2,108 Z' fill='%23dbeafe' fill-opacity='0.2'/%3E%3C/svg%3E") center/cover;
          opacity: 0.8;
          pointer-events: none;
        }

        .map-marker {
          position: absolute;
          transform: translate(-50%, -50%);
          display: inline-flex;
          gap: 0.35rem;
          align-items: center;
          background: #fff;
          color: var(--text-primary);
          padding: 0.35rem 0.6rem;
          border-radius: 999px;
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.16);
          font-weight: 700;
          font-size: 0.85rem;
          border: 1px solid var(--card-border);
        }

        :global(body.dark-skin) #visitor-analytics-dashboard .map-marker {
          background: #0f172a;
          color: #e2e8f0;
        }

        .flag {
          font-size: 1rem;
        }

        .marker-count {
          color: var(--accent);
        }

        .map-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.3rem;
        }

        .location-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.9rem 1rem;
          border-radius: 12px;
          border: 1px solid var(--card-border);
        }

        .country {
          margin: 0;
          font-weight: 600;
          color: var(--text-primary);
        }

        .subtext {
          margin: 0;
          color: var(--text-subtle);
          font-size: 0.85rem;
        }

        .count {
          font-weight: 700;
          color: var(--accent);
        }

        .visitor-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .visitor-row {
          border: 1px solid var(--card-border);
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .visitor-main {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }

        .city {
          margin: 0;
          font-weight: 600;
          color: var(--text-primary);
        }

        .event {
          background: rgba(99, 102, 241, 0.1);
          color: var(--accent);
          padding: 0.35rem 0.6rem;
          border-radius: 999px;
          font-weight: 600;
          font-size: 0.85rem;
          text-transform: capitalize;
        }

        .visitor-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
          color: var(--text-subtle);
          font-size: 0.85rem;
        }

        .filter-group {
          display: flex;
          gap: 0.35rem;
        }

        .filter-button {
          border: 1px solid var(--card-border);
          background: transparent;
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 0.35rem 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .filter-button.active {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
          box-shadow: 0 10px 25px rgba(99, 102, 241, 0.25);
        }

        .filter-button:hover:not(.active) {
          border-color: var(--accent);
          color: var(--accent);
        }

        @media (max-width: 1024px) {
          .dashboard-container {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .metrics-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .map-card {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .dashboard-container {
            grid-template-columns: 1fr;
          }

          .visitor-main {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </section>
  )
}

export default DashboardPanels
