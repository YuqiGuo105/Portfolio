import { getServiceMetadata } from "./serviceCatalog.mjs";

const PROM_BASE = "https://loyalcaravan951.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1";
const TTL = 60_000;
const ERROR_TTL = 15_000;
const MAX_STALE = 300_000;

export function serviceQueries(job) {
  if (!getServiceMetadata(job)) throw new Error("Unknown service");
  const selector = `job="${job}"`;
  const http = `http_server_requests_seconds_count{${selector}}`;
  const rate = `sum(rate(${http}[5m]))`;
  const expressions = {
    up: `max(max_over_time(up{${selector}}[3m]))`,
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
  return { instant, range: rate, fields: Object.keys(expressions) };
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
} = {}) {
  // At most 10 cache entries; concurrent requests for the same job share work.
  const cache = new Map(), pending = new Map(), cooldowns = new Map();

  async function load(job, token) {
    const captured = now(), end = Math.floor(captured / 1000), queries = serviceQueries(job);
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
    const values = range.status === "fulfilled" ? range.value[0]?.values : [];
    const requests = Array.isArray(values) ? values.slice(0, 31).flatMap(([t, v]) =>
      Number.isFinite(Number(t)) && Number(t) >= end - 3600 && Number(t) <= end
        ? [{ t: Number(t) * 1000, v: nonnegative(v) }] : []) : [];
    const partial = range.status === "rejected";
    return { job, capturedAt: new Date(captured).toISOString(), stale: false, partial,
      windowSeconds: 300, historySeconds: 3600, metrics, requests };
  }

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
    const { job, ...extra } = req.query || {};
    if (!getServiceMetadata(job) || Object.keys(extra).length) return res.status(400).json({ error: "Select a known platform service" });
    const token = getToken();
    if (!token) return res.status(503).json({ error: "Service metrics are temporarily unavailable" });
    const entry = cache.get(job);
    const send = (payload, status) => {
      res.setHeader("X-Cache", status);
      if (!payload.stale) {
        const ageSeconds = Math.max(0, Math.floor((now() - Date.parse(payload.capturedAt)) / 1000));
        res.setHeader("Cache-Control", `public, max-age=${Math.max(0, (payload.partial ? 15 : 60) - ageSeconds)}`);
      }
      return res.status(200).json(payload);
    };
    if (entry && now() - entry.fetched < (entry.payload.partial ? ERROR_TTL : TTL)) return send(entry.payload, "HIT");
    if ((cooldowns.get(job) || 0) > now()) {
      if (entry && now() - entry.fetched < MAX_STALE) return send({ ...entry.payload, stale: true }, "STALE");
      res.setHeader("Retry-After", "15");
      return res.status(503).json({ error: "Service metrics are temporarily unavailable" });
    }
    if (!pending.has(job) && pending.size >= 4) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({ error: "Metrics are busy. Try again shortly." });
    }
    try {
      if (!pending.has(job)) pending.set(job, load(job, token).then(payload => {
        cache.set(job, { payload, fetched: now() });
        cooldowns.delete(job);
        return payload;
      }).catch(error => { cooldowns.set(job, now() + ERROR_TTL); throw error; }).finally(() => pending.delete(job)));
      return send(await pending.get(job), "MISS");
    } catch {
      if (entry && now() - entry.fetched < MAX_STALE) return send({ ...entry.payload, stale: true }, "STALE");
      res.setHeader("Retry-After", "15");
      return res.status(503).json({ error: "Service metrics are temporarily unavailable" });
    }
  };
}
