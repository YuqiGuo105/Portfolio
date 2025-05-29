// src/pages/api/track.js  — debug‑heavy version
// -----------------------------------------------------------------------------
//  Adds VERBOSE console output so you can see exactly what’s happening in the
//  Vercel / Supabase logs. Remove or lower the log level once it’s stable.
// -----------------------------------------------------------------------------

import { supabase } from '../../src/supabase/supabaseClient';

export default async function handler(req, res) {
  const startedAt = Date.now();
  console.log(`[Track] ➜  ${req.method} ${req.url}  ${new Date().toISOString()}`);

  // ---------------------------------------------------------------------------
  // Guard: only allow POST
  // ---------------------------------------------------------------------------
  if (req.method !== 'POST') {
    console.warn('[Track] ✖  Non‑POST request rejected');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---------------------------------------------------------------------------
  // 1) Parse & echo body for inspection
  // ---------------------------------------------------------------------------
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (parseErr) {
    console.error('[Track] ✖  Failed to parse JSON body:', parseErr);
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  console.log('Raw body:', body);

  // Destructure with sane fallbacks
  const {
    localTime = new Date().toISOString(),
    screen = {},
    tz = null,
    lang = null,
    event = 'page_view',
  } = body ?? {};

  // ---------------------------------------------------------------------------
  // 2) Resolve IP address (handles proxies)
  // ---------------------------------------------------------------------------
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = (forwarded.split(',')[0] || req.socket?.remoteAddress || '').trim();
  console.log('Derived IP:', ip || '[none]');

  // ---------------------------------------------------------------------------
  // 3) Geo lookup (best‑effort)
  // ---------------------------------------------------------------------------
  let geo = {};
  try {
    const geoRes = await fetch(`https://ipapi.co/${ip}/json/`, { timeout: 1500 });
    if (geoRes.ok) {
      const g = await geoRes.json();
      geo = {
        country: g.country_name ?? null,
        region: g.region ?? null,
        city: g.city ?? null,
        latitude: g.latitude ?? null,
        longitude: g.longitude ?? null,
      };
      console.log('Geo lookup success:', geo);
    } else {
      console.warn('Geo lookup HTTP', geoRes.status);
    }
  } catch (geoErr) {
    console.warn('Geo lookup failed:', geoErr.message);
  }

  // ---------------------------------------------------------------------------
  // 4) User‑Agent string (trimmed)
  // ---------------------------------------------------------------------------
  const userAgent = (req.headers['user-agent'] ?? '').slice(0, 255);
  console.log('UA:', userAgent);

  // ---------------------------------------------------------------------------
  // 5) Build insert payload
  // ---------------------------------------------------------------------------
  const insertPayload = {
    ip,
    local_time: localTime,
    event,
    ua: userAgent,
    screen_w: screen.w ?? null,
    screen_h: screen.h ?? null,
    tz,
    lang,
    ...geo,
    created_at: new Date().toISOString(),
  };
  console.log('Insert payload:', insertPayload);

  // ---------------------------------------------------------------------------
  // 6) Insert into Supabase
  // ---------------------------------------------------------------------------
  try {
    const { error } = await supabase.from('visitor_logs').insert([insertPayload]);
    if (error) throw error;
    console.log('Insert succeeded');
    res.status(200).json({ success: true });
  } catch (dbErr) {
    console.error('Supabase insert error:', dbErr);
    res.status(500).json({ success: false, message: dbErr.message });
  } finally {
    console.log(`Done in ${Date.now() - startedAt} ms`);
  }
}
