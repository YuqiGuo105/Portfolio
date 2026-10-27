import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assistantLocalConfig } from './assistant-local-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
process.chdir(root);
const args = process.argv.slice(2);
try {
  if (args.some(arg => !['--detach', '--unlimited-local', '--check'].includes(arg))) throw new Error('Unknown option. Use --detach, --unlimited-local or --check.');
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('This launcher is local-only.');
  require('@next/env').loadEnvConfig(root, true, { info() {}, error() {} });
  for (const name of ['.env.agent.local', '.env.voice-qwen.local', '.env.ai-text.local']) {
    require('dotenv').config({ path: path.join(root, name), override: false });
  }
  const env = assistantLocalConfig(process.env, { unlimited: args.includes('--unlimited-local') });
  console.log(JSON.stringify({ configured: true, provider: 'Qwen', localOnly: true,
    unlimitedLocal: env.QWEN_LIVE_UNLIMITED_LOCAL === 'true', url: `http://127.0.0.1:${env.VOICE_PREVIEW_PORT}/` }));
  if (!args.includes('--check')) {
    // Fail before loading Next or opening any provider connection if an old preview owns the port.
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(new Error(`Port ${env.VOICE_PREVIEW_PORT} is already in use. Stop its old preview or set VOICE_PREVIEW_PORT.`)));
      probe.listen(Number(env.VOICE_PREVIEW_PORT), '127.0.0.1', () => probe.close(resolve));
    });
    const child = spawn(process.execPath, ['scripts/dev-voice.mjs', ...(args.includes('--detach') ? ['--detach'] : [])], { cwd: root, env, stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    child.once('error', () => { console.error('Unable to start the local assistant.'); process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
