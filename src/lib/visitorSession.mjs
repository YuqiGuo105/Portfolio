import { randomUUID } from 'node:crypto';
import { readResult } from './mcpPlayground.mjs';
import { validateSessionRequest } from './visitorSessionRequest.mjs';
export { validateSessionRequest } from './visitorSessionRequest.mjs';

export async function readVisitorSession(args, { authorization, signal, fetchImpl = fetch, timeoutMs = 18000 } = {}) {
  const base = new URL(process.env.MCP_SERVER_URL || 'https://portfolio-mcp-server-702193211434.us-central1.run.app');
  const local = ['localhost', '127.0.0.1'].includes(base.hostname) && process.env.NODE_ENV !== 'production';
  if ((base.protocol !== 'https:' && !local) || base.username || base.password) throw new Error('Invalid MCP configuration');
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const id = randomUUID();
    const response = await fetchImpl(new URL('/mcp/admin', base), {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'visitor.get_session_events', arguments: args } }),
    });
    if (!response.ok) throw new Error('MCP unavailable');
    const result = await readResult(response, id, 512 * 1024);
    if (!Array.isArray(result?.items) || result.items.length > args.page.size) throw new Error('Invalid session result');
    return result;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}

export function createVisitorSessionHandler({ requireAdmin, read = readVisitorSession }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ message: 'POST required.' }); }
    if (!(await requireAdmin(req, res))) return;
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ message: 'Cross-site requests are not allowed.' });
    let args;
    try { args = validateSessionRequest(req.body); } catch { return res.status(400).json({ message: 'A session ID and a fixed time window of at most 31 days are required.' }); }
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    try {
      const result = await read(args, { authorization: req.headers.authorization, signal: controller.signal });
      if (!res.destroyed) return res.status(200).json(result);
    } catch {
      if (!res.destroyed) return res.status(502).json({ message: 'Session evidence could not be read from Admin MCP. Retry or reconnect your administrator session.' });
    } finally { res.off('close', abort); }
  };
}
