import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createQwenBridge } from '../src/lib/voice/qwenBridge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const require = createRequire(import.meta.url);
const port = Number(process.env.VOICE_PREVIEW_PORT || 3118);
if (process.argv.includes('--detach')) {
  const log = `/tmp/portfolio-voice-local-${port}.log`;
  const fd = openSync(log, 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: root, detached: true, env: process.env, stdio: ['ignore', fd, fd],
  });
  child.unref();
  closeSync(fd);
  console.log(JSON.stringify({ pid: child.pid, url: `http://127.0.0.1:${port}/admin/mr-pot-voice`, log }));
} else {
  process.env.NODE_ENV = 'development';
  process.env.GEMINI_LIVE_ENABLED = 'true';
  process.env.NEXT_PUBLIC_GEMINI_LIVE_PREVIEW = 'true';
  process.env.WATCHPACK_POLLING ||= '2000';
  const next = require('next');
  const config = require('../next.config.js');
  const app = next({ dev: true, dir: root, hostname: '127.0.0.1', port,
    conf: { ...config, distDir: `.next-voice-local-${port}` } });
  await app.prepare();
  const qwen = createQwenBridge();
  if (process.env.QWEN_LIVE_ENABLED === 'true') {
    console.log(`Qwen public profile: ${await qwen.prepare() ? 'ready' : 'temporarily unavailable'}`);
  }
  const handle = app.getRequestHandler();
  const server = createServer(async (req, res) => {
    if (!await qwen.http(req, res)) handle(req, res);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!qwen.upgrade(req, socket, head)) app.getUpgradeHandler()(req, socket, head);
  });
  server.on('error', error => { console.error(error.code); process.exit(1); });
  server.listen(port, '127.0.0.1', () => console.log(`Voice preview: http://127.0.0.1:${port}/admin/mr-pot-voice`));
  const stop = () => { qwen.close(); server.close(); app.close().finally(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
