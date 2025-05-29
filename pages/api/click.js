// src/pages/api/track.js  — header‑first Geo, ipinfo fallback, zero 3rd‑party rate‑limit
// -----------------------------------------------------------------------------
//  ❑ Order of geo resolution (no user prompt required):
//    1. CDN / platform headers (Vercel, Cloudflare, AWS ALB)
//    2. Self‑hosted MaxMind DB or ipinfo.io (tokened)
//    3. Skip geo for private / localhost IPs
// -----------------------------------------------------------------------------
import { supabase } from '../../src/supabase/supabaseClient';

// Helpers --------------------------------------------------------------
const isPrivate = (ip) =>
  ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.');

async function geoFromHeaders(h) {
  /* Vercel Edge */
  if (h['x-vercel-ip-country']) {
    return {
      country: h['x-vercel-ip-country'] || null,
      region: h['x-vercel-ip-country-region'] || null,
      city: h['x-vercel-ip-city'] || null,
      latitude: h['x-vercel-ip-latitude'] || null,
      longitude: h['x-vercel-ip-longitude'] || null,
      _src: 'vercel',
    };
  }
  /* Cloudflare */
  if (h['cf-ipcountry']) {
    return {
      country: h['cf-ipcountry'] || null,
      region: h['cf-region'] || null,
      city: h['cf-ipcity'] || null,
      latitude: h['cf-latitude'] || null,
      longitude: h['cf-longitude'] || null,
      _src: 'cloudflare',
    };
  }
  return null; // let caller try other sources
}

async function geoFromIpinfo(ip) {
  const token = process.env.IPINFO_TOKEN; // free 50k/mo
  if (!token) return null;
  try {
    const r = await fetch(`https://ipinfo.io/${ip}?token=${token}`, { timeout: 1500 });
    if (!r.ok) return null;
    const d = await r.json();
    const [lat, lon] = (d.loc || '').split(',');
    return {
      country: d.country || null,
      region: d.region || null,
      city: d.city || null,
      latitude: lat || null,
      longitude: lon || null,
      _src: 'ipinfo',
    };
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  const start = Date.now();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const {
    localTime = new Date().toISOString(),
    screen = {},
    tz = null,
    lang = null,
    event = 'page_view',
  } = body;

  // ---- IP ------------------------------------------------------------------
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = (forwarded.split(',')[0] || req.socket?.remoteAddress || '').trim();

  // ---- Geo -----------------------------------------------------------------
  let geo = (await geoFromHeaders(req.headers)) || {};
  if (!Object.keys(geo).length && !isPrivate(ip)) {
    geo = (await geoFromIpinfo(ip)) || {};
  }

  // ---- UA / Payload --------------------------------------------------------
  const ua = (req.headers['user-agent'] || '').slice(0, 255);
  const insertPayload = {
    ip,
    local_time: localTime,
    event,
    ua,
    screen_w: screen.w ?? null,
    screen_h: screen.h ?? null,
    tz,
    lang,
    ...geo,
    created_at: new Date().toISOString(), // uncomment if you added this column
  };

  try {
    const { error } = await supabase.from('visitor_logs').insert([insertPayload]);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Track] insert error:', err);
    res.status(500).json({ ok: false, message: err.message, db: err.code });
  } finally {
    const ms = Date.now() - start;
    console.log(`[Track] done in ${ms}ms  src=${geo._src || 'none'}`);
  }
}
