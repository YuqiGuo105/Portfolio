// Local browser acceptance harness: every API response is synthetic.
import http from 'node:http';
import next from 'next';

const port = Number(process.env.PORT || 3166);
if (process.env.NODE_ENV === 'production') throw new Error('Local verification only');
process.env.NEXT_PUBLIC_VOICE_ENABLED = 'true';
const app = next({ dev: true, hostname: '127.0.0.1', port });
await app.prepare();
const handle = app.getRequestHandler();
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const json = (value, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  if (path === '/health') return json({ status: 'UP' });
  if (!path.startsWith('/api/')) return handle(req, res);
  if (path === '/api/rag/capabilities') return json({ deep: false, attachments: false });
  if (path === '/api/intent/route') return json({ routeKind: 'GENERAL_CHAT' });
  if (path === '/api/agent/intent') return json({ handled: false });
  if (path.endsWith('/answer/stream')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body || '{}');
    const pending = String(input.question).includes('Slow test');
    const failing = String(input.question).includes('Error test');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const send = (stage, payload) => res.write(`data: ${JSON.stringify({ stage, payload })}\n\n`);
    send('routing', { route: 'GENERAL_CHAT' });
    if (pending) {
      const timer = setTimeout(() => { send('answer_final', { answer: 'Local delayed answer.' }); send('done', {}); res.end(); }, 15000);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    if (failing) { send('error', { message: 'Synthetic test failure' }); return res.end(); }
    send('tool_call_start', { toolName: 'search_content', callId: 'local-1', args: 'platform architecture' });
    send('tool_call_result', { toolName: 'search_content', callId: 'local-1', latencyMs: 32, status: 'done' });
    send('sources_found', { sources: [{ title: 'Platform architecture', url: 'https://www.yuqi.site/architecture', snippet: 'Synthetic source for local layout verification.' }] });
    send('answer_final', { answer: '## Platform overview\n\nA **local test reply** with a [source link](https://www.yuqi.site/architecture).\n\n1. Publish content through the admin API.\n2. Deliver updates through Kafka.\n3. Update search and AI retrieval.\n\nInline code: `content_versions`.\n\n```java\nreturn contentService.findPublished(contentId);\n```' });
    send('done', {});
    return res.end();
  }
  if (path === '/api/track') return json({ accepted: true });
  return json({ error: 'Local fixture: endpoint not enabled' }, 503);
}).listen(port, '127.0.0.1', () => console.log(`Local-only widget verification: http://127.0.0.1:${port}`));
