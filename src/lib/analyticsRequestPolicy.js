import { requireSupabaseUser } from './agentServiceProxy';

export async function allowAnalyticsRequest(req, res) {
  if (!req.headers.authorization) return true;
  // Legacy collectors may attach a token. Verify it, but do not suppress public
  // visits based on the account's role. Ingestion separately excludes private routes.
  const auth = await requireSupabaseUser(req, res);
  if (!auth) return false;
  return true;
}
