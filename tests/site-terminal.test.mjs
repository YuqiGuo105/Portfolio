import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMAND_NAMES, complete, runCommand, suggest, tokenize } from '../src/lib/terminalCommands.mjs';
import { createTerminalMcpHandler, callTerminalTool, validateToolCall } from '../src/lib/terminalMcp.mjs';

const evolution = JSON.parse(readFileSync(new URL('../docs/architecture/platform-evolution.json', import.meta.url))).milestones;
const text = (lines) => lines.map((l) => l.text).join('\n');

function ctx(overrides = {}) {
  const calls = [];
  const opened = [];
  return {
    calls, opened,
    callTool: async (tool, args) => {
      calls.push([tool, args]);
      if (tool === 'list_projects') return { result: { items: [{ title: 'Event pipeline', url: 'https://www.yuqi.site/work-single/p1', tags: ['Kafka', 'Outbox'] }] } };
      if (tool === 'get_profile') return { result: { experience: [{ company: 'Acme', title: 'Engineer', period: '2024 - Current' }], links: [{ label: 'GitHub', url: 'https://github.com/x' }], cv: 'https://www.yuqi.site/cv' } };
      return { tool, request: { jsonrpc: '2.0', id: 'abc', method: 'tools/call', params: { name: tool, arguments: args } }, result: { items: [] }, elapsedMs: 42 };
    },
    fetchJson: async () => ({ services: [
      { job: 'portfolio-admin-service', up: true, reqPerSec: 0.5, uptimeSeconds: 90000 },
      { job: 'portfolio-rag-indexer', up: false, noMetrics: true },
      { job: 'knowledge-service', up: false, noMetrics: false },
    ] }),
    loadEvolution: async () => evolution,
    whereami: async () => ({ known: true, city: 'Tokyo', country: 'JP' }),
    open: (path) => { opened.push(path); return [{ text: `→ ${path}` }]; },
    now: () => new Date('2026-10-27T12:00:00Z'),
    history: () => ['help'],
    clear: () => {},
    close: () => {},
    ...overrides,
  };
}

test('tokenize keeps quoted words together; suggestions catch typos', () => {
  assert.deepEqual(tokenize('mcp call search_portfolio "event driven" kafka'), ['mcp', 'call', 'search_portfolio', 'event driven', 'kafka']);
  assert.equal(suggest('hlep', COMMAND_NAMES), 'help');
  assert.equal(suggest('zzzzzz', COMMAND_NAMES), null);
});

