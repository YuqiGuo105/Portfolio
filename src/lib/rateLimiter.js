// src/lib/rateLimiter.js
// -----------------------------------------------------------------------------
// Shared-storage rate limiter backed by Valkey (Redis wire-compatible).
//
// Why not an in-process Map? Because Vercel scales /api/track horizontally —
// a single scraper hits N different lambdas and each keeps its own private
// counter. Once Valkey is in the mix, INCR is atomic across every lambda AND
// every replica of every downstream service that happens to share the cache,
// so the limit becomes truly per-IP instead of per-lambda-per-IP.
//
// Fail-open: if Valkey is briefly unreachable we fall back to the old
// in-process Map and log a warning. Locking out real visitors because Valkey
// is having a bad minute is worse than the brief window where a scraper
// could slip through.
// -----------------------------------------------------------------------------
import { createClient } from 'redis';

const RATE_LIMIT = Number(process.env.TRACK_RATE_LIMIT || 10);
const RATE_WINDOW_MS = Number(process.env.TRACK_RATE_WINDOW_MS || 60_000);

// In-memory fallback used when Valkey is down. Keyed the same way as the
// Redis key so behavior is identical when we degrade.
const memoryFallback = new Map(); // key -> { count, resetAt }

// Cache the client on the module-global so warm Vercel lambdas reuse the
// TCP connection instead of dial-on-every-request. We store a promise so
// concurrent first-callers await the same connect().
let clientPromise = null;

function getValkeyUrl() {
  return (
    process.env.VALKEY_URL ||
    process.env.REDIS_URL ||
    process.env.KV_URL ||
    ''
  );
}

async function getClient() {
  const url = getValkeyUrl();
  if (!url) return null; // never configured — always use fallback
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const client = createClient({
      url,
      // Short socket timeout — we'd rather fail fast into the fallback
      // than block the analytics beacon for seconds.
      socket: { connectTimeout: 1500, reconnectStrategy: false },
    });
    // node-redis v4 throws on error listener absence.
    client.on('error', err => {
      console.warn('[rateLimiter] valkey client error:', err && err.message);
    });
    try {
      await client.connect();
      return client;
    } catch (err) {
      console.warn('[rateLimiter] valkey connect failed, falling back:', err && err.message);
      clientPromise = null; // let a future request retry
      return null;
    }
  })();
  return clientPromise;
}

/**
 * Returns true when the caller has exceeded {@link RATE_LIMIT} requests
 * inside the current {@link RATE_WINDOW_MS} window. Callers should treat
 * `true` as "reject this request with 429".
 *
 * @param {string} ip Client IP already extracted from x-forwarded-for.
 * @param {string} [scope] Optional bucket suffix (e.g. "track") to keep
 *   different endpoints from cannibalising each other's budget when they
 *   share the same Valkey.
 * @returns {Promise<boolean>}
 */
export async function isRateLimited(ip, scope = 'track', options = {}) {
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Number(options.limit))
    : RATE_LIMIT;
  const windowMs = Number.isFinite(Number(options.windowMs))
    ? Math.max(1_000, Number(options.windowMs))
    : RATE_WINDOW_MS;
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `rl:${scope}:${ip}:${bucket}`;

  const client = await getClient();
  if (client) {
    try {
      const count = await client.incr(key);
      if (count === 1) {
        // First hit in this window — arm TTL so the counter self-cleans.
        // Add a small grace so requests landing on the boundary don't lose
        // their counter mid-window.
        await client.expire(key, windowSec + 5);
      }
      return count > limit;
    } catch (err) {
      console.warn('[rateLimiter] valkey op failed, falling back:', err && err.message);
      // fall through to in-memory
    }
  }

  // ── In-process fallback ────────────────────────────────────────────
  const now = Date.now();
  const entry = memoryFallback.get(key);
  if (!entry || now > entry.resetAt) {
    memoryFallback.set(key, { count: 1, resetAt: now + windowMs });
    // Best-effort GC: prune anything stale that isn't the current bucket.
    if (memoryFallback.size > 5000) {
      for (const [k, v] of memoryFallback) {
        if (v.resetAt <= now) memoryFallback.delete(k);
      }
    }
    return false;
  }
  if (entry.count >= limit) return true;
  entry.count += 1;
  return false;
}
