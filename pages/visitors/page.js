"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../src/supabase/supabaseClient"
import { ComposableMap, Geographies, Geography } from "react-simple-maps"

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"

// 统一处理 key：大写、去掉标点
const normalizeKey = (value) => {
  if (!value) return ""
  return String(value).trim().toUpperCase().replace(/[.,']/g, "")
}

const VisitorsPage = () => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [visitorsNow, setVisitorsNow] = useState(0)
  const [last10MinutesBuckets, setLast10MinutesBuckets] = useState([]) // [number, ...] len 10
  const [last30DaysBuckets, setLast30DaysBuckets] = useState([]) // [{ date, count }]
  const [todayHourlyBuckets, setTodayHourlyBuckets] = useState([]) // [number, ...] len 24

  const [countryCounts, setCountryCounts] = useState([]) // [{ key, count }]
  const [topPages, setTopPages] = useState([]) // [{ url, count }]
  const [topEvents, setTopEvents] = useState([]) // [{ event, count }]

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const now = new Date()
        const nowMs = now.getTime()
        const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000)
        const todayStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        ).getTime()
        const last10StartMs = nowMs - 10 * 60 * 1000
        const last5StartMs = nowMs - 5 * 60 * 1000

        // 1) visitor_logs (last 30 days)
        const { data: logs, error: logsError } = await supabase
          .from("visitor_logs")
          .select("local_time, ip, country")
          .gte("local_time", thirtyDaysAgo.toISOString())
          .order("local_time", { ascending: true })

        if (logsError) throw logsError

        const minuteBuckets = new Array(10).fill(0)
        const hourlyBuckets = new Array(24).fill(0)
        const dateMap = new Map()
        const countryMap = new Map()
        const visitorsNowSet = new Set()

        for (const log of logs || []) {
          const t = new Date(log.local_time)
          const ts = t.getTime()
          if (Number.isNaN(ts)) continue

          // last 10 minutes
          if (ts >= last10StartMs && ts <= nowMs) {
            const diffMin = Math.floor((nowMs - ts) / 60000) // 0..9
            const bucketIndex = 9 - diffMin
            if (bucketIndex >= 0 && bucketIndex < 10) {
              minuteBuckets[bucketIndex] += 1
            }
          }

          // visitors right now = last 5 min unique ip
          if (ts >= last5StartMs && ts <= nowMs && log.ip) {
            visitorsNowSet.add(log.ip)
          }

          // today hourly
          if (ts >= todayStart) {
            const h = t.getHours()
            if (h >= 0 && h < 24) hourlyBuckets[h] += 1
          }

          // last 30 days per date
          const dateStr = t.toISOString().slice(0, 10)
          dateMap.set(dateStr, (dateMap.get(dateStr) || 0) + 1)

          // country 聚合：这里不假设一定是 ISO2，只做 normalize
          if (log.country) {
            const key = normalizeKey(log.country)
            if (key) {
              countryMap.set(key, (countryMap.get(key) || 0) + 1)
            }
          }
        }

        const last30 = Array.from(dateMap.entries())
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([date, count]) => ({ date, count }))

        const countries = Array.from(countryMap.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => ({ key, count }))

        // 2) visitor_clicks (last 30 days)
        const { data: clicks, error: clicksError } = await supabase
          .from("visitor_clicks")
          .select("click_event, target_url, local_time")
          .gte("local_time", thirtyDaysAgo.toISOString())

        if (clicksError) throw clicksError

        const pageMap = new Map()
        const eventMap = new Map()

        for (const c of clicks || []) {
          if (c.target_url) {
            const u = c.target_url
            pageMap.set(u, (pageMap.get(u) || 0) + 1)
          }
          if (c.click_event) {
            const e = c.click_event
            eventMap.set(e, (eventMap.get(e) || 0) + 1)
          }
        }

        const pages = Array.from(pageMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([url, count]) => ({ url, count }))

        const events = Array.from(eventMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([event, count]) => ({ event, count }))

        setVisitorsNow(visitorsNowSet.size)
        setLast10MinutesBuckets(minuteBuckets)
        setLast30DaysBuckets(last30)
        setTodayHourlyBuckets(hourlyBuckets)
        setCountryCounts(countries)
        setTopPages(pages)
        setTopEvents(events)
        setError(null)
      } catch (err) {
        console.error("Failed to load visitors page data", err)
        setError("Unable to load visitor statistics")
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const last10Total = useMemo(
    () => last10MinutesBuckets.reduce((sum, v) => sum + v, 0),
    [last10MinutesBuckets]
  )

  const todayTotal = useMemo(
    () => todayHourlyBuckets.reduce((sum, v) => sum + v, 0),
    [todayHourlyBuckets]
  )

  const last30Total = useMemo(
    () => last30DaysBuckets.reduce((sum, b) => sum + (b.count || 0), 0),
    [last30DaysBuckets]
  )

  const last10Bars = useMemo(() => {
    if (!last10MinutesBuckets.length) return []
    const max = Math.max(...last10MinutesBuckets)
    if (max <= 0) return []
    return last10MinutesBuckets.map((v, idx) => ({
      id: idx,
      height: (v / max) * 100,
    }))
  }, [last10MinutesBuckets])

  const last30Bars = useMemo(() => {
    if (!last30DaysBuckets.length) return []
    const max = Math.max(...last30DaysBuckets.map((b) => b.count || 0))
    if (max <= 0) return []
    return last30DaysBuckets.map((b) => ({
      date: b.date,
      height: (b.count / max) * 100,
    }))
  }, [last30DaysBuckets])

  const maxCountryCount = useMemo(
    () => (countryCounts.length ? countryCounts[0].count : 0),
    [countryCounts]
  )

  const getCountryFill = (count) => {
    if (!count || maxCountryCount <= 0) return "#f3f4f6"
    const ratio = count / maxCountryCount
    if (ratio < 0.2) return "#dbeafe"
    if (ratio < 0.4) return "#bfdbfe"
    if (ratio < 0.6) return "#93c5fd"
    if (ratio < 0.8) return "#60a5fa"
    return "#2563eb"
  }

  // 核心修复：对每个 polygon 从 properties 生成多个候选 key，和 countryCounts 做模糊匹配
  const getGeoCount = (geo) => {
    if (!countryCounts.length) return 0
    const props = geo.properties || {}

    const candidatesRaw = [
      props.ISO_A2 || props.iso_a2,
      props.ISO_A3 || props.iso_a3,
      props.NAME || props.name,
      props.ADMIN,
    ].filter(Boolean)

    if (!candidatesRaw.length) return 0

    const candidateKeys = candidatesRaw.map(normalizeKey)

    for (const c of countryCounts) {
      const ck = normalizeKey(c.key)
      if (!ck) continue
      for (const cand of candidateKeys) {
        if (!cand) continue
        if (cand === ck || cand.includes(ck) || ck.includes(cand)) {
          return c.count
        }
      }
    }
    return 0
  }

  return (
    <main className="visitors-wrapper">
      <div className="visitors-inner">
        <header className="visitors-header">
          <h1>Visitors</h1>
          <span className="sub">Live &amp; last 30 days</span>
        </header>

        {loading ? (
          <div className="state-row">Loading visitor data…</div>
        ) : error ? (
          <div className="state-row error">{error}</div>
        ) : (
          <>
            {/* TOP STRIP */}
            <section className="top-strip">
              <div className="now-card">
                <div className="now-main">
                  <div className="now-count">{visitorsNow}</div>
                  <div className="now-label">visitors right now</div>
                </div>
                <div className="now-sub-metrics">
                  <div>
                    <span className="metric-label">LAST 10 MIN</span>
                    <span className="metric-value">
                      {last10Total > 0 ? last10Total : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="metric-label">TODAY</span>
                    <span className="metric-value">
                      {todayTotal > 0 ? todayTotal : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="metric-label">LAST 30 DAYS</span>
                    <span className="metric-value">
                      {last30Total > 0 ? last30Total : "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mini-card">
                <div className="mini-header">
                  <div className="mini-title">LAST 10 MINUTES</div>
                  <div className="mini-number">
                    {last10Total > 0 ? last10Total : "—"}
                  </div>
                </div>
                <div className="mini-chart bars">
                  {last10Bars.length === 0 ? (
                    <span className="mini-empty">No activity</span>
                  ) : (
                    last10Bars.map((b) => (
                      <div key={b.id} className="mini-bar-wrap">
                        <div
                          className="mini-bar"
                          style={{ height: `${b.height}%` }}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mini-card">
                <div className="mini-header">
                  <div className="mini-title">LAST 30 DAYS</div>
                  <div className="mini-number">
                    {last30Total > 0 ? last30Total : "—"}
                  </div>
                </div>
                <div className="mini-chart bars">
                  {last30Bars.length === 0 ? (
                    <span className="mini-empty">No visits</span>
                  ) : (
                    last30Bars.map((b) => (
                      <div key={b.date} className="mini-bar-wrap">
                        <div
                          className="mini-bar"
                          style={{ height: `${b.height}%` }}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            {/* MAIN: big world map + bottom row */}
            <section className="main-grid">
              <div className="panel geo-panel">
                <div className="panel-header">
                  <h2>GEOGRAPHY</h2>
                </div>

                <div className="geo-map-wrapper">
                  <ComposableMap
                    projectionConfig={{ scale: 155 }}
                    height={320}
                    style={{ width: "100%", height: "auto" }}
                  >
                    <Geographies geography={geoUrl}>
                      {({ geographies }) =>
                        geographies.map((geo) => {
                          const count = getGeoCount(geo)
                          const fill = getCountryFill(count)
                          return (
                            <Geography
                              key={geo.rsmKey}
                              geography={geo}
                              style={{
                                default: { outline: "none" },
                                hover: { outline: "none" },
                                pressed: { outline: "none" },
                              }}
                              fill={fill}
                              stroke="#e5e7eb"
                              strokeWidth={0.4}
                            />
                          )
                        })
                      }
                    </Geographies>
                  </ComposableMap>
                  <div className="geo-legend">
                    <span>Low</span>
                    <div className="legend-bar">
                      <span className="grad grad-1" />
                      <span className="grad grad-2" />
                      <span className="grad grad-3" />
                      <span className="grad grad-4" />
                      <span className="grad grad-5" />
                    </div>
                    <span>High</span>
                  </div>
                </div>

                <div className="geo-list">
                  <div className="geo-list-title">Top countries</div>
                  <ul className="list">
                    {countryCounts.length === 0 && (
                      <li className="empty">No country data</li>
                    )}
                    {countryCounts.slice(0, 12).map((c) => (
                      <li key={c.key} className="list-row">
                        <div className="list-label-wrapper">
                          <span className="list-label">{c.key}</span>
                          <div className="list-bar-bg">
                            <div
                              className="list-bar-fill"
                              style={{
                                width:
                                  maxCountryCount > 0
                                    ? `${(c.count / maxCountryCount) * 100}%`
                                    : "0%",
                              }}
                            />
                          </div>
                        </div>
                        <span className="list-value">{c.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="bottom-row">
                <div className="panel">
                  <div className="panel-header">
                    <h2>TOP PAGES</h2>
                  </div>
                  <table className="table">
                    <tbody>
                    {topPages.length === 0 && (
                      <tr>
                        <td className="empty" colSpan={2}>
                          No clicks recorded
                        </td>
                      </tr>
                    )}
                    {topPages.map((p) => (
                      <tr key={p.url}>
                        <td className="table-label">
                          <span className="url">{p.url}</span>
                        </td>
                        <td className="table-value">{p.count}</td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                </div>

                <div className="panel">
                  <div className="panel-header">
                    <h2>TOP EVENTS</h2>
                  </div>
                  <table className="table">
                    <tbody>
                    {topEvents.length === 0 && (
                      <tr>
                        <td className="empty" colSpan={2}>
                          No events recorded
                        </td>
                      </tr>
                    )}
                    {topEvents.map((e) => (
                      <tr key={e.event}>
                        <td className="table-label">
                          <span>{e.event}</span>
                        </td>
                        <td className="table-value">{e.count}</td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      <style jsx>{`
        .visitors-wrapper {
          --bg: #f5f7fb;
          --panel-bg: #ffffff;
          --border: rgba(15, 23, 42, 0.08);
          --shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
          --heading: #111827;
          --text-main: #111827;
          --text-sub: #6b7280;
          --accent: #2563eb;
          --accent-soft: rgba(37, 99, 235, 0.08);
          --accent-strong: rgba(37, 99, 235, 0.18);
          --danger: #ef4444;
          --radius-lg: 16px;

          min-height: 100vh;
          padding: 2.5rem 0;
          background: var(--bg);
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
            sans-serif;
        }

        :global(body.dark-skin) .visitors-wrapper {
          --bg: #020617;
          --panel-bg: #020617;
          --border: rgba(148, 163, 184, 0.3);
          --shadow: 0 18px 32px rgba(15, 23, 42, 0.8);
          --heading: #e5e7eb;
          --text-main: #e5e7eb;
          --text-sub: #9ca3af;
          --accent: #60a5fa;
          --accent-soft: rgba(37, 99, 235, 0.18);
          --accent-strong: rgba(37, 99, 235, 0.35);
        }

        .visitors-inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 1.5rem;
        }

        .visitors-header {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          margin-bottom: 1.75rem;
        }

        .visitors-header h1 {
          margin: 0;
          font-size: 1.6rem;
          font-weight: 600;
          color: var(--heading);
        }

        .visitors-header .sub {
          font-size: 0.85rem;
          color: var(--text-sub);
        }

        .state-row {
          padding: 1rem 1.25rem;
          border-radius: var(--radius-lg);
          background: var(--panel-bg);
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
          font-size: 0.9rem;
          color: var(--text-sub);
        }

        .state-row.error {
          border-color: var(--danger);
          color: var(--danger);
        }

        .top-strip {
          display: grid;
          grid-template-columns: 1.4fr 1fr 1fr;
          gap: 1rem;
          margin-bottom: 1.75rem;
        }

        .now-card,
        .mini-card {
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
          padding: 1rem 1.25rem;
          display: flex;
          flex-direction: column;
        }

        .now-main {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }

        .now-count {
          font-size: 2.5rem;
          font-weight: 700;
          color: var(--heading);
        }

        .now-label {
          font-size: 0.9rem;
          color: var(--text-sub);
        }

        .now-sub-metrics {
          margin-top: 0.75rem;
          display: flex;
          gap: 1.25rem;
          font-size: 0.8rem;
        }

        .metric-label {
          color: var(--text-sub);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          font-size: 0.7rem;
        }

        .metric-value {
          color: var(--text-main);
          font-weight: 600;
        }

        .mini-card {
          gap: 0.5rem;
        }

        .mini-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
        }

        .mini-title {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-sub);
          letter-spacing: 0.08em;
        }

        .mini-number {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-main);
        }

        .mini-chart.bars {
          margin-top: 0.2rem;
          height: 52px;
          display: flex;
          align-items: flex-end;
          gap: 3px;
        }

        .mini-bar-wrap {
          flex: 1;
          min-width: 2px;
          border-radius: 999px;
          background: var(--accent-soft);
          overflow: hidden;
        }

        .mini-bar {
          width: 100%;
          background: linear-gradient(180deg, var(--accent), #4f46e5);
          border-radius: 999px 999px 0 0;
          transition: height 0.25s ease-out;
        }

        :global(body.dark-skin) .mini-bar {
          background: linear-gradient(180deg, var(--accent), #6366f1);
        }

        .mini-empty {
          font-size: 0.75rem;
          color: var(--text-sub);
        }

        .main-grid {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .panel {
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
          padding: 1rem 1.25rem 0.75rem;
          display: flex;
          flex-direction: column;
        }

        .panel-header h2 {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--heading);
          letter-spacing: 0.08em;
        }

        .geo-map-wrapper {
          border-radius: 12px;
          background: #f9fafb;
          padding: 0.75rem;
          border: 1px solid rgba(148, 163, 184, 0.3);
          margin-bottom: 0.9rem;
        }

        :global(body.dark-skin) .geo-map-wrapper {
          background: #020617;
          border-color: rgba(148, 163, 184, 0.5);
        }

        .geo-legend {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 0.4rem;
          font-size: 0.75rem;
          color: var(--text-sub);
        }

        .legend-bar {
          display: flex;
          gap: 2px;
          height: 6px;
        }

        .legend-bar .grad {
          width: 16px;
          border-radius: 999px;
        }

        .grad-1 {
          background: #dbeafe;
        }
        .grad-2 {
          background: #bfdbfe;
        }
        .grad-3 {
          background: #93c5fd;
        }
        .grad-4 {
          background: #60a5fa;
        }
        .grad-5 {
          background: #2563eb;
        }

        .geo-list {
          margin-top: 0.25rem;
        }

        .geo-list-title {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-sub);
          margin-bottom: 0.35rem;
        }

        .list {
          list-style: none;
          padding: 0;
          margin: 0;
          font-size: 0.83rem;
        }

        .list-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.25rem 0;
          gap: 0.75rem;
        }

        .list-label-wrapper {
          flex: 1;
          min-width: 0;
        }

        .list-label {
          display: block;
          color: var(--text-main);
          margin-bottom: 0.1rem;
        }

        .list-bar-bg {
          height: 4px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.25);
          overflow: hidden;
        }

        .list-bar-fill {
          height: 100%;
          border-radius: 999px;
          background: var(--accent-strong);
        }

        .list-value {
          color: var(--text-main);
          font-variant-numeric: tabular-nums;
        }

        .bottom-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.83rem;
        }

        .table tr + tr {
          border-top: 1px solid rgba(148, 163, 184, 0.2);
        }

        .table-label {
          padding: 0.25rem 0.1rem 0.25rem 0;
        }

        .table-value {
          padding: 0.25rem 0 0.25rem 0.5rem;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .url {
          word-break: break-all;
          color: var(--text-main);
        }

        @media (max-width: 1024px) {
          .top-strip {
            grid-template-columns: 1fr;
          }
          .bottom-row {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .visitors-inner {
            padding: 0 1rem;
          }
          .now-sub-metrics {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </main>
  )
}

export default VisitorsPage
