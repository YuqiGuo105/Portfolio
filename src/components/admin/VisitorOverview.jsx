import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, BarChart3, ChevronDown, Globe2, Monitor, Link2, FileText, RotateCcw, X } from "lucide-react";
import styles from "./VisitorOverview.module.css";

const WINDOWS = [[24, "24 hours"], [168, "7 days"], [720, "30 days"]];
const TRAFFIC = [["ALL", "All traffic"], ["EXCLUDE", "Likely people"], ["ONLY", "Bots"]];
const METRICS = [["events", "Events"], ["pageViews", "Page views"], ["sessions", "Sessions"]];
const format = value => Number(value || 0).toLocaleString("en-US");
const date = (value, hourly = false) => new Date(value).toLocaleString("en-US", {
  timeZone: "UTC", month: "short", day: "numeric", ...(hourly ? { hour: "numeric", minute: "2-digit", hour12: false } : {}),
});

export default function VisitorOverview({ api, filters, range, onWindow, onFilter, onReset }) {
  const [request, setRequest] = useState({ loading: true, data: null, error: "" });
  const [retry, setRetry] = useState(0);
  const [metric, setMetric] = useState("events");
  const [collapsed, setCollapsed] = useState({});
  const overviewId = useId();
  const metricsId = useId();
  const trendId = useId();
  const toggle = key => setCollapsed(current => ({ ...current, [key]: !current[key] }));
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setRequest({ loading: true, data: null, error: "" });
    Promise.resolve().then(() => api.visitors.overview({ ...filters, ...range }, { signal: controller.signal }))
      .then(data => { if (current) setRequest({ loading: false, data, error: "" }); })
      .catch(error => { if (current) setRequest({ loading: false, data: null, error: error.message || "Overview unavailable." }); });
    return () => { current = false; controller.abort(); };
  }, [api, filters, range, retry]);
  const active = Object.entries(filters).filter(([key, value]) => key !== "bot" && key !== "includeAdmin" && value);
  const { data, loading, error } = request;
  const summary = data?.summary;
  return <section className={styles.overview} aria-label="Visitor analytics">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>AUDIENCE OVERVIEW</span><h2>Traffic at a glance</h2></div>
      <div className={styles.headingActions}>
      <div className={styles.segmented} role="group" aria-label="Analytics time range" hidden={collapsed.overview}>
        {WINDOWS.map(([value, label]) => <button type="button" key={value} aria-pressed={range.hours === value} onClick={() => onWindow(value)}>{label}</button>)}
      </div>
      <button type="button" className={styles.overviewToggle} aria-expanded={!collapsed.overview}
        aria-controls={overviewId} aria-label={`${collapsed.overview ? "Expand" : "Collapse"} traffic overview`}
        title={`${collapsed.overview ? "Expand" : "Collapse"} traffic overview`} onClick={() => toggle("overview")}>
        <ChevronDown size={18} className={collapsed.overview ? styles.closedChevron : undefined} aria-hidden="true" />
      </button>
      </div>
    </div>
    {collapsed.overview && <p className={styles.collapsedSummary}>
      {WINDOWS.find(([value]) => value === range.hours)?.[1] || `${range.hours} hours`} · {TRAFFIC.find(([value]) => value === filters.bot)?.[1] || "All traffic"}
      {loading ? " · Updating..." : error ? " · Overview unavailable" : summary ? ` · ${format(summary.events)} events · ${format(summary.sessions)} sessions` : ""}
      {active.length > 0 ? ` · ${active.length} active ${active.length === 1 ? "filter" : "filters"}` : ""}
    </p>}
    <div id={overviewId} hidden={collapsed.overview}>
    <div className={styles.scope}>
      <div className={styles.segmented} role="group" aria-label="Analytics traffic filter">
        {TRAFFIC.map(([value, label]) => <button type="button" key={value} aria-pressed={filters.bot === value} onClick={() => onFilter({ bot: value })}>{label}</button>)}
      </div>
      <span>{filters.includeAdmin ? "Admin pages included" : "Public pages"} <span aria-hidden="true">·</span> UTC</span>
    </div>
    {active.length > 0 && <div className={styles.filters} aria-label="Applied analytics filters">
      {active.map(([key, value]) => <button type="button" key={key} onClick={() => onFilter({ [key]: "" })} title={`Remove ${key} filter`}><span>{key}: {value}</span><X size={13} /></button>)}
      <button type="button" onClick={onReset}>Clear filters</button>
    </div>}
    <div aria-busy={loading}>
      {loading ? <div className={styles.state} role="status">Loading traffic overview...</div>
        : error ? <div className={styles.state} role="alert"><strong>Overview unavailable</strong><span>{error}</span><button type="button" onClick={() => setRetry(v => v + 1)}><RotateCcw size={14} /> Retry overview</button></div>
        : summary && <>
          <section className={styles.metricsSection} aria-label="Key metrics">
          <SectionHeading title="Key metrics" expanded={!collapsed.metrics} controls={metricsId} onToggle={() => toggle("metrics")} />
          <div className={styles.metrics} id={metricsId} hidden={collapsed.metrics}>
            <Stat label="Events" value={summary.events} note="All matching activity" />
            <Stat label="Page views" value={summary.pageViews} note="Page loads, not read checkpoints" />
            <Stat label="Sessions" value={summary.sessions} note="Distinct session IDs, not people" />
            <Stat label="Countries" value={summary.countries} note="Known locations" />
          </div>
          </section>
          {summary.events === 0 ? <div className={styles.state}><strong>No traffic in this view</strong><span>There are no matching events for this time range.</span>{(active.length > 0 || filters.bot !== "ALL") && <button type="button" onClick={onReset}>Clear filters</button>}</div> : <>
            <div className={styles.charts}>
              <section className={styles.trend} aria-label="Activity over time">
                <div className={styles.chartHeading}>
                  <SectionHeading title="Activity over time" icon={BarChart3} expanded={!collapsed.trend} controls={trendId} onToggle={() => toggle("trend")} />
                  <div className={styles.segmented} role="group" aria-label="Trend metric" hidden={collapsed.trend}>{METRICS.map(([key, label]) => <button key={key} type="button" onClick={() => setMetric(key)} aria-pressed={metric === key}>{label}</button>)}</div>
                </div>
                <div id={trendId} hidden={collapsed.trend}>
                <Trend key={`${data.from}-${metric}`} timeline={data.timeline || []} metric={metric} hourly={data.bucket === "hour"} />
                </div>
              </section>
              <Traffic summary={summary} expanded={!collapsed.traffic} onToggle={() => toggle("traffic")} />
            </div>
            <div className={styles.rankings}>
              <Ranking title="Top pages" icon={FileText} rows={data.rankings?.pages} denominator={summary.pageViews} unit="page views" onSelect={value => onFilter({ path: value })} expanded={!collapsed.pages} onToggle={() => toggle("pages")} />
              <Ranking title="Top sources" icon={Link2} rows={data.rankings?.referrers} denominator={summary.events} unit="events" onSelect={value => onFilter({ referrer: value })} expanded={!collapsed.sources} onToggle={() => toggle("sources")} />
              <Ranking title="Top countries" icon={Globe2} rows={data.rankings?.countries} denominator={summary.events} unit="events" onSelect={value => onFilter({ country: value })} expanded={!collapsed.countries} onToggle={() => toggle("countries")} />
              <Ranking title="Devices" icon={Monitor} rows={data.rankings?.devices} denominator={summary.events} unit="events" onSelect={value => onFilter({ device: value })} expanded={!collapsed.devices} onToggle={() => toggle("devices")} />
            </div>
          </>}
          <p className={styles.footnote}>{date(data.from, true)} - {date(data.to, true)} UTC. Retained events in this window; boundary buckets may be partial.</p>
        </>}
    </div>
    </div>
  </section>;
}

