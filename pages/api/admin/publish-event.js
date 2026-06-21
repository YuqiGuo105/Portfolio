/**
 * POST /api/admin/publish-event
 *
 * Admin-only Next.js API route that fires a content-event notification to all
 * matching subscribers. Intended to be called by the Portfolio admin panel
 * (ContentEditor) immediately after publishing a new article, feature, or job update.
 *
 * Security layers:
 *   1. Supabase session check (server-side) — only authenticated Supabase users
 *      whose email is in ADMIN_ALLOWED_EMAILS can reach the Spring service.
 *   2. X-Internal-Token injected by notificationServiceProxy — the Spring service
 *      rejects any request that doesn't carry the shared secret, so even if this
 *      route were bypassed the downstream call would still fail.
 *
 * Request body (all fields forwarded to Spring POST /api/content-events):
 * {
 *   "eventType": "ARTICLE_PUBLISHED" | "ARTICLE_UPDATED" | "FEATURE_RELEASED" | "JOB_POSITION_UPDATED",
 *   "topic":     "ARTICLE_UPDATES"   | "FEATURE_UPDATES" | "JOB_UPDATES",
 *   "title":     string (required),
 *   "summary":   string (optional),
 *   "url":       string (optional, absolute URL),
 *   "sourceType": string (optional, inferred from eventType if omitted),
 *   "sourceId":  string (optional, slug/id),
 *   "idempotencyKey": string (optional, generated UUID if omitted)
 * }
 */
import { createClient } from "@supabase/supabase-js";
import { forward, methodGuard } from "../../../src/lib/notificationServiceProxy";

// Supabase admin client (service role) — used server-side only to validate sessions.
// Never expose this key to the browser.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** Emails allowed to call this route. Falls back to NEXT_PUBLIC_ADMIN_EMAIL if set. */
function getAllowedEmails() {
  const raw = process.env.ADMIN_ALLOWED_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "";
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  // ── 1. Supabase auth check ────────────────────────────────────────────────
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "unauthenticated", message: "No Supabase session token." });
  }

  let user;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) throw error || new Error("No user returned");
    user = data.user;
  } catch (err) {
    return res.status(401).json({ error: "invalid_session", message: "Supabase session invalid or expired." });
  }

  const allowedEmails = getAllowedEmails();
  if (allowedEmails.length > 0 && !allowedEmails.includes(user.email)) {
    return res.status(403).json({ error: "access_denied", message: "Your account is not authorised." });
  }

  // ── 2. Forward to Spring POST /api/content-events (injects X-Internal-Token) ─
  await forward(req, res, { path: "/api/content-events", method: "POST" });
}
