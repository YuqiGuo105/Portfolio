// Globe guestbook: visitors plant a flag (an emoji, optionally a short note) on the visitor globe.
// Emoji-only flags show right away; any note waits for owner review in /admin/globe-flags.
// Storage is public.globe_flags (supabase/migrations/20261027210000_globe_flags.sql), reached only
// through the service-role server client, never from the browser.
import crypto from 'node:crypto';
import { clientIp, requestGeo, sameOriginJson } from './requestGeo.mjs';

export const FLAG_EMOJIS = Object.freeze(['🚩', '👋', '❤️', '🌏', '☕', '🚀', '🎉', '🐼']);
export const MESSAGE_MAX = 60;
export const LIST_LIMIT = 300;
const PUBLIC_COLUMNS = 'id, created_at, lat, lng, city, country, emoji, message';

export class FlagError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

// Invisible and direction-changing characters are dropped so a note cannot hide or reorder text.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
const LINK = /(https?:|www\.|[a-z0-9-]+\.(com|net|org|io|site|cn|me|co|xyz|app|dev|ly|gg|tk|ru)\b|@[a-z0-9_]{3,}|[^\s@]+@[^\s@]+)/i;
const PHONE = /\d[\d\s().-]{6,}\d/;

export function cleanMessage(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new FlagError('invalid_message');
  const text = value.normalize('NFKC').replace(INVISIBLE, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if ([...text].length > MESSAGE_MAX) throw new FlagError('message_too_long');
  if (LINK.test(text) || PHONE.test(text)) throw new FlagError('message_not_allowed');
  return text;
}

const coordinate = (value, limit) => {
  if (value == null) return null;
  const n = Number(value);
  if (typeof value === 'boolean' || !Number.isFinite(n) || Math.abs(n) > limit) throw new FlagError('invalid_location');
  return Math.round(n * 100) / 100;
};

// The flag a visitor asked for, before storage. `geo` is the request's own approximate location.
export function validateFlag(body, geo) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FlagError('invalid_body');
  const allowed = new Set(['emoji', 'message', 'lat', 'lng', 'website']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new FlagError('invalid_body');
  // Honeypot: a hidden field people never see; anything filling it is a bot.
  if (body.website) throw new FlagError('rejected', 400);
  if (!FLAG_EMOJIS.includes(body.emoji)) throw new FlagError('invalid_emoji');
  const message = cleanMessage(body.message);
  let lat = coordinate(body.lat, 90);
  let lng = coordinate(body.lng, 180);
  if ((lat === null) !== (lng === null)) throw new FlagError('invalid_location');
  const picked = lat !== null;
  if (!picked) {
    if (!geo) throw new FlagError('location_required');
    ({ lat, lng } = geo);
  }
  return {
    lat, lng, emoji: body.emoji,
    message: message || null,
    // A spot picked on the globe is somewhere else, so the visitor's own city is not attached to it.
    city: picked ? null : geo?.city || null,
    country: picked ? null : geo?.country || null,
    status: message ? 'pending' : 'approved',
  };
}

export function publicFlag(row) {
  if (!row || typeof row !== 'object') return null;
  const lat = Number(row.lat); const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !FLAG_EMOJIS.includes(row.emoji)) return null;
  return {
    id: String(row.id), lat, lng, emoji: row.emoji,
    message: typeof row.message === 'string' ? row.message : '',
    city: typeof row.city === 'string' ? row.city : '',
    country: typeof row.country === 'string' ? row.country : '',
    createdAt: row.created_at || null,
  };
}

const missingTable = (error) => ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);

export function supabaseFlagStore(client) {
  return {
    async listApproved(limit = LIST_LIMIT) {
      const { data, error } = await client.from('globe_flags').select(PUBLIC_COLUMNS)
        .eq('status', 'approved').order('created_at', { ascending: false }).limit(limit);
      if (missingTable(error)) return null;
      if (error) throw error;
      return data || [];
    },
    async insert(row) {
      const { data, error } = await client.from('globe_flags').insert(row).select(PUBLIC_COLUMNS).single();
      if (missingTable(error)) throw new FlagError('unavailable', 503);
      if (error) throw error;
      return data;
    },
    async listForReview(status = 'pending', limit = 200) {
      const { data, error } = await client.from('globe_flags').select(`${PUBLIC_COLUMNS}, status, reviewed_at`)
        .eq('status', status).order('created_at', { ascending: false }).limit(limit);
      if (missingTable(error)) return null;
      if (error) throw error;
      return data || [];
    },
    async review(id, action) {
      if (action === 'delete') {
        const { error } = await client.from('globe_flags').delete().eq('id', id);
        if (error) throw error;
        return { id, deleted: true };
      }
      const { data, error } = await client.from('globe_flags')
        .update({ status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', id).select('id, status').single();
      if (error) throw error;
      return data;
    },
  };
}

function ipHash(ip) {
  const key = process.env.ANALYTICS_INGEST_HMAC_KEY || process.env.ANALYTICS_HMAC_SALT;
  if (!key || !ip) return null;
  return crypto.createHmac('sha256', key).update(`globe-flag:${ip}`).digest('hex');
}

export function createFlagsHandler({ store, isRateLimited, geoOf = requestGeo }) {
  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method === 'GET') {
        const rows = await store().listApproved();
        res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=120');
        if (rows === null) return res.status(200).json({ enabled: false, flags: [] });
        return res.status(200).json({ enabled: true, flags: rows.map(publicFlag).filter(Boolean) });
      }
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
      const originError = sameOriginJson(req);
      if (originError) return res.status(originError === 'json_required' ? 415 : 403).json({ error: originError });
      const flag = validateFlag(req.body, geoOf(req.headers || {}));
      const ip = clientIp(req);
      const limited = await isRateLimited(ip, 'globe-flag', { limit: 3, windowMs: 60 * 60_000 }) ||
        await isRateLimited('all', 'globe-flag-global', { limit: 120, windowMs: 60 * 60_000 });
      if (limited) { res.setHeader('Retry-After', '3600'); return res.status(429).json({ error: 'rate_limited' }); }
      const saved = await store().insert({ ...flag, ip_hash: ipHash(ip) });
      return res.status(201).json({ status: flag.status, flag: flag.status === 'approved' ? publicFlag(saved) : null });
    } catch (error) {
      if (error instanceof FlagError) return res.status(error.status).json({ error: error.code });
      console.error('[globe-flags]', error?.message || error);
      return res.status(503).json({ error: 'unavailable' });
    }
  };
}
