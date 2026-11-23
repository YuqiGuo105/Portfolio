import { SERVICE_CATALOG, getServiceMetadata } from "./serviceCatalog.mjs";

export function byJob(result) {
  const map = {};
  for (const series of result || []) {
    const job = series.metric?.job;
    const value = Number.parseFloat(series.value?.[1]);
    if (Object.hasOwn(SERVICE_CATALOG, job) && Number.isFinite(value)) map[job] = value;
  }
  return map;
}

export function monitoringServices(vectors, nowSeconds) {
  const maps = Object.fromEntries(Object.entries(vectors).map(([key, values]) => [key, byJob(values)]));
  const value = (key, job, digits = 0) => {
    const n = maps[key]?.[job];
    return n == null || n < 0 ? null : Number(n.toFixed(digits));
  };
  return Object.keys(SERVICE_CATALOG).map(job => {
    const meta = getServiceMetadata(job), probe = meta.monitoring === "probe";
    const sampleAtSeconds = value(probe ? "probeAt" : "sampleAt", job);
    const fresh = sampleAtSeconds != null && nowSeconds - sampleAtSeconds <= Math.max(180, meta.intervalSeconds * 2) && sampleAtSeconds <= nowSeconds + 30;
    const status = fresh ? value(probe ? "probe" : "up", job) : null;
    const known = status === 0 || status === 1;
    return { job, name: meta.name, monitoring: meta.monitoring, intervalSeconds: meta.intervalSeconds,
      up: known && status === 1, noMetrics: !known, status: !known ? "unknown" : status === 1 ? "up" : "check-failed",
      sampleAtSeconds, responseMs: fresh && probe ? value("probeDuration", job, 1) : null,
      httpStatus: fresh && probe ? value("probeStatus", job) : null,
      heapPct: fresh && !probe ? value("heapPct", job, 1) : null,
      uptimeSeconds: fresh && !probe ? value("uptime", job) : null,
      threads: fresh && !probe ? value("threads", job) : null,
      reqPerSec: fresh && !probe ? value("reqRate", job, 2) : null,
      errPerSec: fresh && !probe ? value("errRate", job, 2) : null,
    };
  });
}
