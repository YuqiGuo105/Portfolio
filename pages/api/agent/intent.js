/**
 * POST /api/agent/intent
 *
 * Forwards a single user utterance to the deployed portfolio-agent-service
 * `/api/intent` endpoint. The Supabase session token (from Authorization
 * header) is verified server-side; the resolved email + roles are injected
 * into the upstream payload so the browser cannot spoof admin powers.
 *
 * Request body (forwarded with email/roles overridden):
 *   {
 *     "sessionId":  string,
 *     "utterance":  string,
 *     "pageContext": object?,
 *     "pendingActionId": string?,
 *     "confirm": boolean?
 *   }
 *
 * Response: passthrough of agent service IntentResponse JSON.
 */
import {
  forwardJson,
  methodGuard,
  requireSupabaseUser,
} from "../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  // Anonymous chat is fine for read-only intents (the agent will reject
  // write tools because the resolved role will be VIEWER only).
  const auth = await requireSupabaseUser(req, res, { allowAnonymous: true });
  if (!auth) return;

  await forwardJson(req, res, { path: "/api/intent", method: "POST", auth });
}
