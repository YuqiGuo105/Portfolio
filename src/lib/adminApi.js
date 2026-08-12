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

async function download(path) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Admin session is not available.");

  const response = await fetch(path, {
    headers: {
      Accept: "text/csv, application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Download failed: ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return {
    blob: await response.blob(),
    filename: attachmentFilename(response.headers.get("content-disposition")),
    truncated: response.headers.get("x-export-truncated") === "true",
  };
}

function visitorParams({ query = "", hours = 24, page, size, format, ...filters } = {}) {
  const params = new URLSearchParams({
    q: query,
    hours: String(hours),
  });
  if (page != null) params.set("page", String(page));
  if (size != null) params.set("size", String(size));
  if (format) params.set("format", format);
  for (const [key, value] of Object.entries(filters)) {
    if (value != null && String(value).trim()) params.set(key, String(value).trim());
  }
  return params;
}

function attachmentFilename(value) {
  const encoded = String(value || "").match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return String(value || "").match(/filename="?([^";]+)"?/i)?.[1] || "";
}

export const adminApi = {
  stories: {
    list() {
      return request("/api/admin/stories");
    },
    prepareUpload(payload) {
      return request("/api/admin/stories", { method: "POST", body: JSON.stringify({ operation: "prepare-upload", ...payload }) });
    },
    finalize(payload) {
      return request("/api/admin/stories", { method: "POST", body: JSON.stringify({ operation: "finalize", ...payload }) });
    },
    remove(id) {
      return request(`/api/admin/stories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  },
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
  costGuardrail: {
    snapshot() {
      return request("/api/admin/cost-guardrail");
    },
  },
  visitors: {
    list({ query = "", hours = 24, page = 0, size = 50, ...filters } = {}) {
      const params = visitorParams({ query, hours, page, size, ...filters });
      return request(`/api/admin/visitors?${params.toString()}`);
    },
    download({ format, ...query } = {}) {
      if (!["csv", "json"].includes(format)) throw new Error("Export format must be csv or json.");
      const params = visitorParams({ ...query, format });
      return download(`/api/admin/visitors?${params.toString()}`);
    },
  },
  visitorIntelligence: {
    overview({ query = "", hours = 24, ...filters } = {}) {
      const params = new URLSearchParams({
        q: query,
        hours: String(hours),
      });
      for (const [key, value] of Object.entries(filters)) {
        if (value != null && String(value).trim()) params.set(key, String(value).trim());
      }
      return request(`/api/admin/visitor-intelligence?${params.toString()}`);
    },
  },
  visitorAlerts: {
    overview({ hours = 24 } = {}) {
      const params = new URLSearchParams({ hours: String(hours) });
      return request(`/api/admin/visitor-alerts?${params.toString()}`);
    },
    prepareChange({ ruleId, patch, reason }) {
      return request("/api/admin/visitor-alerts", {
        method: "POST",
        body: JSON.stringify({ operation: "prepare", ruleId, patch, reason }),
      });
    },
    applyChange(changeId) {
      return request("/api/admin/visitor-alerts", {
        method: "POST",
        body: JSON.stringify({ operation: "apply", changeId }),
      });
    },
  },
};
