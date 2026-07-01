/**
 * Server-side proxy → portfolio-agent-service (Cloud Run).
 *
 * Why proxy?
 *  - Browser never sees the agent URL directly → simpler CORS story
 *  - Supabase auth happens here, then derived role/email is forwarded
 *  - One central place to swap the agent backend
 *
 * Env required:
 *   AGENT_SERVICE_URL                   e.g. https://portfolio-agent-service-xxxx-uc.a.run.app
 *   NEXT_PUBLIC_SUPABASE_URL            (already used elsewhere)
 *   SUPABASE_SERVICE_ROLE_KEY           (already used by /api/admin/publish-event)
 *   ADMIN_ALLOWED_EMAILS                (already used) — admins → role ADMIN
 *
 * Optional:
 *   AGENT_SERVICE_INTERNAL_TOKEN        if set, forwarded as Authorization: Bearer
 *                                       (matching agent.internal-token in agent service)
 */

import { createClient } from "@supabase/supabase-js";

// Initialize lazily to avoid throwing at import time during build.
let _supabaseAdmin = null;
function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabaseAdmin = createClient(url, key);
  return _supabaseAdmin;
}

function getAgentBase() {
  const base = process.env.AGENT_SERVICE_URL;
  if (!base) return null;
  return base.replace(/\/+$/, "");
}

function getAllowedAdminEmails() {
  const raw =
    process.env.ADMIN_ALLOWED_EMAILS ||
    process.env.NEXT_PUBLIC_ADMIN_EMAIL ||
    "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validate the request's Supabase session. Returns `{ email, roles }` on
 * success, or writes an error response and returns null on failure.
 *
 * `roles` is a comma-separated string matching what the agent service expects
 * in IntentRequest.userRoles. Mapping:
 *   - signed-in user             → "VIEWER"
 *   - signed-in admin email      → "VIEWER,EDITOR,PUBLISHER,ADMIN"
 *
 * If `allowAnonymous: true` is set, missing/invalid sessions resolve to a
 * synthetic anonymous identity with VIEWER role. Use this for read-only chat.
 */
export async function requireSupabaseUser(req, res, { allowAnonymous = false } = {}) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  // Anonymous path (regular Q&A chat — no admin powers granted)
  if (!token) {
    if (allowAnonymous) {
      return { email: null, roles: "VIEWER", anonymous: true };
    }
    res.status(401).json({ error: "unauthenticated", message: "No Supabase session." });
    return null;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(500).json({
      error: "config_missing",
      message: "SUPABASE_SERVICE_ROLE_KEY not configured on this deployment.",
    });
    return null;
  }

  let user;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) throw error || new Error("No user returned");
    user = data.user;
  } catch (err) {
    res.status(401).json({ error: "invalid_session", message: "Supabase session invalid." });
    return null;
  }

  const email = (user.email || "").toLowerCase();
  const isAdmin = getAllowedAdminEmails().includes(email);
  const roles = isAdmin ? "VIEWER,EDITOR,PUBLISHER,ADMIN" : "VIEWER";
  return { email, roles, anonymous: false };
}

/**
 * Forward a JSON request to the agent service. Used for sync endpoints like
 * /api/intent and /api/intent/confirm.
 */
export async function forwardJson(req, res, { path, method = "POST", auth }) {
  const base = getAgentBase();
  if (!base) {
    res.status(500).json({
      error: "config_missing",
      message: "AGENT_SERVICE_URL is not set on this deployment.",
    });
    return;
  }

  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : JSON.stringify({
          ...(req.body || {}),
          userEmail: auth.email,
          userRoles: auth.roles,
        });

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const internal = process.env.AGENT_SERVICE_INTERNAL_TOKEN;
  if (!internal) {
    // Fail-closed: the agent's SupabaseJwtAuthFilter now rejects every
    // /api/intent request that doesn't carry either a valid Supabase JWT
    // or the shared internal token. Missing this env in prod means the
    // proxy would 401 every user, so surface the misconfig loudly here.
    res.status(500).json({
      error: "config_missing",
      message: "AGENT_SERVICE_INTERNAL_TOKEN is not set. Configure it to match agent.auth.internal-token.",
    });
    return;
  }
  headers["Authorization"] = `Bearer ${internal}`;

  let upstream;
  try {
    upstream = await fetch(`${base}${path}`, { method, headers, body });
  } catch (err) {
    res.status(502).json({ error: "upstream_unreachable", message: err.message });
    return;
  }

  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.send(text);
}

/**
 * Forward a chat request to the agent service and stream the SSE response back
 * to the browser. The upstream is `POST {AGENT_SERVICE_URL}/api/chat` which
 * returns text/event-stream.
 */
export async function forwardSse(req, res, { auth }) {
  const base = getAgentBase();
  if (!base) {
    res.status(500).json({ error: "config_missing", message: "AGENT_SERVICE_URL not set." });
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const internal = process.env.AGENT_SERVICE_INTERNAL_TOKEN;
  if (!internal) {
    // See forwardJson for rationale — the agent filter is fail-closed and
    // will 401 anything without a bearer.
    res.status(500).json({
      error: "config_missing",
      message: "AGENT_SERVICE_INTERNAL_TOKEN is not set. Configure it to match agent.auth.internal-token.",
    });
    return;
  }
  headers["Authorization"] = `Bearer ${internal}`;

  // ChatRequest schema on the agent side requires `messages: [{role, content}]`
  // (not `utterance` like IntentRequest), and does NOT accept userRoles. So
  // map whatever the widget sends into the agent's expected shape.
  const inBody = req.body || {};
  const incomingMessages = Array.isArray(inBody.messages) ? inBody.messages : null;
  const messages =
    incomingMessages && incomingMessages.length > 0
      ? incomingMessages
      : [
          {
            role: "user",
            content: String(inBody.utterance || inBody.content || "").trim(),
          },
        ];

  const upstreamBody = JSON.stringify({
    sessionId: inBody.sessionId,
    userEmail: auth.email,
    // Send server-derived roles so the agent's PolicyGuard sees the same
    // identity the proxy authenticated. The agent's INTERNAL_PROXY path
    // trusts this field because it can only be reached with the shared
    // internal token.
    userRoles: auth.roles,
    messages,
    ...(inBody.pageContext ? { pageContext: inBody.pageContext } : {}),
  });

  let upstream;
  try {
    upstream = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers,
      body: upstreamBody,
    });
  } catch (err) {
    res.status(502).json({ error: "upstream_unreachable", message: err.message });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text().catch(() => "");
    res.status(upstream.status || 502);
    res.setHeader("Content-Type", "application/json");
    res.send(
      JSON.stringify({
        error: "agent_error",
        status: upstream.status,
        body: errBody,
      })
    );
    return;
  }

  // Stream the upstream SSE bytes straight through.
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disables Nginx buffering on Vercel

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  req.on("close", () => {
    try { reader.cancel(); } catch {}
  });

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) {
        res.write(decoder.decode(value, { stream: true }));
      }
    }
  } catch (err) {
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
    } catch {}
  } finally {
    res.end();
  }
}

export function methodGuard(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader("Allow", allowed.join(", "));
    res.status(405).json({ error: "method_not_allowed" });
    return false;
  }
  return true;
}
