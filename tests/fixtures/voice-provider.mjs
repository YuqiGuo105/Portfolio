// Test-process preload only. Never imported by application code.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://www.yuqi.site/mcp') {
    if (init?.method !== 'POST') return new Response('', { status: 405 });
    const message = JSON.parse(init.body);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const profile = { status: 'EVIDENCE_FOUND', coverage: { profile: 'owner_reviewed_public_evidence' },
      profileEvidence: [{ review: 'approved', sourceType: 'PROFILE', sourceRequiresLogin: true,
        text: 'Yuqi Guo has a Master in Computer Science from Syracuse University and a Bachelor in Information and Computing Science from the University of Liverpool.' }] };
    if (!['initialize', 'tools/call'].includes(message.method) || (message.method === 'tools/call' && message.params.name !== 'get_profile')) throw new Error('Only public profile reads allowed');
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'public-profile-fixture', version: '1' } }
      : { content: [{ type: 'text', text: JSON.stringify(profile) }] };
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  }
  if (url === 'https://generativelanguage.googleapis.com/v1beta/auth_tokens') {
    if (init.headers['x-goog-api-key'] !== 'e2e-not-a-real-key') throw new Error('E2E must never use real credentials');
    const body = JSON.parse(init.body);
    if (body.uses !== 1 || !body.bidiGenerateContentSetup?.tools || body.liveConnectConstraints) throw new Error('Invalid token contract');
    return Response.json({ name: 'auth_tokens/e2e-not-a-real-token' });
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) return originalFetch(input, init);
  throw new Error('External requests are disabled in the voice E2E process');
};
