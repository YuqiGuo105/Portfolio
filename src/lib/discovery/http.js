import { discoveryEnabled, discoveryRuntime } from './runtime.mjs';
import { contactIp } from '../contactGuard.mjs';
import { isRateLimited } from '../rateLimiter';

export async function moderateChatRequest(req, res) {
  if (!discoveryEnabled()) return true;
  const text = req.body?.utterance ?? req.body?.question ?? req.body?.message ?? req.body?.input;
  if (typeof text !== 'string' || !text.trim() || text.length > 6000) { res.status(400).json({ error: 'Please enter a message of at most 6,000 characters.' }); return false; }
  if (await isRateLimited(contactIp(req), 'chat-moderation', { limit: 12, windowMs: 60000 })) { res.status(429).json({ error: 'Please wait a moment before sending another message.' }); return false; }
  try {
    const result = await discoveryRuntime().moderate('chat', text);
    if (result.decision === 'allow') return true;
    res.status(result.decision === 'reject' ? 422 : 503).json({ error: result.decision === 'reject'
      ? 'This message cannot be processed. Please rephrase it.'
      : 'This message needs review before it can be processed. Please try a different question.', code: `moderation_${result.decision}` });
  } catch { res.status(503).json({ error: 'Message safety checks are temporarily unavailable. Please try again later.' }); }
  return false;
}
