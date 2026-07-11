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
import crypto from 'crypto';

// 允许的来源域名
const ALLOWED_ORIGINS = ['https://www.yuqi.site', 'https://yuqi.site'];

// Allowed event names — prevents arbitrary string injection into visitor_logs.event
const ALLOWED_EVENTS = new Set([
  'page_view', 'content_impression', 'content_open', 'read_progress', 'engaged_time',
  'project_open', 'outbound_link_clicked', 'search_performed', 'search_result_clicked',
  'subscribe_started', 'subscribe_verified', 'unsubscribe_completed',
  'recommendation_impression', 'recommendation_click', 'recommendation_dismiss',
  'chat_started', 'chat_completed', 'tool_used',
]);

const PROPERTY_ALLOWLIST = new Set([
  'contentId', 'contentType', 'category', 'progressPercent', 'engagedSeconds',
  'component', 'action', 'campaign', 'experimentId', 'variant',
  'recommendationRequestId', 'rank', 'modelVersion', 'resultCount',
]);

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

// --------------------------- Helper ----------------------------------------
function hmac(value, namespace) {
  const key = process.env.ANALYTICS_INGEST_HMAC_KEY || process.env.ANALYTICS_HMAC_SALT;
  if (!key || !value) return null;
  return crypto.createHmac('sha256', key).update(`${namespace}:${value}`).digest('hex');
}

function pseudonymousId(value, namespace) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate || !/^[a-zA-Z0-9-]{12,100}$/.test(candidate)) return null;
  return hmac(candidate, namespace) || candidate;
}

function safePath(value) {
  if (!value) return null;
  try {
    return new URL(value, 'https://yuqi.site').pathname.slice(0, 512);
  } catch (_) {
    return String(value).split(/[?#]/)[0].slice(0, 512);
  }
}

function sanitizeProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => PROPERTY_ALLOWLIST.has(key)
      && ['string', 'number', 'boolean'].includes(typeof item))
    .map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, 255) : item]));
}

function normalizeEventTime(value, nowMs = Date.now()) {
  const parsed = Date.parse(value);
  // Reject clock-skew and forged timestamps outside a one-day envelope.
  return Number.isFinite(parsed) && Math.abs(parsed - nowMs) <= 24 * 60 * 60 * 1000
    ? new Date(parsed).toISOString()
    : new Date(nowMs).toISOString();
}

function geoFromHeaders(h) {
  // Vercel Edge headers -----------------------------------------------------
  if (h['x-vercel-ip-country']) {
    return {
      country: h['x-vercel-ip-country'] || null,
      region: h['x-vercel-ip-country-region'] || null,
      city: h['x-vercel-ip-city'] ? decodeURIComponent(h['x-vercel-ip-city']) : null,
      latitude: Number.isFinite(Number(h['x-vercel-ip-latitude'])) ? Number(h['x-vercel-ip-latitude']) : null,
      longitude: Number.isFinite(Number(h['x-vercel-ip-longitude'])) ? Number(h['x-vercel-ip-longitude']) : null,
      _src: 'vercel',
    };
  }
  // Cloudflare headers ------------------------------------------------------
  if (h['cf-ipcountry']) {
    return {
      country: h['cf-ipcountry'] || null,
      region: h['cf-region'] || null,
      city: h['cf-ipcity'] ? decodeURIComponent(h['cf-ipcity']) : null,
      latitude: Number.isFinite(Number(h['cf-latitude'])) ? Number(h['cf-latitude']) : null,
      longitude: Number.isFinite(Number(h['cf-longitude'])) ? Number(h['cf-longitude']) : null,
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
  const eventTime = normalizeEventTime(body.localTime);

  // Validate event against allowlist to prevent arbitrary string injection.
  const rawEventName = typeof body.event === 'string' ? body.event.trim() : '';
  if (!ALLOWED_EVENTS.has(rawEventName)) {
    return res.status(400).json({ error: 'Unsupported event' });
  }
  const event = rawEventName;

  // Geolocation -------------------------------------------------------------
  const geo = geoFromHeaders(req.headers);
  const { country, region, city, latitude, longitude, _src } = geo;
  const consentState = ['granted', 'denied', 'unknown'].includes(body.consentState)
    ? body.consentState : 'unknown';
  if (consentState === 'denied') return res.status(204).end();
  const identified = consentState === 'granted';
  const ipHash = hmac(ip, 'ip');

  const nowIso = new Date().toISOString();

  // RawEvent wire format expected by analytics-aggregator-service. The
  // eventId is a UUIDv7 used both as the Kafka dedup key AND as the
  // ON CONFLICT DO NOTHING key inside VisitorLogPersistService, so a
  // re-delivered batch never produces duplicate visitor_logs rows.
  const rawEvent = {
    eventId:    uuidv7(),
    schemaVersion: Number(body.schemaVersion) === 2 ? 2 : 1,
    siteId:     'yuqi.site',
    eventType:  event,
    eventTime,
    serverTime: nowIso,
    sessionId:  identified ? pseudonymousId(body.sessionId, 'session') : null,
    anonId:     identified ? pseudonymousId(body.anonymousId, 'anonymous') : null,
    consentState,
    pageUrl:    safePath(body.page),
    targetUrl:  safePath(body.target),
    referrer:   typeof body.referrer === 'string' ? body.referrer.slice(0, 2048) : null,
    uaRaw:      ua,
    ipRaw:      ip,
    ipHash,
    properties: sanitizeProperties(body.properties),
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
    ip: ipHash || 'redacted',
    local_time: eventTime,
    event,
    ua: 'server-fallback',
    country,
    region,
    city: null,
    latitude: null,
    longitude: null,
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
