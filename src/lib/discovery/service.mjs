import { randomUUID } from 'node:crypto';
import { digest } from './provider.mjs';
import { publicCard } from './catalog.mjs';
import { hybrid, recommend, safeQuery, searchRow, suggestions, VERSION } from './core.mjs';

export function createDiscoveryService({ store, provider, loadCatalog, secondarySearch = async () => [], now = Date.now }) {
  const flights = new Map();
  const cached = async (key, ttl, load) => {
    const hit = await store.get(key);
    if (hit) return hit;
    if (flights.has(key)) return flights.get(key);
    const pending = (async () => { const value = await load(); await store.set(key, value, ttl); return value; })();
    flights.set(key, pending);
    try { return await pending; } finally { flights.delete(key); }
  };
  const stats = async () => await store.get('learning-public') || { home: {}, pairs: {}, queries: {}, metrics: {} };
  async function issued(kind, values) {
    const id = randomUUID();
    // Keep attribution available through the hourly batch and a bounded outage.
    await store.set(`issued:${id}`, { kind, ...values, at: now() }, 26 * 3600);
    return id;
  }
  return {
    stats,
    async suggest(q) {
      const { items } = await loadCatalog();
      const state = await stats();
      return { suggestions: suggestions(q, items, state.queries), modelVersion: VERSION };
    },
    async recommendations(contentId) {
      const { items, version } = await loadCatalog();
      const current = items.find(item => item.id === contentId || item.contentId === contentId);
      if (!current) return { items: [] };
      const snapshot = await store.get(`recommendations:${version}`);
      const rows = snapshot?.[current.id] || recommend(current, items);
      // Rejoin cached ids against the current public catalog before exposing any metadata.
      const cards = rows.map(row => { const item = items.find(x => x.id === row.id); return item ? { ...publicCard(item), reason: row.reason } : null; }).filter(Boolean);
      return { items: cards, requestId: await issued('recommendation', { from: current.id, ids: cards.map(item => item.id) }), modelVersion: VERSION };
    },
    async search(q, source = '', semantic = false) {
      if (typeof q !== 'string' || !q.trim() || q.length > 300 || !['', 'project', 'blog'].includes(source)) throw new RangeError('Invalid discovery search');
      const { items: all, version } = await loadCatalog();
      // Preserve experience and gated-life metadata in All without sending either to a new model.
      const extraPromise = source ? Promise.resolve([]) : secondarySearch(q).catch(() => []);
      const items = source ? all.filter(item => item.type === source) : all;
      const cacheKey = `search:${version}:${source}:${semantic}:${digest(q.toLowerCase().trim())}`;
      const result = await cached(cacheKey, 900, async () => {
        let vector = null, mode = 'keyword';
        const vectors = semantic ? await store.get(`vectors:${version}`) || {} : {};
        if (semantic && Object.keys(vectors).length) {
          try { vector = await cached(`query-vector:${digest(q)}`, 3600, () => provider.embed(q, 'query')); mode = 'hybrid'; } catch { /* Keyword fallback, no paid retries. */ }
        }
        let ranked = hybrid(q, items, vectors, vector).slice(0, 20);
        if (semantic && ranked.length > 1) {
          try { const top = await provider.rerank(q, ranked.slice(0, 8)); ranked = [...top, ...ranked.slice(8)]; mode += '+rerank'; } catch { /* Keep the usable retrieval order. */ }
        }
        return { ids: ranked.map(item => item.id), mode };
      });
      const results = [...result.ids.map(id => items.find(item => item.id === id)).filter(Boolean).map(searchRow), ...(await extraPromise)]
        .slice(0, 20).map((item, index) => ({ ...item, rank: index + 1 }));
      return { results, total: results.length, limit: 20, offset: 0, modelVersion: `${VERSION}:${result.mode}`,
        requestId: await issued('search', { ids: results.map(item => item.id), query: safeQuery(q, all) }) };
    },
    async rebuild({ embeddings = true, maxNewEmbeddings = 20, timeBudgetMs = 240000 } = {}) {
      const { items, version } = await loadCatalog(), vectors = {};
      const deadline = now() + Math.min(240000, Math.max(0, timeBudgetMs));
      const limit = Math.min(20, Math.max(0, maxNewEmbeddings));
      let embedded = 0, unavailable = 0, deferred = 0, attempted = 0;
      for (const item of items) {
        if (!embeddings) continue;
        try {
          const key = `embedding:${digest(item.text)}`;
          const hit = await store.get(key);
          if (hit) { vectors[item.id] = hit; continue; }
          if (attempted >= limit || now() >= deadline) { deferred++; continue; }
          attempted++;
          vectors[item.id] = await provider.embed(item.text);
          await store.set(key, vectors[item.id], 30 * 86400); embedded++;
        } catch { unavailable++; }
      }
      const state = await stats(), recommendations = {};
      for (const item of items) recommendations[item.id] = recommend(item, items, vectors, state.pairs);
      await store.set(`vectors:${version}`, vectors, 2 * 86400);
      await store.set(`recommendations:${version}`, recommendations, 2 * 86400);
      const result = { at: new Date(now()).toISOString(), documents: items.length, vectors: Object.keys(vectors).length, embedded, unavailable, deferred, version };
      await store.set('last-build', result, 30 * 86400);
      return result;
    },
  };
}
