// src/lib/writerApi.js
// HTTP client for the Writer API Service (admin-service / Cloud Run).
//
// Auth model: this client sends `Authorization: Bearer <Supabase JWT>` —
// pulled live from the Supabase session — so every request uses the same
// identity that the user logged in with at Portfolio. The admin-service
// validates the JWT signature + the email allow-list (ADMIN_ALLOWED_EMAILS).
//
// The legacy `X-Admin-Secret` flow (`sessionStorage.admin_token`) is no
// longer used by the browser. That header remains supported server-to-server
// in the admin-service for internal scripts / CI only.

import { supabase } from '../supabase/supabaseClient';

const BASE =
  process.env.NEXT_PUBLIC_WRITER_API_URL || 'http://localhost:8081';

/**
 * Returns the live Supabase access token, or '' if no session.
 * Always fetched fresh so we pick up the latest token after refresh.
 */
async function getAuthToken() {
  if (typeof window === 'undefined') return '';
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || '';
  } catch {
    return '';
  }
}

async function request(method, path, body, idempotencyKey) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  if (body && body._expectedVersion !== undefined) {
    headers['X-Expected-Version'] = String(body._expectedVersion);
    const { _expectedVersion, ...rest } = body;
    body = rest;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = new Error(err.message || `Request failed: ${res.status}`);
    error.status = res.status;
    // admin-service returns { error: 'missing_credentials' | 'invalid_token'
    // | 'forbidden_email' | ... }. Expose that to callers so they can react.
    error.code = err.error || null;
    error.body = err;
    throw error;
  }

  return res.status === 204 ? null : res.json();
}

function normalizeContentMutation(type, input = {}) {
  const { status, visibility, slug, _expectedVersion, ...data } = input;
  const normalized = {
    ...data,
    summary: input.description ?? input.summary ?? "",
  };
  if (type === "PROJECT") {
    normalized.externalUrl = input.url || input.externalUrl || "";
  }
  return {
    data: normalized,
    publish: status === "PUBLISHED",
    changeNote: status === "PUBLISHED" ? "Published from admin console" : "Updated from admin console",
  };
}

function flattenContentDetail(response) {
  const content = response?.content && typeof response.content === 'object'
    ? response.content
    : (response || {});
  const raw = content.raw || {};
  const tags = Array.isArray(content.tags) ? content.tags.join(", ") : (content.tags || raw.tags || "");
  return {
    ...raw,
    id: content.sourceId,
    sourceId: content.sourceId,
    sourceType: content.sourceType,
    title: content.title || "",
    description: content.summary || "",
    content: content.content || "",
    category: content.category || "",
    tags,
    imageUrl: content.imageUrl || raw.image_url || "",
    url: raw.URL || content.externalUrl || content.url || "",
    date: raw.date || "",
    requireLogin: Boolean(raw.require_login),
    publishedAt: raw.published_at || "",
    technology: raw.technology || tags,
    year: raw.year || "",
    num: raw.num ?? "",
    status: response?.latestVersion ? "PUBLISHED" : "DRAFT",
    visibility: "PUBLIC",
    version: response?.latestVersion?.version || 0,
  };
}

function makeContentResource(type) {
  return {
    list: ({ limit = 200, offset = 0, keyword, category } = {}) => {
      const params = new URLSearchParams({ type, limit: String(limit), offset: String(offset) });
      if (keyword) params.set('keyword', keyword);
      if (category) params.set('category', category);
      return request('GET', `/api/admin/content?${params.toString()}`);
    },
    get: async (id) => flattenContentDetail(
      await request('GET', `/api/admin/content/${type}/${encodeURIComponent(id)}`)
    ),
    create: (data, idempotencyKey) =>
      request('POST', `/api/admin/content/${type}`, normalizeContentMutation(type, data), idempotencyKey),
    update: async (id, data) => flattenContentDetail(
      await request('PUT', `/api/admin/content/${type}/${encodeURIComponent(id)}`,
        normalizeContentMutation(type, data))
    ),
    publish: (id, changeNote) => request(
      'POST',
      `/api/admin/content/${type}/${encodeURIComponent(id)}/publish`,
      { changeNote }
    ),
  };
}

export const writerApi = {
  blogs: makeContentResource('BLOG'),
  lifeBlogs: makeContentResource('LIFE_BLOG'),
  projects: makeContentResource('PROJECT'),

  // Admin-service exposes a single content endpoint keyed by sourceType.
  // Use this for dashboard counts and for any new code that doesn't need the
  // legacy per-type Spring Page shape.
  content: {
    /** GET /api/admin/content?type=BLOG|LIFE_BLOG|PROJECT|EXPERIENCE
     *  Returns { items: ContentListItemDto[] }. */
    list: (type, { limit = 200, offset = 0, keyword, category } = {}) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (type) params.set('type', type);
      if (keyword) params.set('keyword', keyword);
      if (category) params.set('category', category);
      return request('GET', `/api/admin/content?${params.toString()}`);
    },
  },
};

/** Probe the admin API; authorization remains owned by the admin service. */
export async function verifyAdminSession() {
  try {
    await request('GET', '/api/admin/content?type=BLOG&limit=1&offset=0');
    return { authorized: true, status: 200, code: null };
  } catch (error) {
    return {
      authorized: false,
      status: Number(error?.status) || 0,
      code: error?.code || (error?.status ? 'admin_api_error' : 'admin_api_unavailable'),
    };
  }
}

/** Backwards-compatible boolean helper for existing callers. */
export async function validateAdminSession() {
  const result = await verifyAdminSession();
  return result.authorized;
}

// Deprecated alias kept temporarily for any leftover importer. The new
// admin login page no longer calls it.
export const validateAdminToken = validateAdminSession;
