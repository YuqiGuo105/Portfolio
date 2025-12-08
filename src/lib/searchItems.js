import { supabase } from "../supabase/supabaseClient";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const sanitizeLimit = (limit) => {
  if (typeof limit !== "number" || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
};

const sanitizeOffset = (offset) => {
  if (typeof offset !== "number" || Number.isNaN(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
};

export async function searchItems({ q, source, limit, offset }) {
  const safeLimit = sanitizeLimit(limit);
  const safeOffset = sanitizeOffset(offset);

  if (!q || !q.trim()) {
    return { results: [], total: 0, limit: safeLimit, offset: safeOffset };
  }

  const searchTerm = `%${q.trim()}%`;
  const filters = [
    `title.ilike.${searchTerm}`,
    `description.ilike.${searchTerm}`,
    `tags.ilike.${searchTerm}`,
    `content.ilike.${searchTerm}`,
  ];

  let query = supabase
    .from("search_items")
    .select(
      "id, source, source_table, source_id, title, description, url, tags, published_at",
      { count: "exact" }
    )
    .or(filters.join(","))
    .order("published_at", { ascending: false, nullsLast: true })
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (source) {
    query = query.eq("source", source);
  }

  let { data, error, count } = await query;

  // Some deployments may not include the optional `content` column.
  if (error && error.message && error.message.includes("content")) {
    const fallbackFilters = filters.filter((value) => !value.startsWith("content."));
    const fallbackQuery = supabase
      .from("search_items")
      .select(
        "id, source, source_table, source_id, title, description, url, tags, published_at",
        { count: "exact" }
      )
      .or(fallbackFilters.join(","))
      .order("published_at", { ascending: false, nullsLast: true })
      .order("created_at", { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1);

    const fallbackResult = await fallbackQuery;
    data = fallbackResult.data;
    error = fallbackResult.error;
    count = fallbackResult.count;
  }

  if (error) {
    throw error;
  }

  const results = (data || []).map((item) => ({
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
    limit: safeLimit,
    offset: safeOffset,
  };
}
