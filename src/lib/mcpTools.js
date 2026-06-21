// src/lib/mcpTools.js
// MCP tool catalog (declarative spec). The actual MCP execution will live in
// a separate chat-agent backend project; this file is just the contract that
// the Portfolio frontend and the future agent will both reference.
//
// Conventions:
//   - Each tool has `name`, `mode` ("read" | "write"), `description`,
//     a JSON-schema-ish `parameters` map, and an `endpoint` descriptor that
//     tells the agent which HTTP target to call.
//   - `endpoint.method`         — HTTP verb
//   - `endpoint.path`           — Path template (`{var}` markers map 1:1 to
//                                 a parameter name). Tokens are substituted
//                                 by the agent at call time.
//   - `endpoint.target`         — Logical target service:
//        * `notification-proxy` — Next.js `/api/(subscriptions|notifications|
//          health)/*` routes that the Portfolio already exposes. The proxy
//          injects `X-Internal-Token` server-side so the browser/agent never
//          handles the shared secret.
//        * `admin-proxy`        — Next.js `/api/admin/publish-event` route
//          that does Supabase session check + forwards to Spring.
//        * `admin-service`      — Direct call to portfolio-admin-service
//          (`NEXT_PUBLIC_WRITER_API_URL`); requires `Authorization: Bearer
//          <Supabase JWT>`.
//   - `endpoint.query` / `endpoint.body` — Which parameters go where.
//
// Read tools may be invoked without a Supabase session. Write tools require
// the caller (chat agent) to attach a valid Supabase JWT for the signed-in
// user; the Portfolio admin-service then validates the email allow-list.

