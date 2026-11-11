const METHODS = { overview: 'GET', archive: 'POST', verify: 'POST', export: 'GET', hold: ['POST', 'DELETE'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createVisitorGovernanceHandler({ requireAdmin, fetchImpl = (...args) => fetch(...args), env = process.env }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const action = req.query?.action;
    if (typeof action !== 'string' || !Object.hasOwn(METHODS, action)) {
      return res.status(404).json({ message: 'Unknown governance operation.' });
    }
    const allowed = [].concat(METHODS[action]);
    if (!allowed.includes(req.method)) {
      res.setHeader('Allow', allowed.join(', '));
      return res.status(405).json({ message: 'Method not allowed.' });
    }
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    // No public fallback: governance needs an explicitly configured analytics service.
    const token = env.ANALYTICS_SERVICE_TOKEN || env.NOTIFICATION_SERVICE_TOKEN;
    if (!env.ANALYTICS_API_URL || !token) return res.status(503).json({ message: 'Visitor governance is not configured.' });
    const body = {};
    const params = new URLSearchParams();
    if (['verify', 'export', 'hold'].includes(action)) {
      const batchId = action === 'export' ? req.query.batchId : req.body?.batchId;
      if (typeof batchId !== 'string' || !UUID.test(batchId)) return res.status(400).json({ message: 'A valid batch ID is required.' });
      if (action === 'export') params.set('batchId', batchId);
      else body.batchId = batchId;
    }
    if (action === 'hold') {
      const reason = req.body?.reason;
      if (!['incident_review', 'legal_preservation', 'data_quality'].includes(reason)) {
        return res.status(400).json({ message: 'Select a valid preservation reason.' });
      }
      body.reason = reason;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const base = env.ANALYTICS_API_URL.replace(/\/+$/, '');
      const response = await fetchImpl(`${base}/api/admin/visitor-governance/${action}${params.size ? `?${params}` : ''}`, {
        method: req.method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Internal-Token': token,
          'X-Admin-Actor': UUID.test(auth.userId || '') ? auth.userId : 'verified-admin' },
        ...(req.method !== 'GET' ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        const status = [400, 404, 409, 503].includes(response.status) ? response.status : 502;
        const messages = { 400: 'Check the batch and change reason.', 404: 'Governance or this batch is unavailable.',
          409: 'This operation conflicts with the current batch state.', 503: 'Visitor governance is disabled or unavailable.' };
        return res.status(status).json({ message: messages[status] || 'The analytics service could not complete this operation.' });
      }
      const result = await response.json();
      if (action === 'export') res.setHeader('Content-Disposition', `attachment; filename="visitor-evidence-${params.get('batchId')}.json"`);
      return res.status(200).json(result);
    } catch {
      return res.status(502).json({ message: 'Visitor governance could not be reached. Please retry.' });
    } finally { clearTimeout(timer); }
  };
}
