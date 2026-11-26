import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { trustedSiteGuide } from '../siteGuide.mjs';
import { BUILT_IN_GUIDE, voiceGuide } from './protocol.mjs';

// Server only: this file brings in the MCP client. The browser's side of the guide is in protocol.mjs.
const ENDPOINT = 'https://www.yuqi.site/mcp';

// Reads the site guide the way any other AI client does: the public MCP tool `get_site_guide`.
export async function fetchSiteGuide({ signal } = {}) {
  const client = new Client({ name: 'mr-pot-voice-guide', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: (url, init) => fetch(url, { ...init,
      signal: signal && init?.signal ? AbortSignal.any([signal, init.signal]) : signal || init?.signal,
      redirect: 'error',
    }),
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'get_site_guide', arguments: {} }, undefined, { signal, timeout: 6000 });
    if (result.isError) throw new Error('Site guide unavailable');
    const raw = result.structuredContent || JSON.parse(result.content.find(block => block.type === 'text')?.text || '{}');
    const sections = trustedSiteGuide(raw);
    if (!sections) throw new Error('Site guide unavailable');
    return voiceGuide(sections, 'MCP');
  } finally { await client.close().catch(() => {}); }
}

// A call never waits long for the guide and never goes without one: when the MCP tool cannot be
// reached in time, the build's own copy of the list is used and the tool is tried again shortly.
export function createGuideLoader({ read = fetchSiteGuide, now = Date.now, timeoutMs = 7000 } = {}) {
  let cached, expiresAt = 0, pending;
  return async () => {
    if (cached && now() < expiresAt) return cached;
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Site guide timeout')); }, timeoutMs);
        });
        cached = await Promise.race([read({ signal: controller.signal }), timeout]);
        if (!cached?.sections?.length) throw new Error('Site guide unavailable');
        expiresAt = now() + 300000;
      } catch { cached = BUILT_IN_GUIDE; expiresAt = now() + 30000; }
      finally { clearTimeout(timer); pending = null; }
      return cached;
    })();
    return pending;
  };
}
