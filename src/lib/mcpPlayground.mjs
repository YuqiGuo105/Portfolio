import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Parser } from 'htmlparser2';
import { parseSSEBlock } from './chatStream.mjs';

const ENDPOINT = 'https://www.yuqi.site/mcp';
const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 18_000;
const SCENARIOS = Object.freeze({
  projects: { name: 'search_portfolio', arguments: { query: 'distributed systems', types: ['PROJECT'], limit: 3 } },
  kubernetes: { name: 'search_articles', arguments: { keyword: 'Kubernetes', sourceType: 'BLOG', limit: 3 } },
  publishing: { name: 'get_project', arguments: { projectId: '8edf9020-39b6-4db4-83b3-43c459bef1cf', format: 'html' } },
});

export class PlaygroundError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

export function validateScenario(body) {
  if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
      typeof body.scenario !== 'string' || !Object.hasOwn(SCENARIOS, body.scenario)) {
    throw new PlaygroundError('invalid_scenario', 400);
  }
  return body.scenario;
}

function sourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://www.yuqi.site' || url.username || url.password ||
        !/^\/(work-single|blog-single)\/[a-zA-Z0-9-]+$/.test(url.pathname) || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

const text = (value, max = 600) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function publicItem(item, expectedType) {
  const url = sourceUrl(item?.url);
  if (!url || item?.type !== expectedType || !text(item?.title)) return null;
  return {
    title: text(item.title, 180), url, type: expectedType,
    summary: text(item.summary),
    tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string').slice(0, 6).map(tag => text(tag, 40)) : [],
    sourceRequiresLogin: item.sourceRequiresLogin === true,
  };
}

// Extract the authored contract table, never execute or render upstream HTML.
export function publicationSteps(html) {
  const tables = [];
  let table = null, row = null, cell = null, skipped = 0;
  const parser = new Parser({
    onopentag(tag) {
      if (['script', 'style'].includes(tag)) skipped++;
      if (tag === 'table') { table = []; tables.push(table); }
      if (tag === 'tr' && table) row = [];
      if ((tag === 'td' || tag === 'th') && row) cell = '';
      if (tag === 'br' && cell !== null) cell += ' ';
    },
    ontext(value) { if (!skipped && cell !== null) cell += value; },
    onclosetag(tag) {
      if (['script', 'style'].includes(tag)) skipped = Math.max(0, skipped - 1);
      if ((tag === 'td' || tag === 'th') && row && cell !== null) { row.push(text(cell)); cell = null; }
      if (tag === 'tr' && table && row) { table.push(row); row = null; }
      if (tag === 'table') { table = null; row = null; cell = null; }
    },
  }, { decodeEntities: true });
  parser.end(typeof html === 'string' ? html.slice(0, MAX_BYTES) : '');
  const contract = tables.find(rows => rows[0]?.map(value => value.toLowerCase()).join('|') === 'stage|responsibility|guarantee');
  return (contract || []).slice(1, 7).filter(row => row.length === 3 && row.every(Boolean))
    .map(([title, responsibility, guarantee]) => ({ title, responsibility, guarantee }));
}

function normalize(scenario, data) {
  if (!data || typeof data !== 'object' || data.error) throw new PlaygroundError('tool_failed');
  if (scenario === 'publishing') {
    const item = publicItem(data, 'PROJECT');
    if (!item) throw new PlaygroundError('invalid_result');
    // A restricted record may expose metadata, but never its body through this demo.
    const steps = item.sourceRequiresLogin ? [] : publicationSteps(data.body);
    return { items: [item], steps, sources: [{ title: item.title, url: item.url }], status: steps.length ? 'complete' : 'partial' };
  }
  const candidates = scenario === 'projects' ? data.results : data.articles;
  if (!Array.isArray(candidates)) throw new PlaygroundError('invalid_result');
  const items = candidates.slice(0, 3).map(item => publicItem(item, scenario === 'projects' ? 'PROJECT' : 'BLOG')).filter(Boolean);
  return { items, steps: [], sources: items.map(({ title, url }) => ({ title, url })), status: items.length ? 'complete' : 'empty' };
}

