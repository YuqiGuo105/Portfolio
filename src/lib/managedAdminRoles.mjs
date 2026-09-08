const ROLE_HIERARCHY = Object.freeze({
  ADMIN: "EDITOR,PUBLISHER,ADMIN",
  PUBLISHER: "EDITOR,PUBLISHER",
  EDITOR: "EDITOR",
});

export async function resolveManagedAdminRoles(token, { baseUrl, fetchImpl = fetch } = {}) {
  if (!baseUrl || !token) throw new Error("Admin role verification is unavailable");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/admin/users/me`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    // A revoked/non-admin identity must never recover privileges from an old allowlist.
    if (response.status === 401 || response.status === 403) return "VIEWER";
    if (!response.ok) throw new Error("Admin role verification is unavailable");
    const body = await response.json();
    const role = typeof body?.role === "string" ? body.role.trim().toUpperCase() : "";
    return Object.hasOwn(ROLE_HIERARCHY, role) ? ROLE_HIERARCHY[role] : "VIEWER";
  } finally {
    clearTimeout(timeout);
  }
}
