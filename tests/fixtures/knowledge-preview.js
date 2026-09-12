import { useMemo } from 'react';
import KnowledgeManager from '../../src/components/admin/KnowledgeManager';

// Synthetic, in-memory UI fixture. Never mounted by a production route.
export function createPreviewApi() {
  let rows = Array.from({ length: 27 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    revision: String(index + 1).padStart(32, '0'), editable: true,
    createdAt: '2026-09-11T12:00:00Z', content: `Synthetic knowledge answer ${index + 1}. No production data.`,
    metadata: { title: index === 0 ? 'Platform reliability' : `Knowledge note ${index + 1}`, question: 'How does this work?', status: 'DRAFT', answer_visibility: 'private' },
    indexing: { status: 'DISABLED' },
  }));
  rows.push({ ...rows[0], id: '00000000-0000-4000-8000-000000000099', editable: false,
    metadata: { title: 'Generated project chunk', source_type: 'PROJECT', source_id: 'example-project', status: 'ACTIVE', answer_visibility: 'public' },
    indexing: { status: 'PROJECTION' } });
  let version = 100;
  function find(id) { const row = rows.find(row => row.id === id); if (!row) throw new Error('Knowledge record not found'); return row; }
  function changed(row, body) {
    return { ...row, content: body.content, revision: String(++version).padStart(32, '0'),
      metadata: { title: body.title, question: body.question, status: body.status, answer_visibility: body.answerVisibility },
      indexing: { status: body.status === 'ACTIVE' ? 'PENDING' : 'DISABLED' } };
  }
  return {
    async list({ query, scope, status, limit, offset }) {
      const filtered = rows.filter(row => (scope === 'ALL' || row.editable === (scope === 'OWNED'))
        && (status === 'ALL' || row.metadata.status === status)
        && `${row.metadata.title} ${row.content}`.toLowerCase().includes(query.toLowerCase()));
      return { total: filtered.length, items: filtered.slice(offset, offset + limit).map(row => ({
        id: row.id, title: row.metadata.title, preview: row.content, status: row.metadata.status,
        editable: row.editable, sourceType: row.metadata.source_type,
      })) };
    },
    async get(id) { return structuredClone(find(id)); },
    async create(body) {
      const row = changed({ id: crypto.randomUUID(), editable: true, createdAt: new Date().toISOString() }, body);
      rows.unshift(row); return structuredClone(row);
    },
    async update(id, body) {
      const current = find(id);
      if (current.revision !== body.expectedRevision) throw new Error('This knowledge record changed. Reload it before saving or deleting.');
      const row = changed(current, body); rows = rows.map(value => value.id === id ? row : value);
      return structuredClone(row);
    },
    async remove(id, revision) {
      if (find(id).revision !== revision) throw new Error('Revision conflict');
      rows = rows.filter(row => row.id !== id);
    },
  };
}

export default function KnowledgePreview() {
  const api = useMemo(createPreviewApi, []);
  return <>
    <header style={{ padding: '16px 24px', borderBottom: '1px solid #dde3e6', background: '#fff', fontSize: 13 }}><strong>YUQI ADMIN</strong> / Knowledge base <span style={{ float: 'right', color: '#69777f' }}>Local preview / Sample data</span></header>
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}><KnowledgeManager api={api} /></main>
  </>;
}
