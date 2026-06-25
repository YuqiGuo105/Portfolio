// src/pages/api/track.js — explicit keys in payload (no spread)
// -----------------------------------------------------------------------------
// • Vercel / Cloudflare header geolocation — no external API calls
// • insertPayload lists each key explicitly (country, region, ...)
// • Dual-write: Supabase visitor_logs (source of truth) + Kafka analytics.raw.events
//   (real-time aggregation). Kafka produce is best-effort — failures do not block
//   the 200 response and never lose the Supabase row.
// -----------------------------------------------------------------------------
import { supabaseServer } from '../../src/supabase/supabaseServer';
import { produceRawEvent } from '../../src/lib/kafkaProducer';
import { uuidv7 } from '../../src/lib/uuidv7';

// 速率限制：每个 IP 每分钟最多 10 次
const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count += 1;
  return false;
}

// 允许的来源域名
const ALLOWED_ORIGINS = ['https://www.yuqi.site', 'https://yuqi.site'];

// Allowed event names — prevents arbitrary string injection into visitor_logs.event
const ALLOWED_EVENTS = new Set(['page_view']);

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

  // 1. Origin / Referer 检查
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  const originOk = ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o));
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev && !originOk) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 2. User-Agent 过滤（拒绝明显的 bot/curl）
  const ua = (req.headers['user-agent'] || '').slice(0, 255);
  if (!ua || /^(curl|wget|python|go-http|java|scrapy)/i.test(ua) || /\b(bot|spider|crawl|scraper)\b/i.test(ua)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 3. IP 速率限制
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = (forwarded.split(',')[0] || req.socket?.remoteAddress || '').trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[Track] Supabase credentials missing – skipping insert');
    return res.status(200).json({ ok: true, skipped: 'supabase-not-configured' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const { localTime = new Date().toISOString() } = body;

  // Validate event against allowlist to prevent arbitrary string injection.
  const rawEvent = typeof body.event === 'string' ? body.event.trim() : '';
  const event = ALLOWED_EVENTS.has(rawEvent) ? rawEvent : 'page_view';

  // IP already extracted above for rate limiting

  // Geolocation -------------------------------------------------------------
  const geo = geoFromHeaders(req.headers);
  const { country, region, city, latitude, longitude, _src } = geo;

  // UA & explicit payload ---------------------------------------------------
  // ua already extracted above for bot filtering
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
    const now = new Date().toISOString();
    const { error } = await supabaseServer.from('visitor_logs').insert([insertPayload]);
    if (error) throw error;

    // Best-effort Kafka produce — does not block the response.
    // Construct the RawEvent wire format expected by analytics-aggregator-service.
    const rawEvent = {
      eventId:    uuidv7(),           // UUIDv7 — global dedup key downstream
      siteId:     'yuqi.site',
      eventType:  event,              // page_view (or future click)
      eventTime:  localTime,          // client wall-clock ISO string
      serverTime: now,                // stamped by this handler
      pageUrl:    body.page || null,
      referrer:   body.referrer || null,
      uaRaw:      ua,
      ipRaw:      ip,                 // HMAC'd by enrichment; never persisted
      geoHint: {
        country: country ?? null,
        region:  region  ?? null,
        city:    city    ?? null,
        lat:     latitude  ?? null,
        lng:     longitude ?? null,
        src:     _src,
      },
    };
    produceRawEvent(rawEvent).catch(() => {/* already logged inside */});

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Track] insert error:', err);
    res.status(500).json({ ok: false, message: err.message, db: err.code });
  } finally {
    console.log(`[Track] done in ${Date.now() - start}ms src=${_src}`);
  }
}
