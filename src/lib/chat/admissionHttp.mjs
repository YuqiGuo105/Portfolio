// The chat's waiting line over HTTP: who is asking, the endpoint the widget talks to, and the
// check the answer endpoint makes before a message reaches the assistant.
import { createHash } from 'node:crypto';

const DEVICE = /^[A-Za-z0-9_-]{8,80}$/;
const header = (req, name) => { const value = req.headers?.[name]; return Array.isArray(value) ? value[0] : value || ''; };

// One visitor = one browser (the widget's device id), with the network kept as a short hash so a
// single network cannot take many places by inventing ids. No address is stored.
export function chatVisitor(req, { ipOf, salt = '' }) {
  const ip = String(ipOf(req) || '');
  const network = ip ? createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 12) : '';
  const device = header(req, 'x-cw-device-id');
  return { id: DEVICE.test(device) ? device : `net-${network || 'unknown'}`, ip: network };
}

// What the widget is told. Nothing here identifies anyone else in line.
export const publicAdmission = result => ({
  status: result.status,
  ...(result.status === 'active' ? { left: result.left, seconds: result.seconds } : {}),
  ...(result.status === 'queued' ? { position: result.position, ahead: result.ahead, eta: result.eta } : {}),
  ...(result.status === 'full' ? { reason: result.reason, retry: result.retry } : {}),
});

// The owner and other admins are never made to wait on their own site.
export const skipsLine = auth => Boolean(auth && !auth.anonymous && /ADMIN|OWNER/i.test(String(auth.roles || '')));

// POST { action: 'enter' | 'leave' } → the visitor's place, their position in line, or "full".
export function createAdmissionHandler({ admission, ipOf, isRateLimited, authorize = async () => null, salt = '' }) {
  return async function admissionHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
    const action = req.body?.action === 'leave' ? 'leave' : 'enter';
    const visitor = chatVisitor(req, { ipOf, salt });
    // Checking in every few seconds is expected; this only stops a script hammering the line.
    if (await isRateLimited(visitor.ip || visitor.id, 'chat-line', { limit: 90, windowMs: 60000 })) {
      res.setHeader('Retry-After', '30');
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (skipsLine(await authorize(req).catch(() => null))) return res.status(200).json({ status: 'active', owner: true });
    return res.status(200).json(publicAdmission(await admission.act({ ...visitor, action })));
  };
}

// Before a message is passed to the assistant: true lets it through (and counts it against the
// visitor's place); otherwise the response has been written and the caller stops.
export async function admitChatMessage(req, res, { admission, ipOf, auth, salt = '' }) {
  if (skipsLine(auth)) return true;
  const result = await admission.act({ ...chatVisitor(req, { ipOf, salt }), action: 'message' });
  if (result.allowed) return true;
  res.setHeader('Cache-Control', 'private, no-store');
  if (result.status === 'queued') res.setHeader('Retry-After', String(Math.min(result.eta || 30, 300)));
  res.status(429).json({ error: 'The chat is full right now.', code: 'RATE_LIMITED', admission: publicAdmission(result) });
  return false;
}
