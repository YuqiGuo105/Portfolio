import { cleanPageContext } from './protocol.mjs';

export function createVoiceProxy({ env = process.env, fetchImpl = fetch } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
    const base = env.VOICE_RELAY_URL;
    if (env.VOICE_ENABLED !== 'true' || !base || !env.VOICE_GATEWAY_TOKEN) {
      return res.status(req.method === 'GET' ? 200 : 503).json({ configured: false, provider: 'Google', reason: 'disabled' });
    }
    const origin = req.headers.origin;
    const allowed = new Set(['https://www.yuqi.site', 'https://yuqi.site']);
    if (env.NODE_ENV === 'development') allowed.add(`http://${req.headers.host}`);
    if (req.method === 'POST' && (!allowed.has(origin) || !String(req.headers['content-type']).startsWith('application/json'))) {
      return res.status(403).json({ error: 'Voice is available from the portfolio only.' });
    }
    const page = req.method === 'POST' ? cleanPageContext(req.body?.page) : null;
    if (req.method === 'POST' && (!page || page.path.startsWith('/admin'))) return res.status(400).json({ error: 'Public pages only.' });
    try {
      const response = await fetchImpl(`${base.replace(/\/$/, '')}/session`, {
        method: req.method, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Bearer ${env.VOICE_GATEWAY_TOKEN}`, 'Content-Type': 'application/json' },
        ...(page ? { body: JSON.stringify({ page, origin }) } : {}),
      });
      const result = await response.json();
      return res.status(response.status).json(result);
    } catch {
      return res.status(req.method === 'GET' ? 200 : 503).json({ configured: false, provider: 'Google', reason: 'unavailable', error: 'Voice is temporarily unavailable. Please try later.' });
    }
  };
}
