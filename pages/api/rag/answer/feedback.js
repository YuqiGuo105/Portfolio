import { supabaseServer } from '../../../../src/supabase/supabaseServer';
import { contactIp } from '../../../../src/lib/contactGuard.mjs';
import { isRateLimited } from '../../../../src/lib/rateLimiter';
import { agentRunSource, createFeedbackHandler, supabaseFeedbackStore } from '../../../../src/lib/chat/answerFeedback.mjs';

export const config = { api: { bodyParser: { sizeLimit: '2kb' } } };

// A visitor's verdict on one answer: POST { runId, verdict: "up" | "down" | null, sessionId }.
// The answer itself is read from the agent service here, never taken from the browser.
export default createFeedbackHandler({
  runs: agentRunSource({ base: process.env.AGENT_SERVICE_URL, token: process.env.AGENT_SERVICE_INTERNAL_TOKEN }),
  store: supabaseFeedbackStore(supabaseServer),
  limited: ip => isRateLimited(ip, 'answer-feedback', { limit: 12, windowMs: 60_000 }),
  ip: contactIp,
});
