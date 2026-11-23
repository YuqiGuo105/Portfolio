import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServiceMetricsHandler, serviceQueries } from '../src/lib/serviceMetrics.mjs';
import { SERVICE_CATALOG, getServiceMetadata, metricNumber, memorySize } from '../src/lib/serviceCatalog.mjs';
import { monitoringServices } from '../src/lib/monitoringSummary.mjs';

const job = 'portfolio-admin-service';
const clock = 1_791_954_000_000;
const vector = (field, value) => ({ metric: { field, instance: 'private.internal', uri: '/internal' }, value: [clock / 1000, String(value)] });
const fixture = [vector('sampleAtSeconds', clock / 1000), vector('up', 1), vector('heapUsedBytes', 200_000_000), vector('reqPerSec', 0.0123), vector('cpuPct', 'NaN'), vector('meanLatencyMs', '+Inf'), vector('gcMeanPauseMs', -1), vector('privateField', 123)];
function mockFetch(calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return Response.json({ status: 'success', data: { result: url.endsWith('/query') ? fixture : [{ metric: { private: 'hidden' }, values: [[clock / 1000 - 120, '0.01'], [clock / 1000, '0.02']] }] } });
  };
}
async function invoke(handler, query = { job }, method = 'GET') {
  const output = { headers: {} };
  await handler({ method, query }, { setHeader(k,v) { output.headers[k] = v; }, status(code) { output.status = code; return this; }, json(body) { output.body = body; return this; } });
  return output;
}

test('catalog and queries accept only thirteen known jobs; no arbitrary query injection', () => {
  assert.equal(Object.keys(SERVICE_CATALOG).length, 13);
  for (const key of Object.keys(SERVICE_CATALOG)) {
    assert.ok(getServiceMetadata(key).repositoryUrl.startsWith('https://github.com/YuqiGuo105/'));
    assert.match(serviceQueries(key).range, getServiceMetadata(key).monitoring === 'probe' ? /probe_duration_seconds/ : /\[5m\]/);
  }
  for (const key of ['__proto__', 'constructor', 'x"} or up', ['portfolio-admin-service'], '', null]) {
    assert.equal(getServiceMetadata(key), null);
    assert.throws(() => serviceQueries(key));
  }
});

test('rejects unsupported methods, parameters and missing configuration before querying', async () => {
  const calls = [], handler = createServiceMetricsHandler({ fetchImpl: mockFetch(calls), getToken: () => 'SECRET' });
  assert.equal((await invoke(handler, {job}, 'POST')).status, 405);
  for (const query of [{job: 'evil'}, {job: [job]}, {job, query: 'up'}, {job, url: 'http://internal'}]) assert.equal((await invoke(handler, query)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await invoke(createServiceMetricsHandler({ getToken: () => undefined }))).status, 503);
});

test('fixed Grafana host, bounded history and safe public scalar output', async () => {
  const calls = [], handler = createServiceMetricsHandler({ fetchImpl: mockFetch(calls), getToken: () => 'SECRET', now: () => clock });
  const result = await invoke(handler);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  for (const {url, options} of calls) {
    assert.ok(url.startsWith('https://loyalcaravan951.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/'));
    assert.equal(options.headers.Authorization, 'Bearer SECRET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal.aborted, false);
  }
  const range = new URLSearchParams(calls.find(c => c.url.endsWith('query_range')).options.body);
  assert.equal(Number(range.get('end')) - Number(range.get('start')), 3600);
  assert.equal(range.get('step'), '120');
  assert.equal(result.body.metrics.reqPerSec, 0.0123);
  for (const field of ['cpuPct', 'meanLatencyMs', 'gcMeanPauseMs', 'poolMax']) assert.equal(result.body.metrics[field], null);
  assert.equal(result.body.requests.length, 2);
  assert.doesNotMatch(JSON.stringify(result.body), /SECRET|private|internal|NaN|Infinity/);
});

test('cache coalesces concurrent requests and refreshes after 60 seconds', async () => {
  let time = clock;
  const calls = [], handler = createServiceMetricsHandler({ fetchImpl: mockFetch(calls), getToken: () => 'SECRET', now: () => time });
  await Promise.all(Array.from({ length: 12 }, () => invoke(handler)));
  assert.equal(calls.length, 2);
  assert.equal((await invoke(handler)).headers['X-Cache'], 'HIT');
  time += 30_000;
  assert.equal((await invoke(handler)).headers['Cache-Control'], 'public, max-age=30');
  time += 30_001;
  await invoke(handler);
  assert.equal(calls.length, 4);
});

test('query failures use a short negative cache without returning provider details', async () => {
  let calls = 0;
  const handler = createServiceMetricsHandler({ getToken: () => 'SECRET', now: () => clock, fetchImpl: async () => { calls++; throw new Error('SECRET private upstream'); } });
  for (let i = 0; i < 3; i++) {
    const result = await invoke(handler);
    assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(result.body), /SECRET|private/);
  }
  assert.equal(calls, 2);
});

test('stale fallback is explicitly marked and expires after five minutes', async () => {
  let time = clock, fail = false;
  const calls = [], fetcher = mockFetch(calls);
  const handler = createServiceMetricsHandler({ getToken: () => 'SECRET', now: () => time, fetchImpl: (...args) => { if (fail) throw new Error('failure'); return fetcher(...args); } });
  const first = await invoke(handler);
  fail = true; time += 61_000;
  const stale = await invoke(handler);
  assert.equal(stale.status, 200); assert.equal(stale.body.stale, true);
  assert.equal(stale.body.capturedAt, first.body.capturedAt);
  assert.equal(stale.headers['Cache-Control'], 'no-store');
  time += 300_000;
  assert.equal((await invoke(handler)).status, 503);
});

