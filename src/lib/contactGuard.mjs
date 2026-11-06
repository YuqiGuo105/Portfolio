import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_ORIGINS = ['https://yuqi.site', 'https://www.yuqi.site'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ContactError extends Error {
  constructor(code, status = 403) { super(code); this.code = code; this.status = status; }
}

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value : '';
}

export function contactIdentity(req, env = process.env) {
  const credential = header(req, 'x-portfolio-contact-token');
  if (req.headers?.['x-portfolio-contact-token'] !== undefined) {
    const expected = env.CONTACT_MCP_TOKEN || '';
    const digest = value => createHash('sha256').update(value).digest();
    if (expected.length < 32 || credential.length > 512 || !credential
      || !timingSafeEqual(digest(expected), digest(credential))) {
      throw new ContactError('invalid_service_credential', 401);
    }
    return 'mcp';
  }
  const origin = header(req, 'origin');
  const origins = new Set((env.CONTACT_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',').map(value => value.trim()).filter(Boolean));
  if (env.NODE_ENV === 'development') {
    const host = header(req, 'host');
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) origins.add(`http://${host}`);
  }
  if (!origins.has(origin) || header(req, 'sec-fetch-site') === 'cross-site') {
    throw new ContactError('invalid_origin');
  }
  return 'web';
}

export function contactIp(req, env = process.env) {
  // Only trust platform-injected proxy headers on Vercel, never arbitrary local headers.
  const value = env.VERCEL === '1'
    ? header(req, 'x-vercel-forwarded-for') || header(req, 'x-forwarded-for')
    : req.socket?.remoteAddress || '';
  const ip = value.split(',')[0].trim();
  return isIP(ip) ? ip : 'unknown';
}

export function contactFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ContactError('invalid_fields', 400);
  const field = (key, max, required = false) => {
    if (body[key] === undefined && !required) return '';
    if (typeof body[key] !== 'string' || body[key].length > max) throw new ContactError('invalid_fields', 400);
    const value = body[key].trim();
    if (required && !value) throw new ContactError('invalid_fields', 400);
    return value;
  };
  const name = field('name', 120) || 'Portfolio visitor';
  const email = field('email', 320, true).toLowerCase();
  const message = field('message', 5000, true);
  if (!EMAIL_PATTERN.test(email) || /[\r\n]/.test(name)) throw new ContactError('invalid_fields', 400);
  return { name, email, message };
}

export async function verifyContactToken(token, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  if (typeof token !== 'string' || !token || token.length > 2048) throw new ContactError('verification_required');
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret || (env.NODE_ENV === 'production' && /^[123]x0{10,}/.test(secret))) {
    throw new ContactError('verification_unavailable', 503);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchImpl(SITEVERIFY, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!response.ok) throw new ContactError('verification_unavailable', 503);
    const result = await response.json();
    if (result.success !== true) {
      const unavailable = (result['error-codes'] || []).some(code =>
        ['internal-error', 'missing-input-secret', 'invalid-input-secret'].includes(code));
      throw new ContactError(unavailable ? 'verification_unavailable' : 'verification_failed', unavailable ? 503 : 403);
    }
    const hosts = new Set((env.TURNSTILE_ALLOWED_HOSTS || 'yuqi.site,www.yuqi.site').split(',').map(host => host.trim().toLowerCase()));
    const age = now() - Date.parse(result.challenge_ts);
    if (!hosts.has(String(result.hostname || '').toLowerCase()) || result.action !== 'contact_submit'
      || !Number.isFinite(age) || age < -30000 || age > 300000) {
      throw new ContactError('verification_failed');
    }
  } catch (error) {
    if (error instanceof ContactError) throw error;
    throw new ContactError('verification_unavailable', 503);
  } finally { clearTimeout(timer); }
}

const ERROR_MESSAGES = {
  invalid_fields: 'Please check your name, email address and message.',
  invalid_origin: 'Please submit your message from the contact form on this site.',
  invalid_service_credential: 'The contact service could not authenticate this request.',
  unsupported_content_type: 'Please submit your message as JSON.',
  verification_required: 'Please complete the verification before sending.',
  verification_failed: 'Verification expired or failed. Please verify again.',
  verification_unavailable: 'Verification is temporarily unavailable. Your message has not been sent. Please try again.',
  rate_limited: 'Too many contact requests. Please try again later.',
  delivery_unavailable: 'We could not confirm delivery. Please wait before trying again.',
};

export function createContactHandler({ isRateLimited, sendMail, env = process.env, fetchImpl = fetch,
  audit = entry => console.info(JSON.stringify(entry)) } = {}) {
  const record = entry => {
    // Logging must not turn an accepted email into a retryable delivery error.
    try { audit(entry); } catch { /* The mail result remains authoritative. */ }
  };
  return async (req, res) => {
    const requestId = randomUUID();
    let source = 'unverified';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Request-Id', requestId);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
      source = contactIdentity(req, env);
      if (!/^application\/json(?:\s*;|$)/i.test(header(req, 'content-type'))) {
        throw new ContactError('unsupported_content_type', 415);
      }
      const fields = contactFields(req.body);
      const windowMs = Number(env.CONTACT_RATE_WINDOW_MS || 600000);
      if (await isRateLimited(source === 'mcp' ? 'trusted-gateway' : contactIp(req, env), `contact-${source}`, {
        limit: Number(env.CONTACT_RATE_LIMIT || 5), windowMs,
      })) {
        res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
        throw new ContactError('rate_limited', 429);
      }
      if (source === 'web') {
        if (req.body.website) throw new ContactError('verification_failed');
        await verifyContactToken(req.body.turnstileToken, { env, fetchImpl });
      }
      await sendMail(fields);
      record({ event: 'contact_submission', requestId, source, outcome: 'sent' });
      return res.status(200).json({ ok: true, message: 'Your message was sent to the site owner.', requestId });
    } catch (error) {
      const code = error instanceof ContactError ? error.code : 'delivery_unavailable';
      record({ event: 'contact_submission', requestId, source, outcome: 'not_sent_or_unconfirmed', reason: code });
      return res.status(error instanceof ContactError ? error.status : 503).json({ error: ERROR_MESSAGES[code], code, requestId });
    }
  };
}
