import { getServiceMetadata, SERVICE_CATALOG } from "./serviceCatalog.mjs";

const PROM_BASE = "https://loyalcaravan951.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1";
const TTL = 60_000;
const ERROR_TTL = 15_000;
const MAX_STALE = 300_000;

export function serviceQueries(job, catalog = SERVICE_CATALOG) {
  if (typeof job !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(job)) throw new Error('Unknown service');
  const meta = getServiceMetadata(job, catalog);
  if (!meta) throw new Error("Unknown service");
  const probe = meta.monitoring === "probe";
  const selector = `job="${job}"`;
  const http = `http_server_requests_seconds_count{${selector}}`;
  const rate = `sum(rate(${http}[5m]))`;
  const expressions = probe ? {
    up: `min(probe_success{${selector}})`,
    sampleAtSeconds: `max(timestamp(probe_success{${selector}}))`,
    responseMs: `max(probe_duration_seconds{${selector}})*1000`,
    httpStatus: `max(probe_http_status_code{${selector}})`,
  } : {
    up: `min(up{${selector}})`,
    sampleAtSeconds: `max(timestamp(up{${selector}}))`,
    cpuPct: `avg(process_cpu_usage{${selector}} >= 0)*100`,
    systemCpuPct: `avg(system_cpu_usage{${selector}} >= 0)*100`,
    heapUsedBytes: `sum(jvm_memory_used_bytes{${selector},area="heap"})`,
    heapMaxBytes: `sum(jvm_memory_max_bytes{${selector},area="heap"} > 0)`,
    nonHeapUsedBytes: `sum(jvm_memory_used_bytes{${selector},area="nonheap"})`,
    threads: `sum(jvm_threads_live_threads{${selector}})`,
    peakThreads: `sum(jvm_threads_peak_threads{${selector}})`,
    uptimeSeconds: `max(process_uptime_seconds{${selector}})`,
    reqPerSec: rate,
    meanLatencyMs: `sum(rate(http_server_requests_seconds_sum{${selector}}[5m])) / (${rate}) * 1000`,
    serverErrorsPerSec: `sum(rate(http_server_requests_seconds_count{${selector},outcome="SERVER_ERROR"}[5m]))`,
    clientErrorsPerSec: `sum(rate(http_server_requests_seconds_count{${selector},outcome="CLIENT_ERROR"}[5m]))`,
    gcMeanPauseMs: `sum(rate(jvm_gc_pause_seconds_sum{${selector}}[5m])) / sum(rate(jvm_gc_pause_seconds_count{${selector}}[5m])) * 1000`,
    poolActive: `sum(hikaricp_connections_active{${selector}})`,
    poolMax: `sum(hikaricp_connections_max{${selector}})`,
  };
  // One bounded query returns scalars, with no URI, instance or user labels.
  const instant = Object.entries(expressions).map(([field, query]) =>
    `label_replace((${query}),"field","${field}","","")`).join(" or ");
  return { instant, range: probe ? `max(probe_duration_seconds{${selector}})*1000` : rate, fields: Object.keys(expressions), probe, intervalSeconds: meta.intervalSeconds };
}

const nonnegative = value => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null;
};

