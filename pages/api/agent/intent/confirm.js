/**
 * POST /api/agent/intent/confirm
 *
 * Confirmation leg for write operations that were staged as a PendingAction
 * on the agent service. Forwards to `/api/intent/confirm`.
 *
 * Body:
 *   {
 *     "sessionId":       string,
 *     "pendingActionId": string,
 *     "confirm":         boolean
 *   }
 *
 * Supabase session is REQUIRED (no anonymous confirmations) because every
 * pending action is a write operation.
 */
import {
  forwardJson,
  methodGuard,
  requireSupabaseUser,
} from "../../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const auth = await requireSupabaseUser(req, res, { allowAnonymous: false });
  if (!auth) return;

  await forwardJson(req, res, {
    path: "/api/intent/confirm",
    method: "POST",
    auth,
  });
}
