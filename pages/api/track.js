// src/pages/api/track.js (Next.js 13+/app router users can place the same code in app/api/track/route.js)
// Collects a richer set of visitor analytics and stores them in Supabase.
// No permission dialogs are triggered — we rely only on request headers and
// client‑side information explicitly sent by the browser.

import { supabase } from '../../src/supabase/supabaseClient';

export default async function handler(req, res) {
  // Only accept POSTs from the client‑side tracking helper
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    /*--------------------------------------------------------------------
     * 1. Extract the payload the browser sent
     *    – localTime:   visitor's local clock (ISO string)
     *    – screen:      { w, h } viewport dimensions
     *    – tz:          IANA time‑zone name (e.g. "America/Denver")
     *    – lang:        browser language (e.g. "en-US")
     *    – event:       logical event name (defaults to "page_view")
     *-------------------------------------------------------------------*/
    const {
      localTime = new Date().toISOString(),
      screen = {},
      tz = null,
      lang = null,
      event = 'page_view',
    } = req.body ?? {};

    /*--------------------------------------------------------------------
     * 2. Determine the visitor's IP address
     *    – Works behind Vercel/Cloudflare/NGINX by trusting x-forwarded-for
     *-------------------------------------------------------------------*/
    const forwarded = req.headers['x-forwarded-for'] || '';
    const ip = (forwarded.split(',')[0] || req.socket?.remoteAddress || '').trim();

    /*--------------------------------------------------------------------
     * 3. Geo‑lookup the IP (best‑effort, no blocking on failure)
     *    – Uses ipapi.co (free tier ≤30k/mo) — swap for MaxMind DB or Cloudflare
     *-------------------------------------------------------------------*/
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
      }
    } catch (_) {
      // Network failure or private IP — ignore, keep geo {}
    }

    /*--------------------------------------------------------------------
     * 4. User agent string (trimmed to 255 chars for Postgres VARCHAR)
     *-------------------------------------------------------------------*/
    const userAgent = (req.headers['user-agent'] ?? '').slice(0, 255);

    /*--------------------------------------------------------------------
     * 5. Persist everything in the Supabase table `visitor_logs`
     *    Ensure your table has columns that match these keys (see README)
     *-------------------------------------------------------------------*/
    const insertPayload = {
      ip,
      local_time: localTime,
      event,
      ua: userAgent,
      screen_w: screen.w ?? null,
      screen_h: screen.h ?? null,
      tz,
      lang,
      ...geo, // spreads country, region, city, latitude, longitude
      created_at: new Date().toISOString(), // optional: server timestamp
    };

    const { error } = await supabase.from('visitor_logs').insert([insertPayload]);
    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Visitor tracking failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