function unwrap(message, id) {
  if (message?.jsonrpc !== '2.0' || message.id !== id) return null;
  if (message.error || message.result?.isError) throw new PlaygroundError('tool_failed');
  const result = message.result;
  if (result?.structuredContent) return result.structuredContent;
  const content = result?.content?.find(block => block.type === 'text');
  if (!content) throw new PlaygroundError('invalid_result');
  try { return JSON.parse(content.text); }
  catch { throw new PlaygroundError('invalid_result'); }
}

async function readResult(response, id) {
  const type = response.headers.get('content-type') || '';
  const sse = type.includes('text/event-stream');
  if (!sse && !type.includes('application/json')) throw new PlaygroundError('invalid_result');
  const reader = response.body?.getReader();
  if (!reader) throw new PlaygroundError('invalid_result');
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  const parseEvent = block => {
    const { data } = parseSSEBlock(block);
    if (!data) return null;
    return unwrap(JSON.parse(data), id);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength || 0;
      if (bytes > MAX_BYTES) throw new PlaygroundError('invalid_result');
      buffer += decoder.decode(value, { stream: !done });
      if (sse) {
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const result = parseEvent(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
          // JSON-RPC completion is terminal even if the SSE socket stays open.
          if (result !== null) return result;
        }
      }
      if (done) {
        const result = sse ? (buffer.trim() ? parseEvent(buffer) : null) : unwrap(JSON.parse(buffer), id);
        if (result !== null) return result;
        throw new PlaygroundError('invalid_result');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function runPlayground(scenario, { fetchImpl = fetch, signal, timeoutMs = TIMEOUT_MS } = {}) {
  validateScenario({ scenario });
  const tool = SCENARIOS[scenario];
  const id = randomUUID();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  const start = performance.now();
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: tool }),
    });
    if (!response.ok) throw new PlaygroundError(response.status === 429 ? 'upstream_busy' : 'unavailable', response.status === 429 ? 503 : 502);
    const output = normalize(scenario, await readResult(response, id));
    const elapsedMs = Math.max(1, Math.round(performance.now() - start));
    return {
      scenario, ...output, elapsedMs, retrievedAt: new Date().toISOString(),
      calls: [{ name: tool.name, arguments: tool.arguments, status: 'completed', elapsedMs,
        result: { items: output.items, ...(scenario === 'publishing' ? { steps: output.steps } : {}) } }],
    };
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

export function createPlaygroundHandler({ isRateLimited, run = runPlayground }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
    const headers = req.headers || {};
    if (!/^application\/json(?:;|$)/i.test(headers['content-type'] || '')) return res.status(415).json({ error: 'json_required' });
    if (headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'invalid_origin' });
    try {
      if (headers.origin && new URL(headers.origin).host !== headers.host) throw new Error();
    } catch { return res.status(403).json({ error: 'invalid_origin' }); }
    let scenario;
    try { scenario = validateScenario(req.body); }
    catch { return res.status(400).json({ error: 'invalid_scenario' }); }
    const ip = String((process.env.VERCEL ? headers['x-vercel-forwarded-for'] || headers['x-forwarded-for'] : null) || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    try {
      if (res.destroyed) return;
      const limited = await isRateLimited(ip, 'mcp-playground', { limit: 6, windowMs: 60_000 }) ||
        await isRateLimited('all', 'mcp-playground-global', { limit: 60, windowMs: 60_000 });
      if (controller.signal.aborted || res.destroyed) return;
      if (limited) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'rate_limited', retryAfter: 60 });
      }
      const result = await run(scenario, { signal: controller.signal });
      if (!res.destroyed) return res.status(200).json(result);
    } catch (error) {
      if (!res.destroyed) return res.status(error instanceof PlaygroundError ? error.status : 503)
        .json({ error: error instanceof PlaygroundError ? error.code : 'unavailable' });
    } finally { res.off('close', abort); }
  };
}
