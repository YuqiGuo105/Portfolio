import { supabaseServer } from '../../src/supabase/supabaseServer';

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

// Helper to check if IP is private (local or LAN)
const isPrivate = (ip) =>
  ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.');

// Extract geo info from known headers (Vercel, Cloudflare)
async function geoFromHeaders(headers) {
  if (headers['x-vercel-ip-country']) {
    return {
      country: headers['x-vercel-ip-country'] || null,
      region: headers['x-vercel-ip-country-region'] || null,
      city: headers['x-vercel-ip-city'] || null,
      latitude: headers['x-vercel-ip-latitude'] || null,
      longitude: headers['x-vercel-ip-longitude'] || null,
      _src: 'vercel',
    };
  }

  if (headers['cf-ipcountry']) {
    return {
      country: headers['cf-ipcountry'] || null,
      region: headers['cf-region'] || null,
      city: headers['cf-ipcity'] || null,
      latitude: headers['cf-latitude'] || null,
      longitude: headers['cf-longitude'] || null,
      _src: 'cloudflare',
    };
  }

  return null;
}

// Fallback geo lookup using ipinfo.io
async function geoFromIpinfo(ip) {
  const token = process.env.IPINFO_TOKEN;
  if (!token) return null;

  try {
    const response = await fetch(`https://ipinfo.io/${ip}?token=${token}`, { timeout: 1500 });
    if (!response.ok) return null;

    const data = await response.json();
    const [lat, lon] = (data.loc || '').split(',');

    return {
      country: data.country || null,
      region: data.region || null,
      city: data.city || null,
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

  // Parse request body safely
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  // Extract and validate fields
  let clickEvent = body.clickEvent;
  if (typeof clickEvent !== 'string' || !clickEvent.trim()) {
    clickEvent = 'click'; // Default fallback
  }

  const targetUrl = body.targetUrl ?? null;
  const localTime = body.localTime ?? new Date().toISOString();

  // ip and ua already extracted above for rate limiting / bot filtering

  // Extract Geo info
  let geo = (await geoFromHeaders(req.headers)) || {};
  if (!Object.keys(geo).length && !isPrivate(ip)) {
    geo = (await geoFromIpinfo(ip)) || {};
  }

  // Final payload for insertion
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
    created_at: new Date().toISOString(),
  };

  // Insert into Supabase
  try {
    const { error } = await supabaseServer.from('visitor_clicks').insert([insertPayload]);
    if (error) throw error;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Click] insert error:', err);
    res.status(500).json({ ok: false, message: err.message, db: err.code });
  } finally {
    const ms = Date.now() - start;
    console.log(`[Click] done in ${ms}ms  src=${geo._src || 'none'}`);
  }
}
