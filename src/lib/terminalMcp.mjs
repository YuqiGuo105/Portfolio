// The site terminal's `mcp call` / `ls` / `cat resume`: a real JSON-RPC tools/call against the public
// MCP endpoint, limited to a few read-only tools with validated arguments. The visitor sees the exact
// request that was sent and the public fields of the answer (same rules as the MCP playground: only
// published, linkable items; nothing behind a login).
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PlaygroundError, publicItem, readResult } from './mcpPlayground.mjs';
import { clientIp } from './requestGeo.mjs';

const ENDPOINT = 'https://www.yuqi.site/mcp';
const TIMEOUT_MS = 15_000;

const cleanQuery = (value) => typeof value === 'string'
  ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  : '';

const items = (list, types) => (Array.isArray(list) ? list : [])
  .map((item) => (types.includes(item?.type) ? publicItem(item, item.type) : null))
  .filter(Boolean);

const text = (value, max = 120) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const https = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
};

export const TERMINAL_TOOLS = Object.freeze({
  search_portfolio: {
    args(input) {
      const query = cleanQuery(input?.query);
      if (query.length < 2 || query.length > 80) throw new PlaygroundError('invalid_arguments', 400);
      return { query, types: ['PROJECT', 'BLOG'], limit: 5, includeSnippets: false };
    },
    result: (data) => ({ items: items(data?.results, ['PROJECT', 'BLOG']).slice(0, 5), total: Number(data?.total) || 0 }),
  },
  list_projects: {
    args: () => ({ page: { number: 0, size: 20 } }),
    result: (data) => ({ items: items(data?.items, ['PROJECT']).slice(0, 20) }),
  },
  list_articles: {
    args: () => ({ sourceType: 'BLOG', page: { number: 0, size: 20 } }),
    result: (data) => ({ items: items(data?.items, ['BLOG']).slice(0, 20) }),
  },
  get_profile: {
    args: () => ({}),
    // Experience and the owner's public links only; evidence text marked login-only stays out.
    result: (data) => ({
      experience: (Array.isArray(data?.experience) ? data.experience : []).slice(0, 8)
        .map((row) => ({ company: text(row?.company, 80), title: text(row?.title, 80), period: text(row?.period, 40) }))
        .filter((row) => row.company),
      links: (Array.isArray(data?.socialProfiles) ? data.socialProfiles : []).slice(0, 8)
        .map((row) => ({ label: text(row?.label, 40), url: https(row?.url) }))
        .filter((row) => row.label && row.url),
      cv: 'https://www.yuqi.site/cv',
    }),
  },
});

export function validateToolCall(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PlaygroundError('invalid_tool', 400);
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'tool' && key !== 'arguments')) throw new PlaygroundError('invalid_tool', 400);
  if (typeof body.tool !== 'string' || !Object.hasOwn(TERMINAL_TOOLS, body.tool)) throw new PlaygroundError('invalid_tool', 400);
  if (body.arguments != null && (typeof body.arguments !== 'object' || Array.isArray(body.arguments))) {
    throw new PlaygroundError('invalid_arguments', 400);
  }
  return { tool: body.tool, arguments: TERMINAL_TOOLS[body.tool].args(body.arguments || {}) };
}

export async function callTerminalTool(call, { fetchImpl = fetch, signal, timeoutMs = TIMEOUT_MS } = {}) {
  const { tool, arguments: args } = call;
  const id = randomUUID();
  const request = { jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  const start = performance.now();
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new PlaygroundError(response.status === 429 ? 'upstream_busy' : 'unavailable', response.status === 429 ? 503 : 502);
    const data = await readResult(response, id);
    if (!data || typeof data !== 'object' || data.error) throw new PlaygroundError('tool_failed');
    return { tool, request, result: TERMINAL_TOOLS[tool].result(data), elapsedMs: Math.max(1, Math.round(performance.now() - start)) };
  } catch (error) {
    if (timedOut) throw new PlaygroundError('timeout', 504);
    if (error instanceof PlaygroundError) throw error;
    throw new PlaygroundError('unavailable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

// Read-only and public, so answers are cached at the CDN: repeat calls (and everyone's `ls projects`)
// come back in tens of milliseconds instead of the 1–3 s a live MCP round trip takes. Stale answers are
// served while a fresh one is fetched in the background.
export const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400';

// GET /api/terminal/mcp?tool=search_portfolio&q=kafka
export function toolCallFromQuery(query = {}) {
  const keys = Object.keys(query);
  if (keys.some((key) => key !== 'tool' && key !== 'q')) throw new PlaygroundError('invalid_tool', 400);
  const one = (value) => (Array.isArray(value) ? undefined : value);
  const q = one(query.q);
  return validateToolCall({ tool: one(query.tool), ...(q !== undefined ? { arguments: { query: q } } : {}) });
}

export function createTerminalMcpHandler({ isRateLimited, run = callTerminalTool }) {
  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    let call;
    try { call = toolCallFromQuery(req.query || {}); }
    catch (error) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(400).json({ error: error.code || 'invalid_tool', tools: Object.keys(TERMINAL_TOOLS) });
    }
    // Only cache misses reach this function, so the limits guard the MCP server, not the visitor.
    const ip = clientIp(req);
    try {
      const limited = await isRateLimited(ip, 'mcp-terminal', { limit: 12, windowMs: 60_000 }) ||
        await isRateLimited('all', 'mcp-terminal-global', { limit: 120, windowMs: 60_000 });
      if (limited) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'rate_limited', retryAfter: 60 });
      }
      const reply = await run(call);
      res.setHeader('Cache-Control', CACHE_CONTROL);
      return res.status(200).json({ ...reply, fetchedAt: new Date().toISOString() });
    } catch (error) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(error instanceof PlaygroundError ? error.status : 503)
        .json({ error: error instanceof PlaygroundError ? error.code : 'unavailable' });
    }
  };
}
