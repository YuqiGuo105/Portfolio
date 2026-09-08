import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/agentServiceProxy.js", import.meta.url), "utf8");
const rolesModule = new URL("../src/lib/managedAdminRoles.mjs", import.meta.url).href;
const fixtureUser = { email: "admin@example.test", id: "test-owner" };
const mockedSource = source
  .replace('import { createClient } from "@supabase/supabase-js";',
    'const createClient = () => ({auth:{getUser: async () => globalThis.__adminGuardTestUser}});')
  .replace('"./managedAdminRoles.mjs"', JSON.stringify(rolesModule));
const { requireAdminUser, requireSupabaseUser, forwardJson } = await import(
  `data:text/javascript;base64,${Buffer.from(mockedSource).toString("base64")}`
);

function response() {
  return {
    code: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

test("API guards enforce verified identity and managed roles", async (t) => {
  const oldFetch = globalThis.fetch;
  const vars = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WRITER_API_URL", "ADMIN_ALLOWED_EMAILS", "AGENT_SERVICE_URL", "AGENT_SERVICE_INTERNAL_TOKEN"];
  const oldEnv = Object.fromEntries(vars.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://auth.example.test", SUPABASE_SERVICE_ROLE_KEY: "fixture-key",
    WRITER_API_URL: "https://admin.example.test", ADMIN_ALLOWED_EMAILS: fixtureUser.email,
    AGENT_SERVICE_URL: "https://agent.example.test", AGENT_SERVICE_INTERNAL_TOKEN: "fixture-internal",
  });
  t.after(() => {
    globalThis.fetch = oldFetch;
    delete globalThis.__adminGuardTestUser;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const req = { headers: { authorization: "Bearer fixture-session" } };
  globalThis.__adminGuardTestUser = { data: { user: fixtureUser } };

  await t.test("missing token returns 401 without an upstream request", async () => {
    globalThis.fetch = async () => { throw new Error("Must not reach backend"); };
    const res = response();
    assert.equal(await requireAdminUser({ headers: {} }, res), null);
    assert.equal(res.code, 401);
    assert.ok(res.headers["Cache-Control"].includes("no-store"));
  });
  await t.test("invalid token returns 401", async () => {
    globalThis.__adminGuardTestUser = { error: new Error("Invalid token") };
    const res = response();
    assert.equal(await requireAdminUser(req, res), null);
    assert.equal(res.code, 401);
    globalThis.__adminGuardTestUser = { data: { user: fixtureUser } };
  });
  for (const [status, role, expected] of [[403, "ADMIN", 403], [500, "ADMIN", 503], [200, "EDITOR", 403], [200, "PUBLISHER", 403]]) {
    await t.test(`upstream ${status}/${role}: stale allowlist cannot bypass ${expected}`, async () => {
      globalThis.fetch = async () => ({ status, ok: status === 200, json: async () => ({ role }) });
      const res = response();
      assert.equal(await requireAdminUser(req, res), null);
      assert.equal(res.code, expected);
    });
  }
  await t.test("verified managed admin is accepted", async () => {
    globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({ role: "ADMIN" }) });
    assert.equal((await requireAdminUser(req, response())).roles, "EDITOR,PUBLISHER,ADMIN");
  });
  await t.test("anonymous public chat stays unprivileged", async () => {
    assert.deepEqual(await requireSupabaseUser({ headers: {} }, response(), { allowAnonymous: true }), {
      email: null, roles: "VIEWER", anonymous: true,
    });
  });
  await t.test("forwarded identity overrides client-supplied admin claims", async () => {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.userRoles, "VIEWER");
      assert.equal(body.userEmail, null);
      return { status: 200, headers: new Headers(), text: async () => "{}" };
    };
    await forwardJson({ headers: {}, body: { userRoles: "ADMIN", userEmail: fixtureUser.email } }, response(), {
      path: "/api/intent", auth: { email: null, roles: "VIEWER" },
    });
  });
});
