/**
 * searchItems — queries Aiven OpenSearch (portfolio_content_current index).
 *
 * Server-side only. Credentials come from environment variables:
 *   OPENSEARCH_HOST, OPENSEARCH_PORT, OPENSEARCH_USERNAME, OPENSEARCH_PASSWORD
 *   OPENSEARCH_INDEX  (default: portfolio_content_current)
 *
 * The browser never calls OpenSearch directly — results flow through the
 * Next.js proxy route (pages/api/search.js or app/api/search/route.ts).
 */

export type SearchItem = {
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

// Map OpenSearch source_type → human label + sourceTable used by SearchOverlay
const SOURCE_TYPE_META: Record<string, { label: string; table: string }> = {
  BLOG:       { label: 'Blog',     table: 'Blogs' },
  LIFE_BLOG:  { label: 'Life',     table: 'life_blogs' },
  PROJECT:    { label: 'Projects', table: 'Projects' },
  EXPERIENCE: { label: 'Resume',   table: 'experience' },
};

// Filter map — SearchOverlay sends "blog" / "project" / "life" / ""
const SOURCE_FILTER_MAP: Record<string, string[]> = {
  blog:    ['BLOG'],
  project: ['PROJECT'],
  life:    ['LIFE_BLOG'],
  resume:  ['EXPERIENCE'],
};

function buildQuery(q: string, sourceFilter?: string, limit = 20, offset = 0) {
  const types = sourceFilter ? (SOURCE_FILTER_MAP[sourceFilter.toLowerCase()] ?? []) : [];
  const fields = ['title^3', 'summary^2', 'content', 'tags^2', 'category'];

  // Combine full-token fuzzy matching with phrase-prefix matching so partial
  // words ("kub" → "Kubernetes") still surface results, instead of relying on
  // fuzziness alone (AUTO allows at most 2 edits and can never bridge a long
  // prefix → full-word gap).
  const matchQuery = {
    bool: {
      should: [
        {
          multi_match: {
            query: q,
            fields,
            type: 'best_fields',
            fuzziness: 'AUTO',
          },
        },
        {
          multi_match: {
            query: q,
            fields,
            type: 'phrase_prefix',
            slop: 2,
          },
        },
      ],
      minimum_should_match: 1,
    },
  };

  const query = types.length > 0
    ? {
        bool: {
          must: matchQuery,
          filter: [{ terms: { source_type: types } }],
        },
      }
    : matchQuery;

  return {
    from: offset,
    size: limit,
    query,
    _source: [
      'source_type', 'source_id', 'title', 'summary',
      'tags', 'url', 'image_url', 'published_at', 'visibility',
    ],
  };
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

  const host     = process.env.OPENSEARCH_HOST     || 'os-b4cbaea-yuqi-791c.a.aivencloud.com';
  const port     = process.env.OPENSEARCH_PORT     || '27099';
  const username = process.env.OPENSEARCH_USERNAME || 'avnadmin';
  const password = process.env.OPENSEARCH_PASSWORD || '';
  const index    = process.env.OPENSEARCH_INDEX    || 'portfolio_content_current';

  if (!password) {
    console.error('[search] OPENSEARCH_PASSWORD is not set');
    return { results: [], total: 0, limit, offset };
  }

  const endpoint = `https://${host}:${port}/${index}/_search`;
  const body = buildQuery(q.trim(), source, limit, offset);

  const token = Buffer.from(`${username}:${password}`).toString('base64');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenSearch error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as {
    hits: {
      total: { value: number } | number;
      hits: Array<{
        _id: string;
        _score: number;
        _source: {
          source_type: string;
          source_id: string;
          title?: string;
          summary?: string;
          tags?: string[];
          url?: string;
          image_url?: string;
          published_at?: string;
          visibility?: string;
        };
      }>;
    };
  };

  const totalValue = typeof data.hits.total === 'object'
    ? data.hits.total.value
    : data.hits.total;

  const results: SearchItem[] = data.hits.hits.map((hit, idx) => {
    const s = hit._source;
    const meta = SOURCE_TYPE_META[s.source_type] ?? {
      label: s.source_type ?? 'Content',
      table: s.source_type ?? '',
    };
    return {
      id: idx,
      source: meta.label,
      sourceTable: meta.table,
      sourceId: s.source_id ?? hit._id,
      title: s.title ?? null,
      description: s.summary ?? null,
      url: s.url ?? null,
      tags: Array.isArray(s.tags) ? s.tags.join(', ') : (s.tags ?? null),
      publishedAt: s.published_at ?? null,
      rank: hit._score,
    };
  });

  return { results, total: totalValue, limit, offset };
}

