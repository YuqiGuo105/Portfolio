import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ENDPOINT = 'https://www.yuqi.site/mcp';
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
export const PROFILE_UNAVAILABLE = Object.freeze({ status: 'UNAVAILABLE', facts: [], experience: [], url: 'https://www.yuqi.site/cv' });

// Only the public MCP contract may authorize profile facts. A restricted source
// is not permission to read its article; approved public summaries are distinct.
export function publicProfileEvidence(data) {
  if (data?.status !== 'EVIDENCE_FOUND' || data.coverage?.profile !== 'owner_reviewed_public_evidence') return PROFILE_UNAVAILABLE;
  const facts = (Array.isArray(data.profileEvidence) ? data.profileEvidence : [])
    .filter(row => row.review === 'approved' && row.sourceType === 'PROFILE')
    .slice(0, 6).map(row => text(row.text, 1800)).filter(Boolean);
  const experience = (Array.isArray(data.experience) ? data.experience : []).slice(0, 6)
    .map(row => ({ company: text(row.company, 160), title: text(row.title, 160), period: text(row.period, 100) }));
  return { status: facts.length ? 'EVIDENCE_FOUND' : 'UNAVAILABLE', facts, experience, url: 'https://www.yuqi.site/cv' };
}

export async function fetchPublicProfile({ signal } = {}) {
  const client = new Client({ name: 'mr-pot-local-voice', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: (url, init) => fetch(url, { ...init,
      signal: signal && init?.signal ? AbortSignal.any([signal, init.signal]) : signal || init?.signal,
      redirect: 'error',
    }),
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'get_profile', arguments: {} }, undefined, { signal, timeout: 6000 });
    if (result.isError) throw new Error('Public profile unavailable');
    const raw = result.structuredContent || JSON.parse(result.content.find(block => block.type === 'text')?.text || '{}');
    return publicProfileEvidence(raw);
  } finally { await client.close().catch(() => {}); }
}

export function createProfileLoader({ read = fetchPublicProfile, now = Date.now } = {}) {
  let cached, expiresAt = 0, pending;
  return async () => {
    if (cached && now() < expiresAt) return cached;
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Public profile timeout')); }, 6500);
        });
        cached = await Promise.race([read({ signal: controller.signal }), timeout]);
        expiresAt = now() + (cached.status === 'EVIDENCE_FOUND' ? 60000 : 5000);
      } catch { cached = PROFILE_UNAVAILABLE; expiresAt = now() + 5000; }
      finally { clearTimeout(timer); pending = null; }
      return cached;
    })();
    return pending;
  };
}
