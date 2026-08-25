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
import { forward, methodGuard } from "../../../src/lib/notificationServiceProxy";
import { requireAdminUser } from "../../../src/lib/agentServiceProxy";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;

  const auth = await requireAdminUser(req, res);
  if (!auth) return;

  // Forward only after the shared Supabase + admin-role guard succeeds.
  await forward(req, res, { path: "/api/content-events", method: "POST" });
}
