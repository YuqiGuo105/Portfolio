import { parseDocument } from 'yaml';
import { createHash } from 'node:crypto';

const SOURCE = 'https://raw.githubusercontent.com/YuqiGuo105/portfolio-admin-service/main/monitoring/services.yaml';
const LIMIT = 65536;
const safeText = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\x00-\x1f]/.test(value);

// Only the public projection leaves this server module; endpoints and access data never do.
export function parsePublicRegistry(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > LIMIT) throw new Error('Invalid monitoring registry size');
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error('Invalid monitoring YAML');
  const data = doc.toJS({ maxAliasCount: 0 });
  if (data?.version !== 1 || !Array.isArray(data.services) || !data.services.length || data.services.length > 50) throw new Error('Invalid monitoring registry');
  const ids = new Set(), entries = [];
  for (const s of data.services) {
    if (!s || typeof s.id !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(s.id) || ['constructor', 'prototype'].includes(s.id) || ids.has(s.id)) throw new Error('Invalid monitoring ID');
    ids.add(s.id);
    if (!safeText(s.name, 80) || !['jvm', 'health'].includes(s.monitoring) || typeof s.public !== 'boolean' || !Number.isInteger(s.intervalSeconds) || s.intervalSeconds < 60 || s.intervalSeconds > 900) throw new Error('Invalid monitoring template');
    if (s.repo != null && (typeof s.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(s.repo))) throw new Error('Invalid repository');
    if (s.purpose != null && !safeText(s.purpose, 300)) throw new Error('Invalid description');
    if (s.stack != null && (!Array.isArray(s.stack) || s.stack.length > 8 || s.stack.some(v => !safeText(v, 40)))) throw new Error('Invalid stack');
    if (s.public) entries.push([s.id, { name: s.name, monitoring: s.monitoring === 'health' ? 'probe' : 'jvm', intervalSeconds: s.intervalSeconds,
      purpose: s.purpose || '', stack: s.stack || [], ...(s.repo ? { repo: s.repo, repositoryUrl: `https://github.com/YuqiGuo105/${s.repo}` } : {}) }]);
  }
  return { catalog: Object.fromEntries(entries), revision: createHash('sha256').update(source).digest('hex').slice(0, 16) };
}

export function createRegistryLoader({ fetchImpl = fetch, now = Date.now, ttlMs = 300000, maxStaleMs = 900000, timeoutMs = 2500 } = {}) {
  let cached, fetchedAt = 0, retryAt = 0, pending;
  return async function load() {
    if (cached && now() - fetchedAt < ttlMs) return cached;
    if (now() < retryAt) {
      if (cached && now() - fetchedAt < maxStaleMs) return cached;
      throw new Error('Monitoring registry unavailable');
    }
    if (!pending) pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(SOURCE, { redirect: 'error', signal: controller.signal, headers: { Accept: 'text/plain' } });
        if (!response.ok || Number(response.headers.get('content-length')) > LIMIT) throw new Error('Registry fetch failed');
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > LIMIT) throw new Error('Registry too large');
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel(); }
        cached = parsePublicRegistry(Buffer.concat(chunks).toString('utf8'));
        fetchedAt = now(); retryAt = 0;
        return cached;
      } catch {
        retryAt = now() + 30000;
        if (cached && now() - fetchedAt < maxStaleMs) return cached;
        // Fail closed on cold starts instead of exposing removed/private entries from a bundled list.
        throw new Error('Monitoring registry unavailable');
      } finally { clearTimeout(timer); }
    })().finally(() => { pending = null; });
    return pending;
  };
}

export const loadMonitoringRegistry = createRegistryLoader();
export const loadPublicServiceCatalog = async () => (await loadMonitoringRegistry()).catalog;

export function publicJobSelector(catalog) {
  const jobs = Object.keys(catalog);
  if (jobs.some(job => !/^[a-z][a-z0-9-]{0,62}$/.test(job))) throw new Error('Invalid public job');
  return `job=~"${jobs.join('|') || '__no_public_services__'}"`;
}
