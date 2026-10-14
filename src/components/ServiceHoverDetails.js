import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Clock3, Github, Activity, Server, X, RotateCw } from "lucide-react";
import { getServiceMetadata, GRAFANA_PUBLIC_URL, memorySize, metricNumber, processAge } from "../lib/serviceCatalog.mjs";
import styles from "./ServiceHoverDetails.module.css";

const detailCache = new Map();
const FRESH_MS = 60_000;
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const formatTime = value => value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Not reported";

function RequestHistory({ points = [] }) {
  const valid = points.filter(p => typeof p.v === "number" && Number.isFinite(p.v));
  if (valid.length < 2) return <div className={styles.noHistory}>No recent HTTP samples</div>;
  const start = points[0].t, span = points[points.length - 1].t - start || 1;
  const ceiling = Math.max(...valid.map(p => p.v), 0.01);
  let previous = null;
  const path = points.map(p => {
    if (p.v == null) { previous = null; return ""; }
    const command = previous && p.t - previous.t <= 240_000 ? "L" : "M";
    previous = p;
    return `${command}${(4 + (p.t - start) / span * 392).toFixed(1)},${(53 - p.v / ceiling * 44).toFixed(1)}`;
  }).join(" ");
  return <svg className={styles.chart} viewBox="0 0 400 58" preserveAspectRatio="none" role="img" aria-label="This service's HTTP request rate over the last hour">
    <path d="M0 15H400 M0 35H400 M0 55H400" className={styles.gridline} />
    <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

function Metric({ label, compactLabel, value, title }) {
  return <div className={styles.metric} title={title || label}><dt aria-label={compactLabel ? label : undefined}>{compactLabel || label}</dt><dd>{value}</dd></div>;
}

function DetailContent({ service, summaryAt, payload, loading, failed, retry }) {
  const meta = getServiceMetadata(service.job);
  const m = payload?.metrics || {};
  const heapPct = m.heapMaxBytes > 0 && m.heapUsedBytes != null ? m.heapUsedBytes / m.heapMaxBytes * 100 : service.heapPct;
  const heap = m.heapUsedBytes == null ? "N/A" : `${memorySize(m.heapUsedBytes)} / ${memorySize(m.heapMaxBytes)}`;
  return <>
    <p className={styles.purpose}>{meta.purpose}</p>
    <p className={styles.stack}>{meta.stack.join(" · ")}</p>
    <dl className={styles.primary} aria-busy={loading}>
      <Metric label="Mean response" value={metricNumber(m.meanLatencyMs, 1, " ms")} title="5-minute request-weighted mean, not P95; includes health and metrics endpoints" />
      <Metric label="Heap used" value={metricNumber(heapPct, 1, "%")} />
      <Metric label="Requests / sec" value={metricNumber(m.reqPerSec ?? service.reqPerSec, 2)} title="5-minute average; includes monitoring traffic" />
    </dl>
    <div className={styles.history}>
      <div className={styles.historyHeading}><span><Activity size={14} />HTTP requests</span><span>Last hour · 2m samples</span></div>
      {loading && !payload ? <div className={styles.noHistory}>Loading Grafana samples...</div> : <RequestHistory points={payload?.requests} />}
    </div>
    <dl className={styles.detailGrid} aria-busy={loading}>
      <Metric label={m.cpuPct != null || m.systemCpuPct == null ? "Process CPU" : "System CPU"} compactLabel={m.cpuPct != null || m.systemCpuPct == null ? "CPU" : "System CPU"} value={metricNumber(m.cpuPct ?? m.systemCpuPct, 1, "%")} title={m.cpuPct != null || m.systemCpuPct == null ? "Process CPU: average across sampled processes; N/A if unavailable" : "System CPU reported by the JVM; not container CPU utilization"} />
      <Metric label="5xx / sec · 5m" compactLabel="5xx / sec" value={metricNumber(m.serverErrorsPerSec, 3)} />
      <Metric label="Heap used / limit" compactLabel="Heap" value={heap} title="Heap used / limit: summed across sampled JVMs; positive pool limits only" />
      <Metric label="Non-heap used" compactLabel="Non-heap" value={memorySize(m.nonHeapUsedBytes)} />
      <Metric label="Threads live / peak" compactLabel="Threads" value={`${metricNumber(m.threads ?? service.threads, 0)} / ${metricNumber(m.peakThreads, 0)}`} title="Threads live / peak: sum across sampled JVMs; peak is since each process started" />
      <Metric label="GC mean pause · 5m" compactLabel="GC pause" value={metricNumber(m.gcMeanPauseMs, 1, " ms")} title="GC mean pause over 5 minutes; N/A when no garbage collections were observed" />
      <Metric label="Process uptime" compactLabel="Uptime" value={processAge(m.uptimeSeconds ?? service.uptimeSeconds)} title="Oldest sampled process age, not service availability" />
      <Metric label="DB pool active / max" compactLabel="DB pool" value={`${metricNumber(m.poolActive, 0)} / ${metricNumber(m.poolMax, 0)}`} title="DB pool active / max: reported HikariCP connections; N/A for services without this metric" />
    </dl>
    {failed && <div className={styles.notice} role="status"><span>Extra metrics unavailable. Summary retained.</span><button type="button" onClick={retry} aria-label="Retry service metrics" title="Retry service metrics"><RotateCw size={14} /></button></div>}
    {payload?.stale && <p className={styles.notice}>Cached sample. Grafana is temporarily unavailable.</p>}
    {payload?.partial && <p className={styles.notice}>Request history is temporarily unavailable.</p>}
    <p className={styles.footnote}>HTTP includes monitoring traffic. N/A means no reported sample.</p>
    <div className={styles.observed}><Clock3 size={12} /><span>{payload ? "Queried" : "Summary"} {formatTime(payload?.capturedAt || summaryAt)}{m.sampleAtSeconds ? ` · Scraped ${formatTime(m.sampleAtSeconds * 1000)}` : ""}</span></div>
  </>;
}

// A single floating element serves all cards; no polling or per-card observers.
export function useServiceHoverDetails(services, summaryAt) {
  const [active, setActive] = useState(null);
  const [detail, setDetail] = useState({ job: null, payload: null, loading: false, failed: false });
  const [attempt, setAttempt] = useState(0);
  const [position, setPosition] = useState({ top: 12, left: 12, ready: false });
  const floating = useRef(null), trigger = useRef(null), timers = useRef({});
  const activeRef = useRef(null), pointerFocus = useRef(false), ignoreFocus = useRef(false);
  const service = services.find(item => item.job === active?.job);
  const meta = getServiceMetadata(active?.job);
  const clearTimers = useCallback(() => { clearTimeout(timers.current.open); clearTimeout(timers.current.close); }, []);
  const close = useCallback((restore = false) => {
    clearTimers(); activeRef.current = null; setActive(null);
    if (restore && trigger.current?.isConnected) { ignoreFocus.current = true; trigger.current.focus(); ignoreFocus.current = false; }
  }, [clearTimers]);
  const open = (svc, element, pinned = false) => {
    clearTimers();
    if (!getServiceMetadata(svc.job)) return;
    trigger.current = element;
    const next = { job: svc.job, pinned };
    activeRef.current = next; setActive(next);
  };
  const scheduleClose = () => {
    clearTimeout(timers.current.open);
    if (activeRef.current?.pinned) return;
    clearTimeout(timers.current.close);
    timers.current.close = setTimeout(() => {
      if (floating.current?.contains(document.activeElement)) return;
      close();
    }, 280);
  };
  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (!active?.job) return;
    const job = active.job, cached = detailCache.get(job);
    if (cached && Date.now() - cached.at < FRESH_MS) {
      setDetail({ job, payload: cached.payload, loading: false, failed: false }); return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 8000);
    setDetail({ job, payload: cached?.payload || null, loading: true, failed: false });
    fetch(`/api/metrics/service?job=${encodeURIComponent(job)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Unavailable");
      const payload = await response.json();
      if (payload.job !== job || !payload.metrics) throw new Error("Invalid response");
      if (!payload.stale && !payload.partial) detailCache.set(job, { at: Date.parse(payload.capturedAt) || Date.now(), payload });
      if (!cancelled) setDetail({ job, payload, loading: false, failed: false });
    }).catch(() => {
      if (!cancelled) setDetail({ job, payload: cached?.payload ? { ...cached.payload, stale: true } : null, loading: false, failed: true });
    }).finally(() => clearTimeout(timeout));
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [active?.job, attempt]);

  useClientLayoutEffect(() => {
    if (!active || !floating.current || !trigger.current) return;
    const place = () => {
      const anchor = trigger.current.getBoundingClientRect(), panel = floating.current.getBoundingClientRect();
      // Leave room for the existing Mr. Pot launcher without changing its layer.
      const width = document.documentElement.clientWidth, height = window.innerHeight - 88;
      let left = anchor.right + 12, top = anchor.top;
      if (left + panel.width > width - 12) left = anchor.left - panel.width - 12;
      if (left < 12) {
        left = Math.min(Math.max(12, anchor.left), width - panel.width - 12);
        top = anchor.top >= panel.height + 12 ? anchor.top - panel.height - 10 : anchor.bottom + 10;
      }
      top = Math.min(Math.max(12, top), Math.max(12, height - panel.height - 12));
      const chat = document.querySelector("#__chat_widget_root .bot-container")?.getBoundingClientRect();
      if (chat?.width && left < chat.right && left + panel.width > chat.left && top < chat.bottom && top + panel.height > chat.top) {
        const besideChat = chat.left - panel.width - 12;
        const aboveChat = chat.top - panel.height - 12;
        if (besideChat >= 12) left = besideChat;
        else if (aboveChat >= 12) top = aboveChat;
      }
      setPosition({ top, left, ready: true });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(floating.current);
    const chat = document.querySelector("#__chat_widget_root .bot-container");
    if (chat) observer.observe(chat);
    const onScroll = event => { if (!floating.current?.contains(event.target)) close(); };
    const onPointer = event => { if (!floating.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(); };
    const onKey = event => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true); document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [active, close]);

  const getTriggerProps = svc => ({
    role: "button", tabIndex: 0, "data-monitor-service": svc.job,
    "aria-label": `${svc.name} service details`, "aria-haspopup": "dialog",
    "aria-expanded": active?.job === svc.job,
    "aria-controls": active?.job === svc.job ? "service-hover-details" : undefined,
    onPointerDown: () => { pointerFocus.current = true; },
    onPointerEnter: event => {
      if (event.pointerType !== "mouse" || activeRef.current?.pinned) return;
      clearTimers(); const element = event.currentTarget;
      timers.current.open = setTimeout(() => open(svc, element), 200);
    },
    onPointerLeave: scheduleClose,
    onFocus: event => { if (!ignoreFocus.current && !pointerFocus.current) open(svc, event.currentTarget); pointerFocus.current = false; },
    onBlur: event => { if (!floating.current?.contains(event.relatedTarget)) scheduleClose(); },
    onClick: event => { if (activeRef.current?.job === svc.job && activeRef.current.pinned) close(); else open(svc, event.currentTarget, true); },
    onKeyDown: event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(svc, event.currentTarget, true); }
      if (event.key === "Tab" && !event.shiftKey && activeRef.current?.job === svc.job) { event.preventDefault(); floating.current?.querySelector("button")?.focus(); }
    },
  });

  const current = detail.job === active?.job ? detail : { loading: true };
  const isUp = current.payload?.metrics?.up == null ? service?.up : current.payload.metrics.up === 1;
  const popover = active && service && meta ? createPortal(
    <section id="service-hover-details" ref={floating} className={styles.popover} role="dialog" aria-modal="false" aria-label={`${service.name} service details`}
      style={{ top: position.top, left: position.left, visibility: position.ready ? "visible" : "hidden" }}
      onPointerEnter={clearTimers} onPointerLeave={scheduleClose} onFocus={clearTimers}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const items = [...floating.current.querySelectorAll("button,a[href]")];
        if (event.shiftKey && event.target === items[0]) { event.preventDefault(); close(true); }
        else if (!event.shiftKey && event.target === items[items.length - 1]) {
          event.preventDefault(); const cards = [...document.querySelectorAll("[data-monitor-service]")];
          const next = cards[cards.indexOf(trigger.current) + 1]; close(true); next?.focus();
        }
      }}>
      <header className={styles.header}><span className={styles.glyph}><Server size={19} /></span><div><h4>{service.name}</h4><span className={styles.status} data-up={isUp}>{isUp ? "UP" : "NO RECENT SCRAPE"} <span>Cloud Run · JVM</span></span></div><button className={styles.close} type="button" onClick={() => close(true)} aria-label="Close service details" title="Close service details"><X size={17} /></button></header>
      <div className={styles.body}><DetailContent service={service} summaryAt={summaryAt} payload={current.payload} loading={current.loading} failed={current.failed} retry={() => { detailCache.delete(active.job); setAttempt(value => value + 1); }} /></div>
      <footer className={styles.links}>
        <a href={meta.repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label="Source code on GitHub" title={`Open ${meta.repo} on GitHub`}><Github size={15} />GitHub<ArrowUpRight size={13} /></a>
        <a href={GRAFANA_PUBLIC_URL} target="_blank" rel="noopener noreferrer" title="Open the full platform Grafana dashboard"><Activity size={15} />Grafana<ArrowUpRight size={13} /></a>
        <a href="/architecture" target="_blank" rel="noopener noreferrer">Architecture<ArrowUpRight size={13} /></a>
      </footer>
    </section>, document.body) : null;
  return { getTriggerProps, popover };
}
