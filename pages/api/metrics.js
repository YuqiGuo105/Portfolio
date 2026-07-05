// pages/api/metrics.js
//
// Server-side proxy that queries Grafana Cloud Prometheus and returns compact
// JSON for the native "Platform Monitoring" dashboard on the site.
//
// Grafana Cloud blocks iframe embedding (X-Frame-Options: deny), and a rendered
// PNG carries the full Grafana chrome. Instead we run a handful of PromQL
// queries here (token stays server-side) and render our own clean UI client-side.

const PROM_BASE =
  "https://loyalcaravan951.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1";
const CACHE_SECONDS = 30;
const QUERY_TIMEOUT_MS = 8000;

// Friendly display names for each service job/application label.
const SERVICE_LABELS = {
  "portfolio-admin-service": "Admin",
  "portfolio-notification-service": "Notification",
  "portfolio-agent-service": "AI Agent",
  "portfolio-mcp-gateway": "MCP Gateway",
  "portfolio-search-indexer": "Search Indexer",
  "portfolio-rag-indexer": "RAG Indexer",
  "analytics-aggregator-service": "Analytics Aggregator",
  "analytics-alerts-service": "Analytics Alerts",
};

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

// Turn a Prometheus vector result into a map keyed by the `job` label.
function byJob(result) {
  const map = {};
  for (const series of result) {
    const job = series.metric?.job || series.metric?.application;
    if (!job) continue;
    const value = Number.parseFloat(series.value?.[1]);
    if (!Number.isNaN(value)) map[job] = value;
  }
  return map;
}

export default async function handler(req, res) {
  const token = process.env.GRAFANA_RENDER_TOKEN;
  if (!token) {
    res.status(503).json({ error: "GRAFANA_RENDER_TOKEN not configured" });
    return;
  }

  const now = Date.now();
  if (cache.payload && now - cache.fetchedAtMs < CACHE_SECONDS * 1000) {
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`);
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(cache.payload);
    return;
  }

  try {
    const [up, heapPct, uptime, threads, reqRate, errRate] = await Promise.all([
      promQuery(`up`, token),
      promQuery(
        `sum by (job) (jvm_memory_used_bytes{area="heap"}) / sum by (job) (jvm_memory_max_bytes{area="heap"}) * 100`,
        token
      ),
      promQuery(`max by (job) (process_uptime_seconds)`, token),
      promQuery(`sum by (job) (jvm_threads_live_threads)`, token),
      promQuery(`sum by (job) (rate(http_server_requests_seconds_count[5m]))`, token),
      promQuery(
        `sum by (job) (rate(http_server_requests_seconds_count{outcome=~"SERVER_ERROR|CLIENT_ERROR"}[5m]))`,
        token
      ),
    ]);

    const upMap = byJob(up);
    const heapMap = byJob(heapPct);
    const uptimeMap = byJob(uptime);
    const threadsMap = byJob(threads);
    const reqMap = byJob(reqRate);
    const errMap = byJob(errRate);

    const jobs = Object.keys(SERVICE_LABELS);
    const services = jobs.map((job) => {
      const isUp = upMap[job] === 1;
      const noMetrics = upMap[job] == null;
      return {
        job,
        name: SERVICE_LABELS[job] || job,
        up: isUp,
        noMetrics,
        heapPct: heapMap[job] != null ? Math.round(heapMap[job] * 10) / 10 : null,
        uptimeSeconds: uptimeMap[job] != null ? Math.round(uptimeMap[job]) : null,
        threads: threadsMap[job] != null ? Math.round(threadsMap[job]) : null,
        reqPerSec: reqMap[job] != null ? Math.round(reqMap[job] * 100) / 100 : 0,
        errPerSec: errMap[job] != null ? Math.round(errMap[job] * 100) / 100 : 0,
      };
    });

    const upCount = services.filter((s) => s.up).length;
    const idleCount = services.filter((s) => s.noMetrics).length;
    const totalReq = services.reduce((sum, s) => sum + (s.reqPerSec || 0), 0);

    // Aggregate gauges (instant) + time-series (range) for a Grafana-like view.
    const [heapGauge, nonHeapGauge, cpuGauge, sysCpuGauge, heapSeries, reqSeries, threadSeries] =
      await Promise.all([
        promQuery(
          `sum(jvm_memory_used_bytes{area="heap"})/sum(jvm_memory_max_bytes{area="heap"})*100`,
          token
        ),
        promQuery(
          `sum(jvm_memory_used_bytes{area="nonheap"})/sum(jvm_memory_committed_bytes{area="nonheap"})*100`,
          token
        ),
        promQuery(`avg(process_cpu_usage)*100`, token),
        promQuery(`avg(system_cpu_usage)*100`, token),
        promRange(
          `sum(jvm_memory_used_bytes{area="heap"})/sum(jvm_memory_max_bytes{area="heap"})*100`,
          token
        ),
        promRange(`sum(rate(http_server_requests_seconds_count[5m]))`, token),
        promRange(`sum(jvm_threads_live_threads)`, token),
      ]);

    const firstVal = (r) => {
      const v = r?.[0]?.value?.[1];
      const n = Number.parseFloat(v);
      return Number.isNaN(n) ? null : Math.round(n * 10) / 10;
    };

    const payload = {
      updatedAt: new Date().toISOString(),
      summary: {
        total: services.length,
        up: upCount,
        idle: idleCount,
        down: services.length - upCount - idleCount,
        requestsPerSec: Math.round(totalReq * 100) / 100,
      },
      gauges: {
        heapPct: firstVal(heapGauge),
        nonHeapPct: firstVal(nonHeapGauge),
        cpuPct: (() => {
          const v = firstVal(cpuGauge) ?? firstVal(sysCpuGauge);
          return v == null || v < 0 ? null : v;
        })(),
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
    if (cache.payload) {
      res.setHeader("X-Cache", "STALE-ON-ERROR");
      res.status(200).json(cache.payload);
      return;
    }
    res.status(502).json({ error: "Failed to query metrics", message: err?.message });
  }
}
