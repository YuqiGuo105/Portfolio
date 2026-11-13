import { discoveryEnabled, discoveryRuntime } from '../../../src/lib/discovery/runtime.mjs';
import { contactIp } from '../../../src/lib/contactGuard.mjs';
import { isRateLimited } from '../../../src/lib/rateLimiter';

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (!discoveryEnabled()) return res.status(404).json({ error: 'not_enabled' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  const op = req.query.operation;
  if (!['suggest', 'recommend', 'search', 'home-policy'].includes(op)) return res.status(404).end();
  if (await isRateLimited(contactIp(req), `discovery-${op}`, { limit: op === 'search' ? 10 : 90, windowMs: 60000 })) return res.status(429).json({ error: 'Please try again shortly.' });
  try {
    const { service } = discoveryRuntime();
    if (op === 'home-policy') {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300');
      return res.status(200).json({ home: (await service.stats()).home });
    }
    if (op === 'recommend') return res.status(200).json(await service.recommendations(String(req.query.id || '').slice(0, 50)));
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 300) return res.status(400).json({ error: 'Enter 2 to 300 characters.' });
    if (op === 'suggest') return res.status(200).json(await service.suggest(q));
    return res.status(200).json(await service.search(q, String(req.query.source || ''), req.query.semantic === '1'));
  } catch (error) {
    return res.status(error instanceof RangeError ? 400 : 503).json({ error: 'Discovery is temporarily unavailable.' });
  }
}
