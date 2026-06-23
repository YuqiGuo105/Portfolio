/**
 * POST /api/agent/chat
 *
 * Streams SSE from portfolio-agent-service `/api/chat` straight to the browser,
 * after verifying the Supabase session and injecting the resolved email/roles
 * into the upstream payload.
 *
 * Body matches the agent's ChatRequest (sessionId, utterance, etc.).
 *
 * Response: text/event-stream
 */
import {
  forwardSse,
  methodGuard,
  requireSupabaseUser,
} from "../../../src/lib/agentServiceProxy";

// Disable Next.js default JSON response so we can write SSE bytes ourselves.
export const config = {
  api: {
    bodyParser: { sizeLimit: "1mb" },
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const auth = await requireSupabaseUser(req, res, { allowAnonymous: true });
  if (!auth) return;

  await forwardSse(req, res, { auth });
}
