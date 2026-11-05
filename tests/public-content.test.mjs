import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOG_CARD_COLUMNS, LIFE_BLOG_CARD_COLUMNS, PROJECT_CARD_COLUMNS, firstSystemByProject, loadLifeBlogCards,
  loadProjectCards, loadTechBlogCards, orEmpty, publicServerClient,
} from '../src/lib/publicContent.mjs';

// A Supabase query builder that records each call and answers with the rows given per table.
function fakeClient(rowsByTable) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = { table, steps: [] };
      calls.push(query);
      const chain = new Proxy({}, {
        get(_, method) {
          if (method === 'abortSignal') return () => Promise.resolve({ data: rowsByTable[table] ?? [], error: null });
          return (...args) => { query.steps.push([method, ...args]); return chain; };
        },
      });
      return chain;
    },
  };
}

test('list pages read published project cards without article bodies', async () => {
  const client = fakeClient({
    Projects: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    project_subsystems: [{ id: 1, project_id: 'a', sort_order: 0 }, { id: 2, project_id: 'a', sort_order: 1 }, { id: 3, project_id: 'b', sort_order: 0 }],
  });
  const { projects, systems } = await loadProjectCards(client, { featuredOnly: true });
  assert.deepEqual(projects.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(Object.fromEntries(Object.entries(systems).map(([k, v]) => [k, v.id])), { a: 1, b: 3 }, 'first subsystem per project');
  const [projectQuery, systemQuery] = client.calls;
  assert.deepEqual(projectQuery.steps[0], ['select', PROJECT_CARD_COLUMNS]);
  assert.ok(projectQuery.steps.some(([m, c, v]) => m === 'eq' && c === 'publication_status' && v === 'PUBLISHED'), 'published only');
  assert.ok(projectQuery.steps.some(([m, c, v]) => m === 'eq' && c === 'featured' && v === true));
  assert.ok(systemQuery.steps.some(([m, c, v]) => m === 'eq' && c === 'active' && v === true));
  for (const columns of [PROJECT_CARD_COLUMNS, BLOG_CARD_COLUMNS, LIFE_BLOG_CARD_COLUMNS]) {
    assert.doesNotMatch(columns, /\bcontent\b|\*/, 'no article bodies in page props');
  }
});

test('blog cards, a missing configuration and failures all leave the page renderable', async () => {
  const client = fakeClient({ Blogs: [{ id: 't' }], life_blogs: [{ id: 1 }] });
  assert.deepEqual(await loadTechBlogCards(client), [{ id: 't' }]);
  assert.deepEqual(await loadLifeBlogCards(client, { ascending: true }), [{ id: 1 }]);
  assert.deepEqual(client.calls[1].steps.find(([m]) => m === 'order'), ['order', 'created_at', { ascending: true }]);
  assert.equal(publicServerClient({}), null);
  assert.deepEqual(await loadProjectCards(null), { projects: [], systems: {} });
  assert.deepEqual(await loadTechBlogCards(null), []);
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(await orEmpty(async () => { throw new Error('timeout'); }, [], 'blogs'), []);
  } finally { console.warn = warn; }
  assert.deepEqual(firstSystemByProject(null), {});
});
