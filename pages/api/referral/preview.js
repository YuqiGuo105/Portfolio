// Local preview only (`npm run dev:talk`): the review list over sample data, and the emails the
// preview would have sent. Answers 404 anywhere else.
import { referralRuntime } from '../../../src/lib/referral/runtime.mjs';
import { localHost, talkPreviewEnabled } from '../../../src/lib/talkPreview.mjs';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req, res) {
  if (!talkPreviewEnabled() || !localHost(req)) return res.status(404).json({ error: 'not_found' });
  const runtime = referralRuntime();
  if (req.method === 'GET' && req.query.view === 'outbox') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ outbox: runtime.outbox, aiEnabled: process.env.REFERRAL_AI_ENABLED === '1' && runtime.screener.enabled() });
  }
  return runtime.previewAdmin(req, res);
}
