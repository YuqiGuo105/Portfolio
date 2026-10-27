export function assistantLocalConfig(env, { unlimited = false } = {}) {
  if (env.NODE_ENV === 'production' || env.VERCEL || env.K_SERVICE) {
    throw new Error('The local assistant launcher cannot run in a deployed environment.');
  }
  const required = ['AGENT_SERVICE_URL', 'AGENT_SERVICE_INTERNAL_TOKEN',
    'QWEN_LIVE_API_KEY', 'QWEN_LIVE_WORKSPACE_ID', 'QWEN_TEXT_API_KEY'];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing local assistant configuration: ${missing.join(', ')}`);
  const backend = new URL(env.AGENT_SERVICE_URL);
  if (backend.protocol !== 'https:' && !(backend.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname))) {
    throw new Error('The agent backend must use HTTPS or loopback HTTP.');
  }
  if (env.QWEN_LIVE_ENABLED !== 'true' || env.QWEN_LIVE_TRIAL_ACK !== 'true') {
    throw new Error('Qwen local voice must be explicitly enabled and approved.');
  }
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(env.QWEN_LIVE_WORKSPACE_ID)) {
    throw new Error('Invalid Qwen workspace configuration.');
  }
  const port = Number(env.VOICE_PREVIEW_PORT || 3118);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local preview port.');
  return {
    ...env,
    NODE_ENV: 'development',
    LOCAL_QWEN_ASSISTANT: 'true',
    VOICE_PREVIEW_PORT: String(port),
    VOICE_ENABLED: 'false',
    NEXT_PUBLIC_VOICE_ENABLED: 'false',
    NEXT_PUBLIC_VOICE_DEFAULT_PROVIDER: 'qwen',
    QWEN_LIVE_UNLIMITED_LOCAL: unlimited ? 'true' : 'false',
  };
}
