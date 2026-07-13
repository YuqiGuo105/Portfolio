import { supabase } from "../supabase/supabaseClient";

async function request(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Admin session is not available.");

  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Request failed: ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export const adminApi = {
  subscribers: {
    list({ status = "ALL", query = "", limit = 50, offset = 0 } = {}) {
      const params = new URLSearchParams({
        status,
        q: query,
        limit: String(limit),
        offset: String(offset),
      });
      return request(`/api/admin/subscribers?${params.toString()}`);
    },
    updateStatus(id, status) {
      return request(`/api/admin/subscribers/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
  },
  notifications: {
    list({ limit = 50, offset = 0 } = {}) {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      return request(`/api/admin/notifications?${params.toString()}`);
    },
  },
  conversations: {
    list({ query = "", hours = 168, limit = 50 } = {}) {
      const params = new URLSearchParams({
        q: query,
        hours: String(hours),
        limit: String(limit),
      });
      return request(`/api/admin/chat-conversations?${params.toString()}`);
    },
  },
};