test('help lists the visible commands; unknown commands suggest the closest one', async () => {
  const help = text(await runCommand('help', ctx()));
  for (const name of ['ls', 'cat', 'open', 'mcp', 'kubectl', 'git', 'whoami', 'sudo']) assert.match(help, new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(help, /\bvim\b/);
  assert.match(text(await runCommand('kubeclt get pods', ctx())), /did you mean 'kubectl'/);
});

test('ls projects reads the live MCP list and links each project', async () => {
  const c = ctx();
  const out = await runCommand('ls projects/', c);
  assert.deepEqual(c.calls, [['list_projects', undefined]]);
  const link = out.find((l) => l.href);
  assert.equal(link.href, 'https://www.yuqi.site/work-single/p1');
  assert.match(text(out), /Kafka · Outbox/);
  assert.match(text(await runCommand('ls nowhere', c)), /No such file/);
});

test('cat resume.txt shows experience and public links from get_profile', async () => {
  const out = text(await runCommand('cat resume.txt', ctx()));
  assert.match(out, /Engineer @ Acme/);
  assert.match(out, /github\.com\/x/);
  assert.match(out, /yuqi\.site\/cv/);
});

test('mcp call shows the real JSON-RPC request and result, and validates the tool first', async () => {
  const c = ctx();
  const out = text(await runCommand('mcp call search_portfolio kafka outbox', c));
  assert.deepEqual(c.calls, [['search_portfolio', { query: 'kafka outbox' }]]);
  assert.match(out, /"method": "tools\/call"/);
  assert.match(out, /42 ms/);
  assert.match(text(await runCommand('mcp call admin_publish_content', c)), /unknown tool/);
  assert.match(text(await runCommand('mcp call search_portfolio', c)), /usage/);
  assert.equal(c.calls.length, 1);
  const busy = ctx({ callTool: async () => ({ error: 'rate_limited' }) });
  assert.match(text(await runCommand('ls projects', busy)), /too many calls/);
});

test('kubectl get pods renders live service status, idle consumers as ScaledToZero', async () => {
  const out = await runCommand('kubectl get pods', ctx());
  const body = text(out);
  assert.match(body, /portfolio-admin-service\s+1\/1\s+Running\s+0\.5\s+1d/);
  assert.match(body, /portfolio-rag-indexer\s+0\/1\s+ScaledToZero/);
  assert.equal(out.find((l) => /knowledge-service/.test(l.text)).tone, 'err');
  assert.match(text(await runCommand('kubectl delete pods', ctx())), /usage/);
  assert.match(text(await runCommand('kubectl get pods', ctx({ fetchJson: async () => null }))), /did not answer/);
});

test('git log reads the time machine milestones, newest first, linking each step', async () => {
  const out = await runCommand('git log', ctx());
  const newest = [...evolution].reverse()[0];
  assert.match(out[0].text, new RegExp(newest.evidence[0].sha));
  assert.equal(out[0].href, `/architecture#evolution/${newest.id}`);
  assert.equal(out.filter((l) => l.href).length, 8);
  const all = await runCommand('git log --all', ctx());
  assert.equal(all.filter((l) => l.href).length, evolution.length);
  assert.ok(all.some((l) => l.tone === 'warn' && /fix:/.test(l.text)));
});

test('easter eggs: sudo hire yuqi opens contact; other sudo is refused', async () => {
  const c = ctx();
  assert.match(text(await runCommand('sudo hire yuqi', c)), /Permission granted/);
  assert.deepEqual(c.opened, ['/#contact-section']);
  assert.match(text(await runCommand('sudo rm -rf /', c)), /not in the sudoers file/);
  assert.match(text(await runCommand('whoami', c)), /Tokyo, JP/);
  assert.match(text(await runCommand('open globe', c)), /→ \/analytics/);
  assert.match(text(await runCommand('open glob', c)), /Did you mean 'globe'/);
});

test('tab completion completes commands and their first argument', () => {
  assert.equal(complete('kub'), 'kubectl ');
  assert.equal(complete('ls pro'), 'ls projects ');
  assert.equal(complete('open arch'), 'open architecture ');
  assert.equal(complete('c'), null); // cat, clear, coffee… ambiguous
});

test('the terminal MCP proxy accepts only four read-only tools with validated arguments', () => {
  assert.deepEqual(validateToolCall({ tool: 'search_portfolio', arguments: { query: '  kafka\n outbox ' } }).arguments,
    { query: 'kafka outbox', types: ['PROJECT', 'BLOG'], limit: 5, includeSnippets: false });
  assert.deepEqual(validateToolCall({ tool: 'list_projects', arguments: { page: { size: 999 } } }).arguments, { page: { number: 0, size: 20 } });
  for (const body of [{ tool: 'admin_publish_content' }, { tool: '__proto__' }, { tool: 'get_profile', url: 'x' }, [], null, { tool: 'search_portfolio', arguments: [] }]) {
    assert.throws(() => validateToolCall(body), undefined, JSON.stringify(body));
  }
  assert.throws(() => validateToolCall({ tool: 'search_portfolio', arguments: { query: 'k' } }), { code: 'invalid_arguments' });
});

test('a terminal tool call sends a plain JSON-RPC request without credentials and keeps public fields only', async () => {
  let sent;
  const fetchImpl = async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    const data = { results: [
      { type: 'PROJECT', title: 'P', url: 'https://www.yuqi.site/work-single/p', summary: 's', tags: ['a'], adminNotes: 'SECRET' },
      { type: 'PROJECT', title: 'Evil', url: 'https://evil.example/x' },
    ], total: 2 };
    return Response.json({ jsonrpc: '2.0', id: sent.body.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } });
  };
  const reply = await callTerminalTool(validateToolCall({ tool: 'search_portfolio', arguments: { query: 'kafka' } }), { fetchImpl });
  assert.equal(sent.url, 'https://www.yuqi.site/mcp');
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.options.headers.Authorization, undefined);
  assert.deepEqual(reply.request, sent.body);
  assert.equal(reply.result.items.length, 1);
  assert.ok(!JSON.stringify(reply).includes('SECRET'));
});

test('the terminal MCP endpoint is a cacheable GET; errors and rate limits are never cached', async () => {
  const res = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const req = (query, method = 'GET') => ({ method, query, headers: { host: 'www.yuqi.site' }, socket: {} });
  const limited = createTerminalMcpHandler({ isRateLimited: async (_ip, scope) => scope === 'mcp-terminal', run: async () => ({ ok: true }) });
  const r1 = res(); await limited(req({ tool: 'get_profile' }), r1);
  assert.equal(r1.statusCode, 429); assert.equal(r1.headers['Cache-Control'], 'no-store');
  const ok = createTerminalMcpHandler({ isRateLimited: async () => false, run: async (call) => ({ call }) });
  const r2 = res(); await ok(req({ tool: 'search_portfolio', q: 'Kafka' }), r2);
  assert.equal(r2.statusCode, 200);
  assert.match(r2.headers['Cache-Control'], /s-maxage=\d+.*stale-while-revalidate/);
  assert.equal(r2.body.call.arguments.query, 'Kafka');
  for (const query of [{ tool: 'nope' }, { tool: 'get_profile', extra: '1' }, { tool: ['get_profile', 'x'] }, { tool: 'search_portfolio', q: 'k' }]) {
    const r = res(); await ok(req(query), r);
    assert.equal(r.statusCode, 400, JSON.stringify(query)); assert.equal(r.headers['Cache-Control'], 'no-store');
  }
  const r3 = res(); await ok(req({ tool: 'get_profile' }, 'POST'), r3); assert.equal(r3.statusCode, 405);
  const failing = createTerminalMcpHandler({ isRateLimited: async () => false, run: async () => { throw new Error('down'); } });
  const r4 = res(); await failing(req({ tool: 'list_projects' }), r4);
  assert.equal(r4.statusCode, 503); assert.equal(r4.headers['Cache-Control'], 'no-store');
});

test('mcp call says when an answer came from cache', async () => {
  const cached = ctx({ callTool: async (tool, args) => ({ via: 'cache', request: { params: { name: tool, arguments: args } }, result: {}, elapsedMs: 3218 }) });
  assert.match(text(await runCommand('mcp call list_projects', cached)), /cached \(live call took 3218 ms\)/);
});
