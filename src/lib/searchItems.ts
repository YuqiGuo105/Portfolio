import { createClient, PostgrestError } from '@supabase/supabase-js';

export type SearchItem = {
  id: number;
  source: string;
  sourceTable: string;
  sourceId: string;
  title: string | null;
  description: string | null;
  url: string | null;
  tags: string | null;
  publishedAt: string | null;
};

export type SearchParams = {
  q: string;
  source?: string;
  limit?: number;
  offset?: number;
};

type SearchItemRow = {
  id: number;
  source: string;
  source_table: string;
  source_id: string;
  title: string | null;
  description: string | null;
  url: string | null;
  tags: string | null;
  published_at: string | null;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabaseClient = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

function getClient() {
  if (!supabaseClient) {
    throw new Error('Supabase credentials are not configured');
  }
  return supabaseClient;
}

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

  const client = getClient();
  const searchTerm = `%${q.trim()}%`;

  const filters = [
    `title.ilike.${searchTerm}`,
    `description.ilike.${searchTerm}`,
    `tags.ilike.${searchTerm}`,
    `content.ilike.${searchTerm}`,
  ];

  let query = client
    .from('search_items')
    .select(
      'id, source, source_table, source_id, title, description, url, tags, published_at',
      { count: 'exact' }
    )
    .or(filters.join(','))
    .order('published_at', { ascending: false, nullsLast: true })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (source) {
    query = query.eq('source', source);
  }

  let { data, error, count } = await query;

  if (error && error.message && error.message.includes('content')) {
    const fallbackFilters = filters.filter((value) => !value.startsWith('content.'));
    const fallbackQuery = client
      .from('search_items')
      .select(
        'id, source, source_table, source_id, title, description, url, tags, published_at',
        { count: 'exact' }
      )
      .or(fallbackFilters.join(','))
      .order('published_at', { ascending: false, nullsLast: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const fallbackResult = await fallbackQuery;
    data = fallbackResult.data;
    error = fallbackResult.error as PostgrestError | null;
    count = fallbackResult.count;
  }

  if (error) {
    throw error as PostgrestError;
  }

  const results: SearchItem[] = (data || []).map((item: SearchItemRow) => ({
    id: item.id,
    source: item.source,
    sourceTable: item.source_table,
    sourceId: item.source_id,
    title: item.title,
    description: item.description,
    url: item.url,
    tags: item.tags,
    publishedAt: item.published_at ? new Date(item.published_at).toISOString() : null,
  }));

  return {
    results,
    total: count || 0,
    limit,
    offset,
  };
}