function SectionHeading({ title, icon: Icon, expanded, controls, onToggle }) {
  return <h3 className={styles.sectionTitle}>
    <button type="button" className={styles.disclosure} aria-expanded={expanded} aria-controls={controls}
      title={`${expanded ? "Collapse" : "Expand"} ${title.toLowerCase()}`} onClick={onToggle}>
      <span>{Icon && <Icon size={16} aria-hidden="true" />}{title}</span>
      <ChevronDown size={16} className={expanded ? undefined : styles.closedChevron} aria-hidden="true" />
    </button>
  </h3>;
}

function Stat({ label, value, note }) {
  return <div className={styles.stat}><span>{label}</span><strong>{format(value)}</strong><small>{note}</small></div>;
}

function Trend({ timeline, metric, hourly }) {
  const [selected, setSelected] = useState(null);
  const chartRef = useRef(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    if (!chartRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, [timeline.length]);
  const max = Math.max(1, ...timeline.map(item => Number(item[metric] || 0)));
  const peak = useMemo(() => timeline.reduce((best, item) => !best || item[metric] > best[metric] ? item : best, null), [timeline, metric]);
  const shown = timeline[selected] || peak;
  const label = METRICS.find(([key]) => key === metric)[1];
  const height = 190, left = 34, top = 12, bottom = 32;
  const plotWidth = width - left - 12, plotHeight = height - top - bottom;
  const x = i => left + i * plotWidth / Math.max(1, timeline.length - 1);
  const y = value => top + plotHeight * (1 - value / max);
  const points = timeline.map((item, i) => `${x(i)},${y(item[metric] || 0)}`).join(" ");
  const ticks = [...new Set([0, Math.floor((timeline.length - 1) / 2), timeline.length - 1])].filter(i => i >= 0 && i < timeline.length);
  if (!timeline.length) return <p className={styles.meta}>Trend data unavailable.</p>;
  return <>
    <div className={styles.chartReadout} aria-live="polite"><span>{selected == null ? "Peak" : "Selected"} {hourly ? "hour" : "day"}</span><strong>{format(shown?.[metric])} {label.toLowerCase()}</strong><span>{shown ? date(shown.time, hourly) : ""} UTC</span></div>
    <svg ref={chartRef} viewBox={`0 0 ${width} ${height}`} className={styles.chart} role="group" aria-label={`${label} trend in UTC`} onMouseLeave={() => setSelected(null)}>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1={left} x2={width - 12} y1={y(max * fraction)} y2={y(max * fraction)} stroke="#e5ece9" /><text x={left - 8} y={y(max * fraction) + 4} textAnchor="end">{format(Math.ceil(max * fraction))}</text></g>)}
      {timeline.length > 1 && <polygon points={`${left},${y(0)} ${points} ${x(timeline.length - 1)},${y(0)}`} fill="#e8f5f0" />}
      <polyline points={points} fill="none" stroke="#168364" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {selected != null && timeline[selected] && <g><line x1={x(selected)} x2={x(selected)} y1={top} y2={y(0)} stroke="#8daba0" strokeDasharray="4 4" /><circle cx={x(selected)} cy={y(timeline[selected][metric])} r="4" fill="#168364" stroke="white" strokeWidth="2" /></g>}
      {ticks.map(i => <text key={i} x={x(i)} y={height - 5} textAnchor={i === 0 ? "start" : i === timeline.length - 1 ? "end" : "middle"}>{hourly ? new Date(timeline[i].time).toISOString().slice(11, 16) : date(timeline[i].time)}</text>)}
      {timeline.map((item, i) => <rect key={item.time} x={Math.max(left, x(i) - plotWidth / timeline.length / 2)} y={top} width={plotWidth / timeline.length} height={plotHeight} fill="transparent" tabIndex={0} role="button" aria-label={`${date(item.time, true)} UTC: ${format(item[metric])} ${label.toLowerCase()}`} onMouseEnter={() => setSelected(i)} onFocus={() => setSelected(i)} onBlur={() => setSelected(null)} onClick={() => setSelected(i)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(i); } }} />)}
    </svg>
  </>;
}

