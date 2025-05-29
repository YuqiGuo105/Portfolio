// src/pages/api/track.js — explicit keys in payload (no spread)
// -----------------------------------------------------------------------------
// • Vercel / Cloudflare header geolocation — no external API calls
// • insertPayload lists each key explicitly (country, region, ...)
// -----------------------------------------------------------------------------
import { supabase } from '../../src/supabase/supabaseClient';

// --------------------------- Helper ----------------------------------------
function safeParseFloat(val) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

function geoFromHeaders(h) {
  // Vercel Edge headers -----------------------------------------------------
  if (h['x-vercel-ip-country']) {
    return {
      country: h['x-vercel-ip-country'] || null,
      region: h['x-vercel-ip-country-region'] || null,
      city: h['x-vercel-ip-city'] ? decodeURIComponent(h['x-vercel-ip-city']) : null,
      latitude: safeParseFloat(h['x-vercel-ip-latitude']),
      longitude: safeParseFloat(h['x-vercel-ip-longitude']),
      _src: 'vercel',
    };
  }
  // Cloudflare headers ------------------------------------------------------
  if (h['cf-ipcountry']) {
    return {
      country: h['cf-ipcountry'] || null,
      region: h['cf-region'] || null,
      city: h['cf-ipcity'] ? decodeURIComponent(h['cf-ipcity']) : null,
      latitude: safeParseFloat(h['cf-latitude']),
      longitude: safeParseFloat(h['cf-longitude']),
      _src: 'cloudflare',
    };
  }
  return { _src: 'none' };
}

// --------------------------- Handler --------------------------------------
export default async function handler(req, res) {
  const start = Date.now();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const { localTime = new Date().toISOString(), event = 'page_view' } = body;

  // IP extraction -----------------------------------------------------------
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = (forwarded.split(',')[0] || req.socket?.remoteAddress || '').trim();

  // Geolocation -------------------------------------------------------------
  const geo = geoFromHeaders(req.headers);
  const { country, region, city, latitude, longitude, _src } = geo;

  // UA & explicit payload ---------------------------------------------------
  const ua = (req.headers['user-agent'] || '').slice(0, 255);
  const insertPayload = {
    ip,
    local_time: localTime,
    event,
    ua,
    country,
    region,
    city,
    latitude,
    longitude,
    created_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from('visitor_logs').insert([insertPayload]);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Track] insert error:', err);
    res.status(500).json({ ok: false, message: err.message, db: err.code });
  } finally {
    console.log(`[Track] done in ${Date.now() - start}ms src=${_src}`);
  }
}
