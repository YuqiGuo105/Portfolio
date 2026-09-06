import { forwardJson, methodGuard, requireSupabaseUser } from '../../../src/lib/agentServiceProxy';
import { isRateLimited } from '../../../src/lib/rateLimiter';

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!methodGuard(req, res, ['POST'])) return;
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Invalid origin.' });
    } catch { return res.status(403).json({ error: 'Invalid origin.' }); }
  }
  if (typeof req.body?.audio !== 'string' || !req.body.audio.length || req.body.audio.length > 2_560_060) {
    return res.status(400).json({ error: 'Invalid recording size.' });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (await isRateLimited(ip, 'dictation', { limit: Number(process.env.DICTATION_RATE_LIMIT || 6), windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Please wait a moment before recording again.' });
  }
  const auth = await requireSupabaseUser(req, res, { allowAnonymous: true });
  if (!auth) return;
  req.body = { audio: req.body.audio };
  await forwardJson(req, res, { path: '/api/chat/transcribe', method: 'POST', auth, timeoutMs: 50_000 });
}
