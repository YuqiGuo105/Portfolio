const TYPES = { blog: 'BLOG', project: 'PROJECT', life: 'LIFE_BLOG', resume: 'EXPERIENCE' };
const LABELS = { BLOG: ['Blog', 'Blogs'], PROJECT: ['Projects', 'Projects'], LIFE_BLOG: ['Life', 'life_blogs'], EXPERIENCE: ['Resume', 'experience'] };

export async function rankedSearch(params, { fetchImpl = fetch, env = process.env } = {}) {
  const query = String(params.q ?? '').trim();
  if (!query || query.length > 300) throw new RangeError('Search query must contain 1 to 300 characters');
  const source = String(params.source ?? '').toLowerCase();
  if (source && !TYPES[source]) throw new RangeError('Invalid search category');
  const finite = (n, fallback, max) => Number.isFinite(Number(n)) ? Math.max(0, Math.min(max, Math.trunc(Number(n)))) : fallback;
  const limit = Math.max(1, finite(params.limit ?? 20, 20, 50));
  const offset = finite(params.offset ?? 0, 0, 200);
  const endpoint = new URL(env.MCP_SEARCH_URL || 'https://portfolio-mcp-server-702193211434.us-central1.run.app/api/search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('limit', String(limit));
  endpoint.searchParams.set('offset', String(offset));
  if (source) endpoint.searchParams.set('types', TYPES[source]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(endpoint, { signal: controller.signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('Search temporarily unavailable');
    const payload = await response.json();
    if (!Array.isArray(payload.results) || payload.results.length > 50 || !Number.isFinite(payload.total)) throw new Error('Invalid search response');
    const results = payload.results.map((item, index) => {
      const meta = LABELS[item.type];
      if (!meta || (source && item.type !== TYPES[source])) throw new Error('Invalid search collection');
      const url = new URL(item.url);
      if (url.origin !== 'https://www.yuqi.site' || url.username || url.password) throw new Error('Invalid search result URL');
      return { id: item.key ?? `${item.type}:${item.id}`, source: meta[0], sourceTable: meta[1], sourceId: String(item.id),
        title: String(item.title ?? '').slice(0, 500), description: String(item.summary ?? '').slice(0, 2000), url: url.href,
        tags: (Array.isArray(item.tags) ? item.tags : []).filter(t => typeof t === 'string').slice(0, 3).join(', '),
        sourceRequiresLogin: item.sourceRequiresLogin === true, publishedAt: null, rank: offset + index + 1 };
    });
    return { results, total: payload.total, limit, offset, requestId: payload.requestId,
      modelVersion: payload.modelVersion, indexVersion: payload.indexVersion, tookMs: payload.tookMs };
  } finally { clearTimeout(timer); }
}
