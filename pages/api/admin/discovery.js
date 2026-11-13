import { requireAdmin } from '../../../src/lib/adminRouteAuth';
import { discoveryEnabled, discoveryRuntime } from '../../../src/lib/discovery/runtime.mjs';
import { reviewSubmission } from '../../../src/lib/discovery/moderation.mjs';
import { sendContactMail } from '../../../src/lib/contactMail.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (!discoveryEnabled()) return res.status(404).json({ message: 'Discovery is not enabled.' });
  try {
    const { reviews, service, store } = discoveryRuntime();
    if (req.method === 'GET') {
      const [state, pending, build, worker] = await Promise.all([service.stats(), reviews.list(), store.get('last-build'), store.get('last-worker')]);
      return res.status(200).json({ home: state.home, metrics: state.metrics, learningPaused: !!state.learningPaused, reviews: pending, build, worker });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    if (!/^[a-f0-9-]{36}$/i.test(req.body?.id || '') || !['approve', 'reject'].includes(req.body?.action)) return res.status(400).json({ message: 'Invalid review action.' });
    const result = await reviewSubmission({ reviews, id: req.body.id, action: req.body.action, actor: user.userId, sendMail: sendContactMail });
    return res.status(result?.conflict ? 409 : 200).json(result);
  } catch { return res.status(503).json({ message: 'The review queue is unavailable. Nothing was approved.' }); }
}
