import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('Local preview only.');
const port = Number(process.env.PORT || 3143);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
const app = require('next')({ dev: true, dir: process.cwd(), conf: { distDir: '.next-visitor-governance' } });
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  // This preview exposes synthetic data only; no API or public-page access.
  if (path !== '/admin/visitor-preview' && !path.startsWith('/_next/') && !path.startsWith('/assets/') && path !== '/favicon.ico') {
    res.writeHead(404); res.end('Local visitor preview only.'); return;
  }
  handler(req, res);
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic Visitors preview: http://127.0.0.1:${port}/admin/visitor-preview#visitor-governance`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); app.close().then(() => process.exit(0)); });
