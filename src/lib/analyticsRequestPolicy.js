import { requireSupabaseUser } from './agentServiceProxy';

export function isAnalyticsOperator(auth) {
  return String(auth?.roles || '').split(',').some(role =>
    ['ADMIN', 'EDITOR', 'PUBLISHER'].includes(role.trim().toUpperCase()));
}

export async function allowAnalyticsRequest(req, res) {
  if (!req.headers.authorization) return true;
  // Roles are verified server-side, never accepted from the event or JWT metadata.
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return false;
  if (isAnalyticsOperator(auth)) {
    res.status(204).end();
    return false;
  }
  return true;
}
