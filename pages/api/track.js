// pages/api/track.js — Kafka-primary visitor ingestion
// -----------------------------------------------------------------------------
// Kafka is now the PRIMARY ingestion path. The batched aggregator consumer
// (portfolio-analytics-platform) is the source-of-truth writer for
// public.visitor_logs — it drains one Kafka poll → one batchUpdate insert
// per poll, so per-event DB write amplification collapses.
//
// This handler:
//   1. Runs the usual guards (method / origin / UA / rate limit).
//   2. Awaits produceRawEvent(rawEvent). If Kafka accepts the message we
//      respond immediately with { via: "kafka" } and NEVER open a Supabase
//      connection on the hot path.
//   3. Only if Kafka is not configured or the produce fails do we fall
//      back to a direct supabase insert so no event is ever lost. That
//      response is { via: "supabase-fallback" }.
//   4. If both fail we return 500.
// -----------------------------------------------------------------------------
import { supabaseServer } from '../../src/supabase/supabaseServer';
import { produceRawEvent } from '../../src/lib/kafkaProducer';
import { uuidv7 } from '../../src/lib/uuidv7';
import { isRateLimited } from '../../src/lib/rateLimiter';

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

// Fallback path: direct write to Supabase visitor_logs. Only invoked when
// the Kafka produce is skipped (not configured) or errors out — the
// aggregator consumer is normally the sole writer for this table.
async function fallbackSupabaseInsert(insertPayload) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, skipped: 'supabase-not-configured' };
  }
  try {
    const { error } = await supabaseServer.from('visitor_logs').insert([insertPayload]);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
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

  // 3. IP 速率限制 —— Valkey 共享存储；失联时降级为本进程内存限流并记日志
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = (forwarded.split(',')[0] || req.socket?.remoteAddress || '').trim();
  if (await isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const { localTime = new Date().toISOString() } = body;

  // Validate event against allowlist to prevent arbitrary string injection.
  const rawEventName = typeof body.event === 'string' ? body.event.trim() : '';
  const event = ALLOWED_EVENTS.has(rawEventName) ? rawEventName : 'page_view';

  // Geolocation -------------------------------------------------------------
  const geo = geoFromHeaders(req.headers);
  const { country, region, city, latitude, longitude, _src } = geo;

  const nowIso = new Date().toISOString();

  // RawEvent wire format expected by analytics-aggregator-service. The
  // eventId is a UUIDv7 used both as the Kafka dedup key AND as the
  // ON CONFLICT DO NOTHING key inside VisitorLogPersistService, so a
  // re-delivered batch never produces duplicate visitor_logs rows.
  const rawEvent = {
    eventId:    uuidv7(),
    siteId:     'yuqi.site',
    eventType:  event,
    eventTime:  localTime,
    serverTime: nowIso,
    sessionId:  body.sessionId || null,
    anonId:     body.anonId || null,
    pageUrl:    body.page || null,
    referrer:   body.referrer || null,
    uaRaw:      ua,
    ipRaw:      ip,
    geoHint: {
      country: country ?? null,
      region:  region  ?? null,
      city:    city    ?? null,
      lat:     latitude  ?? null,
      lng:     longitude ?? null,
      src:     _src,
    },
  };

  // Legacy insert payload only used on the fallback path.
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
    created_at: nowIso,
  };

  try {
    // ---- Primary path: Kafka ----
    // produceRawEvent returns true on success, false when Kafka is not
    // configured OR the produce failed (it never throws — the module
    // catches internally). false means "try the fallback".
    const kafkaOk = await produceRawEvent(rawEvent);
    if (kafkaOk) {
      return res.status(200).json({ ok: true, via: 'kafka' });
    }

    // ---- Fallback path: Supabase direct insert ----
    // Only runs when Kafka is missing/unreachable. Under normal load
    // Supabase sees zero writes from this endpoint.
    const fb = await fallbackSupabaseInsert(insertPayload);
    if (fb.ok) {
      return res.status(200).json({ ok: true, via: 'supabase-fallback' });
    }
    if (fb.skipped) {
      // Nothing to write to — surface an operational error so the
      // dashboard can alert on it, but do not 500 the browser.
      console.warn('[Track] Kafka unavailable and Supabase not configured');
      return res.status(200).json({ ok: true, skipped: fb.skipped });
    }

    console.error('[Track] both Kafka produce and Supabase insert failed:', fb.error);
    return res.status(500).json({ ok: false, message: 'ingest_failed' });
  } finally {
    console.log(`[Track] done in ${Date.now() - start}ms src=${_src}`);
  }
}
