import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { resolveManagedAdminRoles } from "../src/lib/managedAdminRoles.mjs";

const baseUrl = "https://admin.example.test";
const response = (status, body = {}) => ({ status, ok: status === 200, json: async () => body });

for (const [role, expected] of Object.entries({
  ADMIN: "EDITOR,PUBLISHER,ADMIN", PUBLISHER: "EDITOR,PUBLISHER", EDITOR: "EDITOR",
  VIEWER: "VIEWER", UNKNOWN: "VIEWER", constructor: "VIEWER",
})) {
  test(`managed role ${role} resolves to ${expected}`, async () => {
    assert.equal(await resolveManagedAdminRoles("fixture-token", {
      baseUrl, fetchImpl: async () => response(200, { role }),
    }), expected);
  });
}

for (const status of [401, 403]) {
  test(`denied identity (${status}) never gets fallback privileges`, async () => {
    assert.equal(await resolveManagedAdminRoles("fixture-token", {
      baseUrl, fetchImpl: async () => response(status, { role: "ADMIN" }),
    }), "VIEWER");
  });
}

for (const status of [302, 404, 429, 500, 503]) {
  test(`role service failure (${status}) fails closed`, async () => {
    await assert.rejects(resolveManagedAdminRoles("fixture-token", {
      baseUrl, fetchImpl: async () => response(status),
    }));
  });
}

test("network errors, malformed JSON and missing configuration fail closed", async () => {
  await assert.rejects(resolveManagedAdminRoles("fixture-token"));
  for (const fetchImpl of [
    async () => { throw new Error("offline"); },
    async () => ({ ...response(200), json: async () => { throw new SyntaxError("bad JSON"); } }),
  ]) await assert.rejects(resolveManagedAdminRoles("fixture-token", { baseUrl, fetchImpl }));
});

test("role lookup does not cache or follow redirects with the bearer token", async () => {
  await resolveManagedAdminRoles("fixture-token", {
    baseUrl: `${baseUrl}/`, fetchImpl: async (url, options) => {
      assert.equal(url, `${baseUrl}/api/admin/users/me`);
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer fixture-token");
      assert.ok(options.signal instanceof AbortSignal);
      return response(200, { role: "ADMIN" });
    },
  });
});

test("active registry roles resolve without a cross-service request", async () => {
  let remoteCalled = false;
  const registryClient = {
    from(table) {
      assert.equal(table, "admin_users");
      return {
        select(columns) {
          assert.equal(columns, "role,status");
          return {
            ilike(column, value) {
              assert.equal(column, "email");
              assert.equal(value, "admin@example.test");
              return { maybeSingle: async () => ({ data: { role: "ADMIN", status: "ACTIVE" }, error: null }) };
            },
          };
        },
      };
    },
  };

  assert.equal(await resolveManagedAdminRoles("fixture-token", {
    baseUrl,
    email: "admin@example.test",
    registryClient,
    fetchImpl: async () => { remoteCalled = true; return response(500); },
  }), "EDITOR,PUBLISHER,ADMIN");
  assert.equal(remoteCalled, false);
});

test("suspended registry users are denied without consulting fallback policy", async () => {
  let remoteCalled = false;
  const registryClient = {
    from: () => ({
      select: () => ({
        ilike: () => ({
          maybeSingle: async () => ({ data: { role: "ADMIN", status: "SUSPENDED" }, error: null }),
        }),
      }),
    }),
  };

  assert.equal(await resolveManagedAdminRoles("fixture-token", {
    baseUrl,
    email: "admin@example.test",
    registryClient,
    fetchImpl: async () => { remoteCalled = true; return response(200, { role: "ADMIN" }); },
  }), "VIEWER");
  assert.equal(remoteCalled, false);
});

test("missing or unavailable registry falls back to managed role service", async () => {
  const missingRegistryClient = {
    from: () => ({
      select: () => ({
        ilike: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  };
  assert.equal(await resolveManagedAdminRoles("fixture-token", {
    baseUrl,
    email: "admin@example.test",
    registryClient: missingRegistryClient,
    fetchImpl: async () => response(200, { role: "PUBLISHER" }),
  }), "EDITOR,PUBLISHER");

  const failedRegistryClient = {
    from: () => ({ select: () => ({ ilike: () => ({ maybeSingle: async () => ({ data: null, error: new Error("offline") }) }) }) }),
  };
  assert.equal(await resolveManagedAdminRoles("fixture-token", {
    baseUrl,
    email: "admin@example.test",
    registryClient: failedRegistryClient,
    fetchImpl: async () => response(200, { role: "EDITOR" }),
  }), "EDITOR");
});

test("private route headers disable caching and embedding", async () => {
  const require = createRequire(import.meta.url);
  const config = require("../next.config.js");
  const headers = await config.headers();
  assert.equal(config.poweredByHeader, false);
  assert.ok(headers[0].headers.some(h => h.key === "Content-Security-Policy" && h.value.includes("frame-ancestors 'none'")));
  for (const route of ["/api/admin/:path*", "/api/rag/:path*", "/oauth/:path*", "/mcp/admin"]) {
    assert.ok(headers.find(h => h.source === route).headers.some(h => h.key === "Cache-Control" && h.value.includes("no-store")));
  }
});

test("admin guards have no email fallback and the browser does not persist private chat", async () => {
  const proxy = await readFile(new URL("../src/lib/agentServiceProxy.js", import.meta.url), "utf8");
  const guard = await readFile(new URL("../src/lib/adminRouteAuth.js", import.meta.url), "utf8");
  const chat = await readFile(new URL("../src/components/ChatWidget.js", import.meta.url), "utf8");
  assert.ok(!proxy.includes("ADMIN_ALLOWED_EMAILS"));
  assert.ok(guard.includes("requireAdmin = requireAdminUser"));
  assert.ok(!chat.includes('supabase.from("Chat")'));
});
