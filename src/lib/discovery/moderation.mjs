import { randomUUID } from 'node:crypto';
import { digest } from './provider.mjs';

const CHANNELS = new Set(['globe', 'contact', 'chat']);
export function moderationRules(channel, text) {
  if (!CHANNELS.has(channel) || typeof text !== 'string' || !text.trim() || text.length > 6000) return { decision: 'reject', category: 'invalid', risk: 100, model: 'rules-v1' };
  const normalized = text.normalize('NFKC');
  if (/(.)\1{30,}/u.test(normalized) || (normalized.match(/https?:\/\//gi) || []).length >= 8) return { decision: 'reject', category: 'spam', risk: 100, model: 'rules-v1' };
  return null;
}

const redact = text => text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]').replace(/\+?\d[\d ()-]{8,}\d/g, '[phone]');
export function createModerator({ store, provider, reviews, now = Date.now }) {
  return async function moderate(channel, text, context = {}) {
    let result = moderationRules(channel, text);
    if (!result) {
      const key = `moderation:v1:${channel}:${digest(text)}`;
      try {
        result = await store.get(key);
        if (!result) { result = await provider.moderate(channel, redact(text)); await store.set(key, result, 3600); }
      } catch { result = { decision: 'review', category: 'unavailable', risk: null, model: 'fail-closed' }; }
    }
    if (result.decision === 'review' && channel !== 'globe') {
      // Separate contact fields stay private; email/phone patterns in message text are redacted above.
      const item = await reviews.enqueue({ id: randomUUID(), channel, text: text.slice(0, 6000),
        context: channel === 'contact' ? { name: context.name, email: context.email } : {},
        fingerprint: digest(`${channel}:${JSON.stringify(context)}:${text}:${Math.floor(now() / 86400000)}`),
        reason: result.category, risk: result.risk, model: result.model, status: 'pending', created_at: new Date(now()).toISOString() });
      return { ...result, reviewId: item.id };
    }
    return result;
  };
}

export function memoryReviews(now = Date.now) {
  const rows = new Map();
  return {
    async enqueue(row) { const existing = [...rows.values()].find(item => item.fingerprint === row.fingerprint); if (existing) return existing; rows.set(row.id, { ...row, expires_at: new Date(now() + 30 * 86400000).toISOString(), audit: [] }); return rows.get(row.id); },
    async list() { return [...rows.values()].filter(row => Date.parse(row.expires_at) > now()).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async transition(id, from, to, actor) {
      const row = rows.get(id);
      if (!row || row.status !== from || Date.parse(row.expires_at) <= now()) return null;
      row.status = to; row.audit.push({ actor, action: to, at: new Date(now()).toISOString() }); return { ...row };
    },
  };
}

export function supabaseReviews(client) {
  const table = 'content_review_queue';
  return {
    async enqueue(row) {
      const { data, error } = await client.from(table).upsert(row, { onConflict: 'fingerprint', ignoreDuplicates: true }).select('*');
      if (error) throw new Error('Review queue unavailable');
      if (data?.length) return data[0];
      const existing = await client.from(table).select('id,status').eq('fingerprint', row.fingerprint).single();
      if (existing.error) throw new Error('Review queue unavailable');
      return existing.data;
    },
    async list() {
      const { data, error } = await client.from(table).select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error('Review queue unavailable'); return data;
    },
    async transition(id, from, to, actor) {
      const { data, error } = await client.rpc('review_content_transition', { item_id: id, expected_status: from, next_status: to, actor_id: actor });
      if (error) throw new Error('Review update unavailable'); return data?.[0] || null;
    },
  };
}

export async function reviewSubmission({ reviews, id, action, actor, sendMail }) {
  if (!['approve', 'reject'].includes(action)) throw new RangeError('Invalid review action');
  const row = await reviews.transition(id, 'pending', action === 'approve' ? 'releasing' : 'rejected', actor);
  if (!row) return { conflict: true };
  if (action === 'reject') return row;
  if (row.channel === 'contact') {
    try { await sendMail({ ...row.context, message: row.text }); }
    catch { return reviews.transition(id, 'releasing', 'delivery_unknown', actor); }
  }
  // A reviewed chat is never replayed into an agent or tools automatically.
  return reviews.transition(id, 'releasing', row.channel === 'contact' ? 'sent' : 'reviewed', actor);
}
