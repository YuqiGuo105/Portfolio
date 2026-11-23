// pages/api/metrics.js
//
// Server-side proxy that queries Grafana Cloud Prometheus and returns compact
// JSON for the native "Platform Monitoring" dashboard on the site.
//
// Grafana Cloud blocks iframe embedding (X-Frame-Options: deny), and a rendered
// PNG carries the full Grafana chrome. Instead we run a handful of PromQL
// queries here (token stays server-side) and render our own clean UI client-side.

import { monitoringServices } from "../../src/lib/monitoringSummary.mjs";
import { loadMonitoringRegistry, publicJobSelector } from "../../src/lib/server/monitoringRegistry.mjs";

const PROM_BASE =
  "https://loyalcaravan951.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1";
const CACHE_SECONDS = 30;
const QUERY_TIMEOUT_MS = 8000;

let cache = { payload: null, fetchedAtMs: 0 };

async function promQuery(query, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROM_BASE}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query }).toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.result || [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

// Range query -> array of { t (ms), v (number) } for the first series.
async function promRange(query, token, windowSeconds = 3600, step = 120) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - windowSeconds;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROM_BASE}/query_range`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        query,
        start: String(start),
        end: String(end),
        step: String(step),
      }).toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const series = data?.data?.result?.[0]?.values || [];
    return series.map(([t, v]) => ({
      t: t * 1000,
      v: Math.round(Number.parseFloat(v) * 100) / 100,
    }));
  } catch {
    clearTimeout(timer);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).end(); }
  const token = process.env.GRAFANA_RENDER_TOKEN;
  if (!token) {
    res.status(503).json({ error: "GRAFANA_RENDER_TOKEN not configured" });
    return;
  }

  const now = Date.now();
  let registry;
  try { registry = await loadMonitoringRegistry(); }
  catch { return res.status(503).json({ error: 'Monitoring registry unavailable' }); }
  const { catalog, revision } = registry;
  const scope = publicJobSelector(catalog);
  if (cache.payload?.registryRevision !== revision) cache = { payload: null, fetchedAtMs: 0 };
  if (cache.payload && now - cache.fetchedAtMs < CACHE_SECONDS * 1000) {
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`);
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(cache.payload);
    return;
  }

  try {
    const [up, heapPct, uptime, threads, reqRate, errRate, sampleAt, probe, probeAt, probeDuration, probeStatus] = await Promise.all([
      promQuery(`min by (job) (up{${scope}})`, token),
      promQuery(
        `sum by (job) (jvm_memory_used_bytes{${scope},area="heap"}) / sum by (job) (jvm_memory_max_bytes{${scope},area="heap"}) * 100`,
        token
      ),
      promQuery(`max by (job) (process_uptime_seconds{${scope}})`, token),
      promQuery(`sum by (job) (jvm_threads_live_threads{${scope}})`, token),
      promQuery(`sum by (job) (rate(http_server_requests_seconds_count{${scope}}[5m]))`, token),
      promQuery(
        `sum by (job) (rate(http_server_requests_seconds_count{${scope},outcome=~"SERVER_ERROR|CLIENT_ERROR"}[5m]))`,
        token
      ),
      promQuery(`max by (job) (timestamp(up{${scope}}))`, token),
      promQuery(`min by (job) (probe_success{${scope}})`, token),
      promQuery(`max by (job) (timestamp(probe_success{${scope}}))`, token),
      promQuery(`max by (job) (probe_duration_seconds{${scope}}) * 1000`, token),
      promQuery(`max by (job) (probe_http_status_code{${scope}})`, token),
    ]);

    if (up.length === 0 && probe.length === 0 && Object.keys(catalog).length > 0) {
      if (cache.payload && now - cache.fetchedAtMs < 300_000) {
        res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
        res.setHeader("X-Cache", "STALE-ON-METRICS-GAP");
        res.status(200).json({ ...cache.payload, stale: true });
        return;
      }
      throw new Error("Grafana Cloud returned no availability samples");
    }

    const services = monitoringServices({ up, heapPct, uptime, threads, reqRate, errRate, sampleAt, probe, probeAt, probeDuration, probeStatus }, Math.floor(now / 1000), catalog);

    const upCount = services.filter((s) => s.up).length;
    const unknownCount = services.filter((s) => s.noMetrics).length;
    const totalReq = services.reduce((sum, s) => sum + (s.reqPerSec || 0), 0);

    // Aggregate gauges (instant) + time-series (range) for a Grafana-like view.
    const [heapGauge, nonHeapGauge, cpuGauge, sysCpuGauge, cpuRateGauge, loadAvgGauge, heapSeries, reqSeries, threadSeries] =
      await Promise.all([
        promQuery(
          `sum(jvm_memory_used_bytes{${scope},area="heap"})/sum(jvm_memory_max_bytes{${scope},area="heap"})*100`,
          token
        ),
        promQuery(
          `sum(jvm_memory_used_bytes{${scope},area="nonheap"})/sum(jvm_memory_committed_bytes{${scope},area="nonheap"})*100`,
          token
        ),
        promQuery(`avg(process_cpu_usage{${scope}})*100`, token),
        promQuery(`avg(system_cpu_usage{${scope}})*100`, token),
        promQuery(`avg(rate(process_cpu_time_ns_total{${scope}}[5m])) / 10000000`, token),
        promQuery(`avg(system_load_average_1m{${scope}}) / avg(system_cpu_count{${scope}}) * 100`, token),
        promRange(
          `sum(jvm_memory_used_bytes{${scope},area="heap"})/sum(jvm_memory_max_bytes{${scope},area="heap"})*100`,
          token
        ),
        promRange(`sum(rate(http_server_requests_seconds_count{${scope}}[5m]))`, token),
        promRange(`sum(jvm_threads_live_threads{${scope}})`, token),
      ]);

    const firstVal = (r) => {
      const v = r?.[0]?.value?.[1];
      const n = Number.parseFloat(v);
      return Number.isNaN(n) ? null : Math.round(n * 10) / 10;
    };

    const firstUsablePct = (...results) => {
      for (const result of results) {
        const value = firstVal(result);
        if (value != null && value >= 0) return value;
      }
      return null;
    };

    const payload = {
      registryRevision: revision,
      updatedAt: new Date().toISOString(),
      summary: {
        total: services.length,
        up: upCount,
        unknown: unknownCount,
        down: services.length - upCount - unknownCount,
        requestsPerSec: Math.round(totalReq * 100) / 100,
      },
      gauges: {
        heapPct: firstVal(heapGauge),
        nonHeapPct: firstVal(nonHeapGauge),
        cpuPct: firstUsablePct(cpuGauge, sysCpuGauge, cpuRateGauge, loadAvgGauge),
      },
      timeseries: {
        heap: heapSeries,
        requests: reqSeries,
        threads: threadSeries,
      },
      services,
    };

    cache = { payload, fetchedAtMs: now };
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`);
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(payload);
  } catch (err) {
    if (cache.payload && now - cache.fetchedAtMs < 300_000) {
      res.setHeader("X-Cache", "STALE-ON-ERROR");
      res.status(200).json({ ...cache.payload, stale: true });
      return;
    }
    res.status(502).json({ error: "Failed to query metrics", message: err?.message });
  }
}