async function queryPrometheus(path, params, token, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${PROM_BASE}/${path}`, {
      method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(), signal: controller.signal,
    });
    if (!response.ok) throw new Error("Metrics unavailable");
    const json = await response.json();
    if (json.status !== "success" || !Array.isArray(json.data?.result)) throw new Error("Invalid metrics response");
    return json.data.result;
  } finally { clearTimeout(timer); }
}

export function createServiceMetricsHandler({
  fetchImpl = fetch, getToken = () => process.env.GRAFANA_RENDER_TOKEN,
  now = Date.now, timeoutMs = 4500,
  getCatalog = async () => SERVICE_CATALOG,
} = {}) {
  // Cache is bounded by the service catalog; same-job requests share work.
  const cache = new Map(), pending = new Map(), cooldowns = new Map();

  async function load(job, token, catalog) {
    const captured = now(), end = Math.floor(captured / 1000), queries = serviceQueries(job, catalog);
    const [instant, range] = await Promise.allSettled([
      queryPrometheus("query", { query: queries.instant, time: String(end) }, token, fetchImpl, timeoutMs),
      queryPrometheus("query_range", { query: queries.range, start: String(end - 3600), end: String(end), step: "120" }, token, fetchImpl, timeoutMs),
    ]);
    if (instant.status === "rejected") throw new Error("Metrics unavailable");
    const metrics = Object.fromEntries(queries.fields.map(field => [field, null]));
    for (const sample of instant.value) {
      const field = sample.metric?.field;
      if (Object.hasOwn(metrics, field)) metrics[field] = nonnegative(sample.value?.[1]);
    }
    if (metrics.sampleAtSeconds == null || end - metrics.sampleAtSeconds > Math.max(180, queries.intervalSeconds * 2) || metrics.sampleAtSeconds > end + 30) {
      for (const field of queries.fields) if (field !== "sampleAtSeconds") metrics[field] = null;
    }
    const values = range.status === "fulfilled" ? range.value[0]?.values : [];
    const requests = Array.isArray(values) ? values.slice(0, 31).flatMap(([t, v]) =>
      Number.isFinite(Number(t)) && Number(t) >= end - 3600 && Number(t) <= end
        ? [{ t: Number(t) * 1000, v: nonnegative(v) }] : []) : [];
    const partial = range.status === "rejected";
    return { job, capturedAt: new Date(captured).toISOString(), stale: false, partial,
      windowSeconds: 300, historySeconds: 3600, metrics, requests: queries.probe ? [] : requests,
      ...(queries.probe ? { probeHistory: requests } : {}) };
  }

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
    const { job, ...extra } = req.query || {};
    if (typeof job !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(job) || Object.keys(extra).length) return res.status(400).json({ error: "Select a known platform service" });
    let catalog;
    try { catalog = await getCatalog(); } catch { return res.status(503).json({ error: 'Monitoring registry unavailable' }); }
    const meta = getServiceMetadata(job, catalog);
    if (!meta) return res.status(400).json({ error: "Select a known platform service" });
    const cacheKey = `${job}:${meta.monitoring}:${meta.intervalSeconds}`;
    const activeKeys = new Set(Object.keys(catalog).map(id => {
      const current = getServiceMetadata(id, catalog);
      return `${id}:${current.monitoring}:${current.intervalSeconds}`;
    }));
    for (const map of [cache, cooldowns]) for (const key of map.keys()) if (!activeKeys.has(key)) map.delete(key);
    const token = getToken();
    if (!token) return res.status(503).json({ error: "Service metrics are temporarily unavailable" });
    const entry = cache.get(cacheKey);
    const send = (payload, status) => {
      res.setHeader("X-Cache", status);
      if (!payload.stale) {
        const ageSeconds = Math.max(0, Math.floor((now() - Date.parse(payload.capturedAt)) / 1000));
        res.setHeader("Cache-Control", `public, max-age=${Math.max(0, (payload.partial ? 15 : 60) - ageSeconds)}`);
      }
      return res.status(200).json(payload);
    };
    if (entry && now() - entry.fetched < (entry.payload.partial ? ERROR_TTL : TTL)) return send(entry.payload, "HIT");
    if ((cooldowns.get(cacheKey) || 0) > now()) {
      if (entry && now() - entry.fetched < MAX_STALE) return send({ ...entry.payload, stale: true }, "STALE");
      res.setHeader("Retry-After", "15");
      return res.status(503).json({ error: "Service metrics are temporarily unavailable" });
    }
    if (!pending.has(cacheKey) && pending.size >= 4) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({ error: "Metrics are busy. Try again shortly." });
    }
    try {
      if (!pending.has(cacheKey)) pending.set(cacheKey, load(job, token, catalog).then(payload => {
        cache.set(cacheKey, { payload, fetched: now() });
        cooldowns.delete(cacheKey);
        return payload;
      }).catch(error => { cooldowns.set(cacheKey, now() + ERROR_TTL); throw error; }).finally(() => pending.delete(cacheKey)));
      return send(await pending.get(cacheKey), "MISS");
    } catch {
      if (entry && now() - entry.fetched < MAX_STALE) return send({ ...entry.payload, stale: true }, "STALE");
      res.setHeader("Retry-After", "15");
      return res.status(503).json({ error: "Service metrics are temporarily unavailable" });
    }
  };
}
