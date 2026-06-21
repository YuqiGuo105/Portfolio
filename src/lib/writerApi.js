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

function makeResource(basePath) {
  return {
    list: (page = 0, size = 20) =>
      request('GET', `${basePath}?page=${page}&size=${size}&sort=createdAt,desc`),
    get: (id) => request('GET', `${basePath}/${id}`),
    create: (data, idempotencyKey) =>
      request('POST', basePath, data, idempotencyKey),
    update: (id, data) =>
      request('PUT', `${basePath}/${id}`, data),
    delete: (id, version) =>
      request('DELETE', `${basePath}/${id}`, { _expectedVersion: version }),
  };
}

export const writerApi = {
  blogs: makeResource('/api/admin/blogs'),
  lifeBlogs: makeResource('/api/admin/life-blogs'),
  projects: makeResource('/api/admin/projects'),

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

/**
 * Probe the admin API with the current Supabase session to verify the
 * caller is authorized. Returns true on 2xx, false otherwise.
 */
export async function validateAdminSession() {
  try {
    await request('GET', '/api/admin/blogs?page=0&size=1');
    return true;
  } catch {
    return false;
  }
}

// Deprecated alias kept temporarily for any leftover importer. The new
// admin login page no longer calls it.
export const validateAdminToken = validateAdminSession;
