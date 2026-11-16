import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureKey = "fixture-gemini-secret-never-public";
const privatePayload = `https://provider.example.test/?key=${fixtureKey} private-request-body`;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// Moderation has its own tests; these fixtures exercise downstream credential handling.
const isolateModeration = source => source.replace(/import \{ moderateChatRequest \} from ['"][^'"]+discovery\/http['"];?/,
  'const moderateChatRequest = async () => true;');

async function loadHandlers() {
  // Keep the real HTTP gate, but never connect credential tests to the shared queue.
  const admissionModule = dataModule(`
    import { admitChatMessage } from ${JSON.stringify(new URL("../src/lib/chat/admissionHttp.mjs", import.meta.url).href)};
    let result = { allowed: true };
    export const calls = [];
    export function reset(next = { allowed: true }) { result = next; calls.length = 0; }
    export function chatAdmissionRuntime() {
      return { admit(req, res, auth) {
        calls.push(auth);
        return admitChatMessage(req, res, {
          admission: { act: async () => result }, ipOf: () => "203.0.113.1", auth,
        });
      } };
    }
  `);
  const router = (await readFile(new URL("../pages/api/intent/route.js", import.meta.url), "utf8"))
    .replace('import { loadManifest, manifestForLLM } from "../../../src/lib/intentManifest.js";',
      'const loadManifest = async () => ({ version: "fixture", tools: [] }); const manifestForLLM = () => [];')
    .replace('"../../../src/lib/intentValidator.js"',
      JSON.stringify(new URL("../src/lib/intentValidator.js", import.meta.url).href));
  const rag = (await readFile(new URL("../pages/api/rag/answer/stream.js", import.meta.url), "utf8"))
    .replace('import { createClient } from "@supabase/supabase-js";',
      'const createClient = () => ({ from: () => ({ select: async () => ({ data: [] }) }) });')
    .replace('import { searchItems } from "../../../../src/lib/searchItems";',
      'const searchItems = async () => ({ results: [] });')
    .replace('"../../../../src/lib/responseLanguagePolicy.mjs"',
      JSON.stringify(new URL("../src/lib/responseLanguagePolicy.mjs", import.meta.url).href))
    .replace('"../../../../src/lib/localAssistant.mjs"',
      JSON.stringify(new URL("../src/lib/localAssistant.mjs", import.meta.url).href))
    .replace('import { streamLocalChat } from "../../../../src/lib/qwenLocalChat.mjs";',
      'const streamLocalChat = async () => { throw new Error("Unexpected local override"); };')
    .replace('import { isRateLimited } from "../../../../src/lib/rateLimiter";',
      'const isRateLimited = async () => false;')
    .replace('"../../../../src/lib/chat/admissionRuntime.mjs"', JSON.stringify(admissionModule))
    .replace(/import \{\s*forwardRagSse,\s*requireSupabaseUser,\s*\} from "[^\"]+";/,
      'const requireSupabaseUser = async () => ({ roles: "VIEWER" }); const forwardRagSse = async (_req, res) => res.end("delegated");');
  return {
    router: (await import(dataModule(isolateModeration(router)))).default,
    rag: (await import(dataModule(isolateModeration(rag)))).default,
    admission: await import(admissionModule),
  };
}

function response() {
  return {
    code: 200, body: null, stream: "", ended: false,
    setHeader() {}, flush() {},
    writeHead(code) { this.code = code; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; },
    write(chunk) { this.stream += chunk; },
    end(chunk = "") { this.stream += chunk; this.ended = true; },
  };
}

