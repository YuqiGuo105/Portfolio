import { discoveryRuntime, previewEnabled } from '../../../src/lib/discovery/runtime.mjs';
import { reviewSubmission } from '../../../src/lib/discovery/moderation.mjs';
import { consumeDiscoveryEvent } from '../../../src/lib/discovery/feedback.mjs';
import { randomUUID } from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!previewEnabled() || !/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')
    || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.status(404).end();
  const runtime = discoveryRuntime(), { service, reviews, store, loadCatalog, moderate } = runtime;
  try {
    if (req.method === 'GET') {
      const state = await service.stats(), catalog = await loadCatalog();
      return res.status(200).json({ preview: true, home: state.home, metrics: state.metrics, reviews: await reviews.list(),
        learningPaused: !!state.learningPaused, build: await store.get('last-build'), catalog: catalog.items.map(({ text, ...item }) => item), aiEnabled: process.env.DISCOVERY_AI_ENABLED === '1' });
    }
    if (req.method !== 'POST' || req.headers.origin !== `http://${req.headers.host}`) return res.status(403).end();
    if (req.body?.operation === 'moderate') {
      const { channel, text } = req.body;
      if (!['globe', 'contact', 'chat'].includes(channel) || typeof text !== 'string' || text.length > 5000) return res.status(400).end();
      return res.status(200).json(await moderate(channel, text, channel === 'contact' ? { name: 'Local preview', email: 'preview@example.invalid' } : {}));
    }
    if (req.body?.operation === 'rebuild') return res.status(200).json(await service.rebuild({ embeddings: process.env.DISCOVERY_AI_ENABLED === '1' }));
    if (req.body?.operation === 'review-sample') {
      const row = await reviews.enqueue({ id: randomUUID(), fingerprint: 'local-review-sample', channel: 'contact', status: 'pending',
        text: 'Synthetic local example: please review this message. No email will be delivered.', context: { name: 'Preview sample', email: 'preview@example.invalid' },
        reason: 'unavailable', risk: null, model: 'preview-fixture', created_at: new Date().toISOString() });
      return res.status(200).json({ decision: 'review', category: 'Synthetic local sample', model: 'preview-fixture', reviewId: row.id });
    }
    if (req.body?.operation === 'feedback') {
      const { items } = await loadCatalog();
      // Synthetic, isolated session demonstrates co-visitation without polluting live analytics.
      const sessionId = randomUUID();
      for (const item of items.slice(0, 2)) {
        const event = { eventId: randomUUID(), siteId: 'yuqi.site', consentState: 'granted', sessionId, eventType: 'page_view', eventTime: new Date().toISOString(), pageUrl: item.url };
        await consumeDiscoveryEvent(event, runtime); await consumeDiscoveryEvent(event, runtime);
      }
      return res.status(200).json({ pairs: (await service.stats()).pairs });
    }
    if (req.body?.id) return res.status(200).json(await reviewSubmission({ reviews, id: req.body.id, action: req.body.action, actor: 'local-preview', sendMail: async () => {} }));
    return res.status(400).end();
  } catch { return res.status(503).json({ message: 'Preview operation unavailable. No message was delivered.' }); }
}
