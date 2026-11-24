// The three fixed examples of the public MCP playground: what a visitor is asked, and the one
// tool call each example makes. The page shows the call before it runs; the server is the only
// side that sends it, and it sends exactly what is written here. Nothing is taken from a request.

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export const MCP_SCENARIOS = freeze({
  projects: {
    label: 'Project match', question: "Which project demonstrates Yuqi's distributed-systems experience?",
    tool: { name: 'search_portfolio', arguments: { query: 'distributed systems', types: ['PROJECT'], limit: 3 } },
  },
  kubernetes: {
    label: 'Article search', question: 'Find articles about Kubernetes.',
    tool: { name: 'search_articles', arguments: { keyword: 'Kubernetes', sourceType: 'BLOG', limit: 3 } },
  },
  publishing: {
    label: 'Publish flow', question: 'How does content move from publishing to search and AI retrieval?',
    tool: { name: 'get_project', arguments: { projectId: '8edf9020-39b6-4db4-83b3-43c459bef1cf', format: 'html' } },
  },
});

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * A call's arguments as `{ key, value }` pairs short enough to read on one line: strings in
 * quotes, lists in brackets, and a record ID cut to its first eight characters. The full
 * arguments stay in the raw request under the result.
 */
export function callArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const show = value => {
    if (typeof value === 'string') return UUID.test(value) ? `"${value.slice(0, 8)}…"` : JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(show).join(', ')}]`;
    return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '…';
  };
  return Object.entries(args).map(([key, value]) => ({ key, value: show(value) }));
}