test("Gemini routes keep provider credentials and failures server-side", async t => {
  const env = { GEMINI_API_KEY: fixtureKey, SUPABASE_URL: "https://db.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-db-key", GEMINI_BASE_URL: "https://provider.example.test/v1beta",
    AGENT_SERVICE_URL: "" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const handlers = await loadHandlers();
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));

  for (const kind of ["router", "rag"]) {
    for (const failure of ["http", "network", "malformed"]) {
      await t.test(`${kind}: ${failure} cannot leak credentials to response or logs`, async child => {
        logs.length = 0;
        let requests = 0;
        child.mock.method(globalThis, "fetch", async (url, options) => {
          requests++;
          assert.equal(new URL(url).searchParams.has("key"), false);
          assert.equal(url.includes(fixtureKey), false);
          assert.equal(options.headers["x-goog-api-key"], fixtureKey);
          assert.equal(options.body.includes(fixtureKey), false);
          if (failure === "network") throw new Error(privatePayload);
          if (failure === "http") return new Response(privatePayload, { status: 403 });
          if (kind === "router") return Response.json({ candidates: [{ content: { parts: [{ text: privatePayload }] } }] });
          return { ok: true, body: { getReader() { throw new Error(privatePayload); } } };
        });
        const res = response();
        await handlers[kind]({ method: "POST", body: { input: "hello", question: "hello" } }, res);
        assert.equal(requests, 1);
        assert.equal(res.code, 200);
        if (kind === "router") {
          assert.equal(res.body.routeKind, "KB_QA");
          assert.equal(res.body.trace.classifierError, "MODEL_UNAVAILABLE");
        } else {
          assert.equal(res.ended, true);
          assert.match(res.stream, /answer_final/);
          assert.match(res.stream, /event: end/);
          assert.match(res.stream, /temporarily unavailable/);
        }
        assert.doesNotMatch(JSON.stringify([res.body, res.stream, logs]), /fixture-gemini-secret|private-request-body|provider\.example/);
      });
    }
    await t.test(`${kind}: successful header-authenticated response remains usable`, async child => {
      child.mock.method(globalThis, "fetch", async (url, options) => {
        assert.equal(new URL(url).searchParams.has("key"), false);
        assert.equal(options.headers["x-goog-api-key"], fixtureKey);
        const content = kind === "router"
          ? JSON.stringify({ routeKind: "GENERAL_CHAT", confidence: 1, language: "en", toolArgumentsJson: "{}" })
          : "Hello from the test provider.";
        const payload = { candidates: [{ content: { parts: [{ text: content }] } }] };
        return kind === "router" ? Response.json(payload)
          : new Response(`data: ${JSON.stringify(payload)}\n\n`);
      });
      const res = response();
      await handlers[kind]({ method: "POST", body: { input: "hello", question: "hello" } }, res);
      if (kind === "router") {
        assert.equal(res.body.routeKind, "GENERAL_CHAT");
        assert.equal(res.body.trace.classifierError, null);
      } else {
        assert.match(res.stream, /Hello from the test provider/);
        assert.match(res.stream, /answer_final/);
        assert.equal(res.ended, true);
      }
    });
  }
  await t.test("configured production RAG delegates to the authenticated Agent proxy", async child => {
    process.env.AGENT_SERVICE_URL = "https://agent.example.test";
    handlers.admission.reset();
    child.mock.method(globalThis, "fetch", async () => { throw new Error("Local provider must not be called"); });
    const res = response();
    await handlers.rag({ method: "POST", body: { question: "hello" } }, res);
    assert.equal(res.stream, "delegated");
    assert.deepEqual(handlers.admission.calls, [{ roles: "VIEWER" }]);
  });
  await t.test("queued production RAG stops before forwarding or calling a model", async child => {
    process.env.AGENT_SERVICE_URL = "https://agent.example.test";
    handlers.admission.reset({ allowed: false, status: "queued", position: 2, ahead: 1, eta: 30 });
    child.after(() => handlers.admission.reset());
    let requests = 0;
    child.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Provider must not be called"); });
    const res = response();
    await handlers.rag({ method: "POST", body: { question: "hello" } }, res);
    assert.equal(res.code, 429);
    assert.deepEqual(res.body.admission, { status: "queued", position: 2, ahead: 1, eta: 30 });
    assert.equal(res.stream, "");
    assert.equal(res.ended, false);
    assert.equal(requests, 0);
    assert.deepEqual(handlers.admission.calls, [{ roles: "VIEWER" }]);
  });
});