function Traffic({ summary, expanded, onToggle }) {
  const contentId = useId();
  const parts = [["likelyPeople", "Likely people", "#168364"], ["bots", "Bots", "#bc7419"], ["unknown", "Unclassified", "#a6afb8"]];
  return <section className={styles.traffic} aria-label="Traffic composition">
    <SectionHeading title="Traffic composition" expanded={expanded} controls={contentId} onToggle={onToggle} />
    <div id={contentId} hidden={!expanded}><span className={styles.meta}>Share of matching events</span>
    <div className={styles.stacked} role="img" aria-label={parts.map(([key, label]) => `${label}: ${format(summary[key])}`).join(", ")}>{parts.map(([key, label, color]) => <span key={key} title={label} style={{ width: `${100 * summary[key] / Math.max(1, summary.events)}%`, background: color }} />)}</div>
    <dl>{parts.map(([key, label, color]) => <div key={key}><dt><i style={{ background: color }} />{label}</dt><dd>{format(summary[key])}<span>{Math.round(100 * summary[key] / Math.max(1, summary.events))}%</span></dd></div>)}</dl>
    <p className={styles.footnote}>Classification is an estimate, not proof of a human visitor.</p>
    </div>
  </section>;
}

function Ranking({ title, icon, rows = [], denominator, unit, onSelect, expanded, onToggle }) {
  const contentId = useId();
  return <section className={styles.ranking} aria-label={title}>
    <SectionHeading title={title} icon={icon} expanded={expanded} controls={contentId} onToggle={onToggle} />
    <div id={contentId} hidden={!expanded}><span className={styles.meta}>Top 5 · {unit}</span>
    <ol>{rows.map((row, index) => {
      const label = row.value || "Unknown";
      const share = Math.round(100 * row.count / Math.max(1, denominator));
      const clickable = Boolean(row.value) && row.value !== "Direct" && row.value !== "/";
      const content = <><span className={styles.rankIndex}>{index + 1}</span><span className={styles.rankLabel} title={label}>{label}</span><strong>{format(row.count)}</strong><span className={styles.share}>{share}%</span>{clickable && <ArrowUpRight size={12} />}<span className={styles.rankBar} style={{ width: `${share}%` }} /></>;
      return <li key={`${label}-${index}`}>{clickable ? <button type="button" title={`Filter matching records: ${label}`} onClick={() => onSelect(row.value)}>{content}</button> : <div className={styles.rankRow}>{content}</div>}</li>;
    })}</ol>{rows.length === 0 && <p className={styles.meta}>No data</p>}
    </div>
  </section>;
}