test('a missing history can be partial, but missing instant query is not synthesized', async () => {
  const calls = [], fetcher = mockFetch(calls);
  const handler = createServiceMetricsHandler({ getToken: () => 'SECRET', now: () => clock, fetchImpl: (url, options) => url.endsWith('/query_range') ? Promise.reject(new Error('no range')) : fetcher(url, options) });
  const result = await invoke(handler);
  assert.equal(result.status, 200); assert.equal(result.body.partial, true); assert.deepEqual(result.body.requests, []);
  assert.equal(result.headers['Cache-Control'], 'public, max-age=15');
});

test('requests are aborted on timeout and do not block the next attempt forever', async () => {
  let aborted = 0;
  const handler = createServiceMetricsHandler({ getToken: () => 'SECRET', timeoutMs: 10, fetchImpl: (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted++; reject(new Error('abort')); })) });
  assert.equal((await invoke(handler)).status, 503);
  assert.equal(aborted, 2);
});

test('per-process concurrency is bounded to four distinct service refreshes', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [], fetcher = mockFetch(calls);
  const handler = createServiceMetricsHandler({ getToken: () => 'SECRET', now: () => clock, fetchImpl: async (...args) => { await gate; return fetcher(...args); } });
  const jobs = Object.keys(SERVICE_CATALOG);
  const pending = jobs.slice(0,4).map(job => invoke(handler, {job}));
  assert.equal((await invoke(handler, {job: jobs[4]})).status, 429);
  release(); await Promise.all(pending);
  assert.equal(calls.length, 8);
});

test('small nonzero metrics are not rounded into misleading zeroes', () => {
  assert.equal(metricNumber(.0001, 3), '<0.001');
  assert.equal(metricNumber(null), 'N/A');
  assert.equal(metricNumber(0, 3), '0.000');
  assert.equal(memorySize(-1), 'N/A');
  assert.equal(memorySize(1024 ** 3), '1.00 GiB');
});

test('Node health queries cannot mistake exporter availability for target health', async () => {
  const probeJob = 'portfolio-voice-relay';
  const queries = serviceQueries(probeJob);
  assert.match(queries.instant, /min\(probe_success/);
  assert.doesNotMatch(queries.instant, /jvm_|http_server_|min\(up\{/);
  const handler = createServiceMetricsHandler({ getToken: () => 'SECRET', now: () => clock,
    fetchImpl: async url => Response.json({status: 'success', data: {result: url.endsWith('/query')
      ? [vector('up', 0), vector('sampleAtSeconds', clock / 1000), vector('responseMs', 82), vector('httpStatus', 503)]
      : [{values: [[clock / 1000, '82']]}]}}) });
  const result = await invoke(handler, { job: probeJob });
  assert.equal(result.body.metrics.up, 0);
  assert.equal(result.body.metrics.httpStatus, 503);
  assert.deepEqual(result.body.requests, []);
  assert.equal(result.body.probeHistory[0].v, 82);
  assert.equal(result.body.metrics.heapUsedBytes, undefined);
});

test('expired or missing sample timestamps never yield a healthy detail', async () => {
  for (const sampleAt of [clock / 1000 - 500, clock / 1000 + 500, null]) {
    const handler = createServiceMetricsHandler({ getToken: () => 'SECRET', now: () => clock,
      fetchImpl: async () => Response.json({status:'success', data:{result:[vector('up',1), ...(sampleAt ? [vector('sampleAtSeconds',sampleAt)] : [])]}}) });
    const result = await invoke(handler);
    assert.equal(result.body.metrics.up, null);
  }
});

const sample = (job, n) => ({metric:{job},value:[clock / 1000,String(n)]});
test('summary distinguishes failed probes, absent metrics, and JVM-only fields', () => {
  const node = 'portfolio-mcp-server', media = 'portfolio-media-service';
  const services = monitoringServices({up:[sample(node,1),sample(media,1)],
    sampleAt:[sample(node,clock/1000),sample(media,clock/1000)],
    probe:[sample(node,0)],probeAt:[sample(node,clock/1000)],
    probeDuration:[sample(node,56)],probeStatus:[sample(node,500)], heapPct:[sample(media,12)]}, clock/1000);
  assert.equal(services.length,13);
  const m = services.find(s=>s.job===media), n = services.find(s=>s.job===node), absent = services.find(s=>s.job===job);
  assert.equal(m.up,true); assert.equal(m.heapPct,12);
  assert.equal(n.up,false); assert.equal(n.status,'check-failed'); assert.equal(n.responseMs,56);
  assert.equal(n.heapPct,null); assert.equal(n.reqPerSec,null);
  assert.equal(absent.status,'unknown'); assert.equal(absent.noMetrics,true);
});

test('summary does not invent zero traffic, idle, or healthy results for stale samples', () => {
  const rows = monitoringServices({up:[sample(job,1)],sampleAt:[sample(job,clock/1000-500)],reqRate:[sample(job,0)]},clock/1000);
  const service = rows.find(s=>s.job===job);
  assert.equal(service.up,false); assert.equal(service.reqPerSec,null); assert.equal(service.status,'unknown');
  const missingProbe = monitoringServices({up:[sample('portfolio-voice-relay',1)],sampleAt:[sample('portfolio-voice-relay',clock/1000)]},clock/1000).find(s=>s.job==='portfolio-voice-relay');
  assert.equal(missingProbe.status,'unknown');
});
