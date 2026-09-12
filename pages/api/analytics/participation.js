import { requireSupabaseUser } from '../../../src/lib/agentServiceProxy';
import { isAnalyticsOperator } from '../../../src/lib/analyticsRequestPolicy';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.headers.authorization) return res.status(200).json({ collect: true });
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;
  return res.status(200).json({ collect: !isAnalyticsOperator(auth) });
}
