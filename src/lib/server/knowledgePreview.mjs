const SOURCE_TABLES = ['Blogs', 'Projects', 'life_blogs', 'experience'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'id,content,metadata,created_at';

export function previewEnabled(env = process.env) {
  return env.NODE_ENV === 'development' && env.NEXT_PUBLIC_KNOWLEDGE_READ_ONLY_PREVIEW === 'true';
}

function owned(row) {
  return !row.metadata?.source_type && !SOURCE_TABLES.includes(row.metadata?.source);
}

export function searchOptions(body = {}) {
  const { query = '', scope = 'OWNED', status = 'ALL' } = body.filter || {};
  const { size = 25, offset = 0 } = body.page || {};
  if (typeof query !== 'string' || query.length > 300 || query.includes('\0')
    || !['OWNED', 'INDEXED', 'ALL'].includes(scope)
    || !['ALL', 'DRAFT', 'ACTIVE', 'ARCHIVED', 'SUPERSEDED', 'LEGACY'].includes(status)
    || !Number.isInteger(size) || size < 1 || size > 25
    || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error('Invalid knowledge search');
  const conditions = [];
  const tables = SOURCE_TABLES.map(value => JSON.stringify(value)).join(',');
  if (scope === 'OWNED') conditions.push(`or(metadata->>source_type.is.null,metadata->>source_type.eq.""),or(metadata->>source.is.null,metadata->>source.not.in.(${tables}))`);
  if (scope === 'INDEXED') conditions.push(`or(and(metadata->>source_type.not.is.null,metadata->>source_type.neq.""),metadata->>source.in.(${tables}))`);
  if (status === 'LEGACY') conditions.push('metadata->>status.is.null');
  else if (status !== 'ALL') conditions.push(`metadata->>status.eq.${status}`);
  if (query) {
    // Quoted PostgREST literals prevent query syntax from being interpreted as filters.
    const literal = JSON.stringify(`%${query.replace(/[\\%_*]/g, '\\$&')}%`);
    conditions.push(`or(content.ilike.${literal},metadata->>title.ilike.${literal},metadata->>question.ilike.${literal})`);
  }
  return { size, offset, filter: conditions.length ? `and(${conditions.join(',')})` : null };
}

function check(result) {
  if (result.error) throw new Error('Live knowledge query failed');
  return result.data;
}

export async function searchKnowledge(client, body) {
  const { size, offset, filter } = searchOptions(body);
  let query = client.from('kb_documents').select(FIELDS, { count: 'exact' });
  if (filter) query = query.or(filter);
  const response = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + size - 1);
  const rows = check(response) || [];
  return { total: response.count, limit: size, offset, items: rows.map(row => ({
    id: row.id, title: row.metadata?.title || row.metadata?.question || 'Untitled knowledge',
    preview: (row.content || '').slice(0, 180), status: row.metadata?.status || 'LEGACY',
    sourceType: row.metadata?.source_type || row.metadata?.type || 'NOTE',
    editable: owned(row), createdAt: row.created_at,
  })), connection: { mode: 'LIVE_READ_ONLY', source: 'kb_documents' } };
}

export async function getKnowledgeBatch(client, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 25 || ids.some(id => typeof id !== 'string' || !UUID.test(id)))
    throw new Error('Choose 1-25 knowledge UUIDs');
  const unique = [...new Set(ids)];
  const records = check(await client.from('kb_documents').select(FIELDS).in('id', unique)) || [];
  const byId = new Map(records.map(row => [row.id, {
    id: row.id, content: row.content || '', metadata: row.metadata || {},
    createdAt: row.created_at, revision: 'Read-only preview', editable: owned(row),
    indexing: { status: owned(row) ? 'SOURCE_RECORD' : row.metadata?.status || 'LEGACY' },
  }]));
  return { items: unique.map(id => ({ id, found: byId.has(id), ...(byId.has(id) ? { record: byId.get(id) } : {}) })),
    batch: { requested: unique.length, found: records.length, maxSize: 25 } };
}
