const ROLE_HIERARCHY = Object.freeze({
  ADMIN: "EDITOR,PUBLISHER,ADMIN",
  PUBLISHER: "EDITOR,PUBLISHER",
  EDITOR: "EDITOR",
});

function roleHierarchy(role) {
  const normalized = typeof role === "string" ? role.trim().toUpperCase() : "";
  return Object.hasOwn(ROLE_HIERARCHY, normalized) ? ROLE_HIERARCHY[normalized] : "VIEWER";
}

async function resolveRegistryRoles(registryClient, email) {
  if (!registryClient || !email) return null;

  const { data, error } = await registryClient
    .from("admin_users")
    .select("role,status")
    .ilike("email", email)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (String(data.status || "").trim().toUpperCase() !== "ACTIVE") return "VIEWER";
  return roleHierarchy(data.role);
}

async function resolveRemoteRoles(token, { baseUrl, fetchImpl, timeoutMs }) {
  if (!baseUrl || !token) throw new Error("Admin role verification is unavailable");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    return roleHierarchy(body?.role);
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveManagedAdminRoles(token, {
  baseUrl,
  email,
  fetchImpl = fetch,
  registryClient,
  timeoutMs = 8000,
} = {}) {
  let registryError = null;
  try {
    const registryRoles = await resolveRegistryRoles(registryClient, email);
    if (registryRoles !== null) return registryRoles;
  } catch (error) {
    registryError = error;
  }

  try {
    return await resolveRemoteRoles(token, { baseUrl, fetchImpl, timeoutMs });
  } catch (remoteError) {
    throw new AggregateError(
      [registryError, remoteError].filter(Boolean),
      "Admin role verification is unavailable",
    );
  }
}
