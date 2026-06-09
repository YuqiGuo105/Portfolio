// src/lib/writerApi.js
// HTTP client for the Writer API Service.
// Adds Authorization: Bearer <token>, Idempotency-Key, and X-Expected-Version headers.

const BASE =
  process.env.NEXT_PUBLIC_WRITER_API_URL || 'http://localhost:8081';

function getToken() {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('admin_token') || '';
}

async function request(method, path, body, idempotencyKey) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  };
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
};

export function validateAdminToken(token) {
  // Probe the API with the given token to verify it is valid.
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  return fetch(`${BASE}/api/admin/blogs?page=0&size=1`, { headers }).then(
    (res) => res.ok
  );
}
