/**
 * searchItems — proxies to the writer-service full-text search API.
 *
 * writer-service uses PostgreSQL websearch_to_tsquery (FTS) with an ILIKE
 * fallback, giving relevance-ranked results across writer.blogs,
 * writer.life_blogs, and writer.projects.
 *
 * Server-side callers (pages/api/search.js, app/api/search/route.ts) use
 * WRITER_API_URL (private). The browser never calls writer-service directly
 * for search — it always goes through the Next.js proxy route.
 */

// Server-side base URL (never exposed to the browser).
const WRITER_API_BASE =
  process.env.WRITER_API_URL ||
  process.env.NEXT_PUBLIC_WRITER_API_URL ||
  'http://localhost:8081';

export type SearchItem = {
  // writer-service returns sourceId (string UUID or bigint) instead of numeric id
  id?: number;
  source: string;
  sourceTable: string;
  sourceId: string;
  title: string | null;
  description: string | null;
  url: string | null;
  tags: string | null;
  publishedAt: string | null;
  rank?: number;
};

export type SearchParams = {
  q: string;
  source?: string;
  limit?: number;
  offset?: number;
};

function sanitizeLimit(limit?: number) {
  const fallback = 20;
  if (typeof limit !== 'number' || Number.isNaN(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 50);
}

function sanitizeOffset(offset?: number) {
  if (typeof offset !== 'number' || Number.isNaN(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}

export async function searchItems(params: SearchParams): Promise<{
  results: SearchItem[];
  total: number;
  limit: number;
  offset: number;
}> {
  const { q, source } = params;
  const limit = sanitizeLimit(params.limit);
  const offset = sanitizeOffset(params.offset);

  if (!q || !q.trim()) {
    return { results: [], total: 0, limit, offset };
  }

  const url = new URL(`${WRITER_API_BASE}/api/search`);
  url.searchParams.set('q', q.trim());
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (source) url.searchParams.set('source', source);

  const res = await fetch(url.toString(), {
    headers: { 'Content-Type': 'application/json' },
    // Next.js server-side fetch — no caching for real-time results
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Search API error: ${res.status}`);
  }

  const data = await res.json() as {
    results: Array<{
      source: string;
      sourceTable: string;
      sourceId: string;
      title: string | null;
      description: string | null;
      url: string | null;
      tags: string | null;
      publishedAt: string | null;
      rank?: number;
    }>;
    total: number;
    limit: number;
    offset: number;
  };

  const results: SearchItem[] = (data.results || []).map((item, idx) => ({
    id: idx,
    source: item.source,
    sourceTable: item.sourceTable,
    sourceId: item.sourceId,
    title: item.title,
    description: item.description,
    url: item.url,
    tags: item.tags,
    publishedAt: item.publishedAt,
    rank: item.rank,
  }));

  return {
    results,
    total: data.total ?? results.length,
    limit,
    offset,
  };
}
