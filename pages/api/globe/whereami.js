import { requestGeo } from '../../../src/lib/requestGeo.mjs';

// The caller's own approximate city (from the edge's geo headers), for the globe's live presence
// and as the default spot for a flag. Nothing is stored.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const geo = requestGeo(req.headers || {});
  return res.status(200).json(geo ? { known: true, ...geo } : { known: false });
}