export const MCP_TOOLS = {
  // ── Health / read ──────────────────────────────────────────────────────
  'health.notification': {
    name: 'health.notification',
    mode: 'read',
    description: 'Composite health of the notification service (DB + Kafka).',
    parameters: {},
    endpoint: {
      target: 'notification-proxy',
      method: 'GET',
      path: '/api/health/notification',
    },
  },

  // ── Notifications ───────────────────────────────────────────────────────
  'notification.list': {
    name: 'notification.list',
    mode: 'read',
    description: 'List notifications for a subscriber (filtered by email).',
    parameters: {
      email: { type: 'string', required: true, source: 'session.email' },
      unreadOnly: { type: 'boolean', required: false, default: false },
      limit: { type: 'integer', required: false, default: 20 },
    },
    endpoint: {
      target: 'notification-proxy',
      method: 'GET',
      path: '/api/notifications',
      query: ['email', 'unreadOnly', 'limit'],
    },
  },
  'notification.markRead': {
    name: 'notification.markRead',
    mode: 'write',
    description: 'Mark a single notification as read.',
    parameters: {
      id: { type: 'string', required: true },
    },
    endpoint: {
      target: 'notification-proxy',
      method: 'PATCH',
      path: '/api/notifications/{id}/read',
    },
  },

  // ── Subscriptions ───────────────────────────────────────────────────────
  'subscription.create': {
    name: 'subscription.create',
    mode: 'write',
    description: 'Subscribe an email to one or more topics.',
    parameters: {
      email: { type: 'string', required: true },
      topics: { type: 'string[]', required: true },
    },
    endpoint: {
      target: 'notification-proxy',
      method: 'POST',
      path: '/api/subscriptions',
      body: ['email', 'topics'],
    },
  },
  'subscription.update': {
    name: 'subscription.update',
    mode: 'write',
    description: 'Update notification preferences for an email.',
    parameters: {
      email: { type: 'string', required: true },
      topics: { type: 'string[]', required: false },
      enabled: { type: 'boolean', required: false },
    },
    endpoint: {
      target: 'notification-proxy',
      method: 'PATCH',
      path: '/api/subscriptions/preferences',
      body: ['email', 'topics', 'enabled'],
    },
  },
  'subscription.unsubscribe': {
    name: 'subscription.unsubscribe',
    mode: 'write',
    description: 'Unsubscribe an email from notifications.',
    parameters: {
      email: { type: 'string', required: true },
      token: { type: 'string', required: false },
    },
    endpoint: {
      target: 'notification-proxy',
      method: 'POST',
      path: '/api/subscriptions/unsubscribe',
      body: ['email', 'token'],
    },
  },

  // ── Content (admin-service, JWT-gated) ──────────────────────────────────
  'content.list': {
    name: 'content.list',
    mode: 'write',
    description: 'List admin content for a source type (blogs | life-blogs | projects).',
    parameters: {
      source: { type: 'string', required: true, enum: ['blogs', 'life-blogs', 'projects'] },
      page: { type: 'integer', required: false, default: 0 },
      size: { type: 'integer', required: false, default: 10 },
    },
    endpoint: {
      target: 'admin-service',
      method: 'GET',
      path: '/api/admin/{source}',
      query: ['page', 'size'],
    },
  },
  'content.get': {
    name: 'content.get',
    mode: 'write',
    description: 'Fetch a single content item by id.',
    parameters: {
      source: { type: 'string', required: true, enum: ['blogs', 'life-blogs', 'projects'] },
      id: { type: 'string', required: true },
    },
    endpoint: {
      target: 'admin-service',
      method: 'GET',
      path: '/api/admin/{source}/{id}',
    },
  },
  'content.publish': {
    name: 'content.publish',
    mode: 'write',
    description: 'Publish or re-publish a content item (emits a notification event).',
    parameters: {
      eventType: { type: 'string', required: true,
        enum: ['ARTICLE_PUBLISHED', 'ARTICLE_UPDATED', 'FEATURE_RELEASED', 'JOB_POSITION_UPDATED'] },
      topic: { type: 'string', required: true,
        enum: ['ARTICLE_UPDATES', 'FEATURE_UPDATES', 'JOB_UPDATES'] },
      title: { type: 'string', required: true },
      summary: { type: 'string', required: false },
      url: { type: 'string', required: false },
      sourceType: { type: 'string', required: false },
      sourceId: { type: 'string', required: false },
      idempotencyKey: { type: 'string', required: false },
    },
    endpoint: {
      target: 'admin-proxy',
      method: 'POST',
      path: '/api/admin/publish-event',
      body: ['eventType', 'topic', 'title', 'summary', 'url', 'sourceType', 'sourceId', 'idempotencyKey'],
    },
  },
  'content.reindex': {
    name: 'content.reindex',
    mode: 'write',
    description: 'Force a RAG or Search re-index for a content item.',
    parameters: {
      sourceType: { type: 'string', required: true },
      sourceId: { type: 'string', required: true },
      target: { type: 'string', required: false, enum: ['rag', 'search'], default: 'rag' },
    },
    endpoint: {
      target: 'admin-service',
      method: 'POST',
      // The agent should substitute `reindex-{target}` (rag | search).
      path: '/api/admin/content/{sourceType}/{sourceId}/reindex-{target}',
    },
  },

  // ── Jobs / outbox ───────────────────────────────────────────────────────
  'job.list': {
    name: 'job.list',
    mode: 'write',
    description: 'List indexing jobs (optionally filtered by status / type).',
    parameters: {
      status: { type: 'string', required: false,
        enum: ['PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'SKIPPED'] },
      jobType: { type: 'string', required: false,
        enum: ['RAG_INDEX', 'SEARCH_INDEX'] },
    },
    endpoint: {
      target: 'admin-service',
      method: 'GET',
      path: '/api/admin/indexing-jobs',
      query: ['status', 'jobType'],
    },
  },
  'job.retry': {
    name: 'job.retry',
    mode: 'write',
    description: 'Retry a FAILED / SKIPPED indexing job by id.',
    parameters: {
      jobId: { type: 'string', required: true },
    },
    endpoint: {
      target: 'admin-service',
      method: 'POST',
      path: '/api/admin/indexing-jobs/{jobId}/retry',
    },
  },
  'outbox.list': {
    name: 'outbox.list',
    mode: 'write',
    description: 'Inspect the content event outbox.',
    parameters: {},
    endpoint: {
      target: 'admin-service',
      method: 'GET',
      path: '/api/admin/outbox-events',
    },
  },
};

/**
 * Returns `true` if the named tool needs an authenticated Supabase session.
 * Used by ChatWidget to decide whether to pop the LogInDialog. Pure metadata —
 * no network calls.
 */
export function toolRequiresAuth(name) {
  const t = MCP_TOOLS[name];
  return !!t && t.mode === 'write';
}

/**
 * Lightweight natural-language intent classifier. Returns the tool name when
 * the user's message is clearly asking for a tool, or `null` otherwise.
 * Intentionally conservative so it doesn't hijack normal chat questions —
 * the future chat-agent backend will replace this with an LLM-driven router.
 */
export function classifyMcpIntent(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();
  if (/\b(health|status).*(notification|service)\b/.test(t)) return 'health.notification';
  if (/\bmark.*notification.*read\b/.test(t)) return 'notification.markRead';
  if (/\b(list|show).*notifications?\b/.test(t)) return 'notification.list';
  if (/\bunsubscribe\b/.test(t)) return 'subscription.unsubscribe';
  if (/\bsubscribe\b/.test(t)) return 'subscription.create';
  if (/\b(list|show).*(failed|indexing).*jobs?\b/.test(t)) return 'job.list';
  if (/\bretry.*job\b/.test(t)) return 'job.retry';
  if (/\b(list|show).*outbox\b/.test(t)) return 'outbox.list';
  if (/\b(publish|push).*(blog|article|post)\b/.test(t)) return 'content.publish';
  if (/\breindex\b/.test(t)) return 'content.reindex';
  if (/\b(list|show).*(blogs?|projects?|life\s+blogs?)\b/.test(t)) return 'content.list';
  return null;
}
