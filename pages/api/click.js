// pages/api/click.js — Kafka-primary click ingestion
// -----------------------------------------------------------------------------
// Mirrors the track.js Kafka-primary pattern: all clicks go to Kafka as
// eventType="click" and are consumed by the aggregator (rollup + session).
// Supabase direct insert is only a fallback when Kafka is unavailable.
// -----------------------------------------------------------------------------
import { supabaseServer } from '../../src/supabase/supabaseServer';
import { produceRawEvent } from '../../src/lib/kafkaProducer';
import { uuidv7 } from '../../src/lib/uuidv7';
import { isRateLimited } from '../../src/lib/rateLimiter';

// 允许的来源域名
const ALLOWED_ORIGINS = ['https://www.yuqi.site', 'https://yuqi.site'];

// Only these values are accepted for click_event to prevent arbitrary string injection.
const ALLOWED_CLICK_EVENTS = new Set(['social-link', 'blog-item', 'work-item', 'project-link', 'nav-link']);

function safeParseFloat(val) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

function geoFromHeaders(h) {
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

// Fallback: direct Supabase insert (only when Kafka fails)
async function fallbackSupabaseInsert(insertPayload) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, skipped: 'supabase-not-configured' };
  }
  try {
    const { error } = await supabaseServer.from('visitor_clicks').insert([insertPayload]);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

export default async function handler(req, res) {
  const start = Date.now();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Origin / Referer check
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  const originOk = ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o));
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev && !originOk) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 2. User-Agent filter
  const ua = (req.headers['user-agent'] || '').slice(0, 255);
  if (!ua || /^(curl|wget|python|go-http|java|scrapy)/i.test(ua) || /\b(bot|spider|crawl|scraper)\b/i.test(ua)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 3. Rate limiting
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = (forwarded.split(',')[0] || req.socket?.remoteAddress || '').trim();
  if (await isRateLimited(ip, 'click')) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  // Validate clickEvent
  const rawEvent = typeof body.clickEvent === 'string' ? body.clickEvent.trim() : '';
  if (!ALLOWED_CLICK_EVENTS.has(rawEvent)) {
    return res.status(400).json({ error: 'Invalid clickEvent' });
  }
  const clickEvent = rawEvent;

  // targetUrl required
  const targetUrl = typeof body.targetUrl === 'string' && body.targetUrl.trim()
    ? body.targetUrl.trim().slice(0, 2048)
    : null;
  if (!targetUrl) {
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  const localTime = body.localTime ?? new Date().toISOString();
  const geo = geoFromHeaders(req.headers);
  const { country, region, city, latitude, longitude, _src } = geo;
  const nowIso = new Date().toISOString();

  // RawEvent wire format for the aggregator Kafka consumer.
  // eventType="click", pageUrl=current page, targetUrl=what was clicked.
  const kafkaEvent = {
    eventId:    uuidv7(),
    siteId:     'yuqi.site',
    eventType:  'click',
    eventTime:  localTime,
    serverTime: nowIso,
    pageUrl:    body.page || null,
    targetUrl:  targetUrl,
    referrer:   body.referrer || null,
    uaRaw:      ua,
    ipRaw:      ip,
    sessionId:  body.sessionId || null,
    geoHint: {
      country: country ?? null,
      region:  region  ?? null,
      city:    city    ?? null,
      lat:     latitude  ?? null,
      lng:     longitude ?? null,
      src:     _src,
    },
    // Extra metadata the aggregator can use for funnel analysis
    clickEvent: clickEvent,
  };

  // Legacy insert payload (fallback only)
  const insertPayload = {
    ip,
    local_time: localTime,
    click_event: clickEvent,
    ua,
    target_url: targetUrl,
    country: geo.country ?? null,
    region: geo.region ?? null,
    city: geo.city ?? null,
    latitude: geo.latitude ?? null,
    longitude: geo.longitude ?? null,
    created_at: nowIso,
  };

  try {
    // Primary path: Kafka
    const kafkaOk = await produceRawEvent(kafkaEvent);
    if (kafkaOk) {
      return res.status(200).json({ ok: true, via: 'kafka' });
    }

    // Fallback: Supabase direct insert
    const fb = await fallbackSupabaseInsert(insertPayload);
    if (fb.ok) {
      return res.status(200).json({ ok: true, via: 'supabase-fallback' });
    }
    if (fb.skipped) {
      console.warn('[Click] Kafka unavailable and Supabase not configured');
      return res.status(200).json({ ok: true, skipped: fb.skipped });
    }

    console.error('[Click] both Kafka and Supabase failed:', fb.error);
    return res.status(500).json({ ok: false, message: 'ingest_failed' });
  } finally {
    console.log(`[Click] done in ${Date.now() - start}ms src=${_src}`);
  }
}
