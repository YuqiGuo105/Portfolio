import { LIVE_MODEL, MAX_CALL_SECONDS, cleanPageContext, liveConfig, wireSetup } from './protocol.mjs';
import { createProfileLoader } from './publicProfile.mjs';
import { appendFileSync, readFileSync } from 'node:fs';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const bounded = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.min(maximum, Math.floor(parsed)) : fallback;
};

export function isLocalVoiceRequest(req, env) {
  if (env.NODE_ENV !== 'development' || env.GEMINI_LIVE_ENABLED !== 'true') return false;
  if (!LOOPBACK.has(req.socket?.remoteAddress)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
    const origin = new URL(req.headers.origin);
    return origin.protocol === 'http:' && origin.host === host.host;
  } catch { return false; }
}

// One local preview process only. Production stays disabled until distributed
// quotas, user authentication and billing controls are approved separately.
export function createSessionHandler({ env = process.env, fetchImpl = fetch, now = Date.now, loadProfile = createProfileLoader() } = {}) {
  let starts = [];
  const maxSeconds = bounded(env.GEMINI_LIVE_MAX_SECONDS, MAX_CALL_SECONDS, 10, MAX_CALL_SECONDS);
  const maxCalls = bounded(env.GEMINI_LIVE_MAX_CALLS, 12, 1, 12);
  const maxOutputTokens = bounded(env.GEMINI_LIVE_MAX_OUTPUT_TOKENS, 512, 64, 512);
  const ledger = env.GEMINI_LIVE_TRIAL_LEDGER;
  return async function sessionHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    // GET has no browser Origin header; it reveals configuration presence only.
    const request = req.method === 'GET' ? { ...req, headers: { ...req.headers, origin: req.headers.origin || `http://${req.headers.host}` } } : req;
    if (!isLocalVoiceRequest(request, env)) return res.status(404).json({ error: 'Not found.' });
    const configured = Boolean(env.GEMINI_LIVE_API_KEY) && env.GEMINI_LIVE_BILLING_ACK === 'true';
    const model = env.GEMINI_LIVE_MODEL || LIVE_MODEL;
    const time = now();
    let trialAvailable = true;
    if (ledger) {
      try {
        // Approval-scoped receipts survive hot reloads and server restarts.
        const receipts = readFileSync(ledger, 'utf8').trim();
        starts = receipts ? receipts.split('\n').map(line => JSON.parse(line).startedAt) : [];
        if (!starts.every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid trial ledger');
      } catch (error) {
        if (error.code === 'ENOENT') starts = [];
        else trialAvailable = false;
      }
    } else starts = starts.filter(t => time - t < 86400000);
    const remainingCalls = trialAvailable ? Math.max(0, maxCalls - starts.length) : 0;
    if (req.method === 'GET') return res.status(200).json({ configured: configured && remainingCalls > 0, provider: 'Google', model, maxSeconds, remainingCalls,
      reason: !configured ? 'setup_required' : !trialAvailable ? 'trial_unavailable' : remainingCalls === 0 ? 'trial_ended' : null });
    if (!configured) return res.status(503).json({ error: 'Voice is not configured locally. A dedicated Google API key and billing acknowledgement are required.' });
    const page = cleanPageContext(req.body?.page);
    if (!page) return res.status(400).json({ error: 'Voice is available on public pages only.' });
    if (!trialAvailable) return res.status(503).json({ error: 'Local trial allowance could not be verified.' });
    if (!remainingCalls || starts.filter(t => time - t < 60000).length >= 3) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Local preview call limit reached. Try later.' });
    }
    if (ledger) {
      try { appendFileSync(ledger, `${JSON.stringify({ startedAt: time })}\n`, { mode: 0o600 }); }
      catch { return res.status(503).json({ error: 'Local trial allowance could not be reserved.' }); }
    }
    starts.push(time);
    const profile = await loadProfile();
    if (req.aborted) return;
    const config = liveConfig(page, profile);
    config.maxOutputTokens = maxOutputTokens;
    const issuedAt = now();
    const expireTime = new Date(issuedAt + maxSeconds * 1000).toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const disconnect = () => controller.abort();
    req.once?.('aborted', disconnect);
    try {
      const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_LIVE_API_KEY },
        body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime: new Date(issuedAt + 30000).toISOString(),
          bidiGenerateContentSetup: wireSetup(model, config) }),
      });
      if (!response.ok) return res.status(response.status === 429 ? 429 : 502).json({ error: 'Google could not authorize this voice session. Check the project model access and quota.' });
      const token = await response.json();
      if (typeof token.name !== 'string' || !token.name.startsWith('auth_tokens/')) throw new Error('Invalid token response');
      const estimatedLimit = Number(env.GEMINI_LIVE_MAX_ESTIMATED_USD);
      return res.status(200).json({ token: token.name, setup: wireSetup(model, config), profile, maxSeconds, expiresAt: expireTime,
        ...(estimatedLimit > 0 ? { maxEstimatedUsd: Math.min(0.25, estimatedLimit) } : {}) });
    } catch {
      // Never reflect provider URLs, bodies, tokens or credential-bearing errors.
      return res.status(502).json({ error: 'Google voice authorization timed out or failed. Try again.' });
    } finally {
      clearTimeout(timer);
      req.off?.('aborted', disconnect);
    }
  };
}
