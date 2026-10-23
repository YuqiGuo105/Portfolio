import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as history from "../src/lib/voice/historyView.mjs";

const { mapVoiceConversation, voiceHistoryOptions, voiceHistoryResponse, voiceConversationMatches, mergeConversationActivity } = history;
const now = Date.parse("2026-10-22T12:00:00Z");
const start = "2026-10-22T11:00:00Z";
const end = "2026-10-22T11:02:05Z";
const message = (id, overrides = {}) => ({
  id, conversation_id: "call-1", role: "assistant", content: `Transcript ${id}`, created_at: start,
  metadata_json: { provider: "Qwen", model: "qwen-test", source: "voice", completion: "generated", sequence: 1 }, ...overrides,
});
const call = (overrides = {}) => ({
  id: "call-1", channel: "voice", status: "completed", created_at: start, updated_at: end,
  messages: [message("message-1")], ...overrides,
});

test("voice options bound time and calls, including malformed and repeated parameters", () => {
  assert.deepEqual(voiceHistoryOptions({}, now), {
    hours: 168, limit: 50, query: "", from: "2026-10-15T12:00:00.000Z", to: "2026-10-22T12:00:00.000Z",
  });
  for (const value of [999999, "999999"]) {
    const options = voiceHistoryOptions({ hours: value, limit: value }, now);
    assert.equal(options.hours, 720);
    assert.equal(options.limit, 100);
  }
  for (const value of [-10, 0, "0.5"]) {
    const options = voiceHistoryOptions({ hours: value, limit: value }, now);
    assert.equal(options.hours, 1);
    assert.equal(options.limit, 1);
  }
  for (const value of ["NaN", "Infinity", ["24", "720"], "", " ", null]) {
    const options = voiceHistoryOptions({ hours: value, limit: value, q: ["test"] }, now);
    assert.equal(options.hours, 168);
    assert.equal(options.limit, 50);
    assert.equal(options.query, "");
  }
  assert.equal(voiceHistoryOptions({ q: "  A_b%  " }, now).query, "A_b%");
});

test("one call maps to a voice item, with no manufactured run or latency", () => {
  const item = mapVoiceConversation(call());
  assert.equal(item.kind, "voice");
  assert.equal(item.conversationId, "call-1");
  assert.equal(item.durationMs, 125000);
  assert.equal(item.endedAt, end);
  assert.deepEqual(item.providers, ["Qwen"]);
  assert.equal(item.environment, "production");
  assert.equal(item.messages[0].completion, "generated");
  for (const key of ["runId", "latencyMs", "steps", "heard", "played"]) assert.equal(key in item, false);
  assert.equal(mapVoiceConversation(call({ channel: "voice-local" })).environment, "development");
  for (const channel of ["api", "web", "voice-malicious", "", null]) assert.equal(mapVoiceConversation(call({ channel })), null);
});

test("duration uses terminal call timestamps, never message times or agent latency", () => {
  for (const status of ["completed", "interrupted", "failed"]) {
    assert.equal(mapVoiceConversation(call({ status, latency_ms: 9, messages: [message("late", { created_at: "2026-10-22T11:30:00Z" })] })).durationMs, 125000);
  }
  for (const overrides of [
    { status: "active" }, { status: "unknown" }, { updated_at: null }, { updated_at: "invalid" },
    { created_at: null }, { updated_at: "2026-10-22T10:00:00Z" },
  ]) assert.equal(mapVoiceConversation(call(overrides)).durationMs, null);
  assert.equal(mapVoiceConversation(call({ updated_at: start })).durationMs, 0);
});

test("transcripts order by creation time, numeric sequence, then ID without mutation", () => {
  const messages = [
    message("later", { created_at: end, metadata_json: { sequence: 0 } }),
    message("ten", { metadata_json: { sequence: 10 } }),
    message("two-b", { metadata_json: { sequence: 2 } }),
    message("two-a", { metadata_json: { sequence: 2 } }),
    message("missing", { metadata_json: null }),
  ];
  const original = structuredClone(messages);
  assert.deepEqual(mapVoiceConversation(call({ messages })).messages.map((m) => m.id), ["two-a", "two-b", "ten", "missing", "later"]);
  assert.deepEqual(messages, original);
});

test("transcripts retain drafts and plain text, but exclude non-dialogue and foreign rows", () => {
  const item = mapVoiceConversation(call({ messages: [
    message("draft", { content: "<script>alert(1)</script> **plain**", metadata_json: { provider: "Google", completion: "streaming" } }),
    message("empty", { role: "user", content: "", metadata_json: { pending: true } }),
    message("partial", { metadata_json: { completion: "interrupted", truncated: true } }),
    message("ended", { metadata_json: { completion: "call-ended" } }),
    message("unknown", { metadata_json: "bad-json" }),
    message("system", { role: "system" }),
    message("other-call", { conversation_id: "other-call" }),
  ] }));
  assert.equal(item.messages.length, 5);
  assert.equal(item.messages.find((m) => m.id === "draft").content, "<script>alert(1)</script> **plain**");
  assert.equal(item.messages.find((m) => m.id === "draft").completion, "pending");
  assert.equal(item.messages.find((m) => m.id === "empty").completion, "pending");
  assert.equal(item.messages.find((m) => m.id === "partial").completion, "interrupted");
  assert.equal(item.messages.find((m) => m.id === "partial").truncated, true);
  assert.equal(item.messages.find((m) => m.id === "ended").completion, "call-ended");
  assert.equal(item.messages.find((m) => m.id === "unknown").completion, "unknown");
  assert.deepEqual(item.providers, ["Google"]);
  assert.deepEqual(mapVoiceConversation(call({ messages: [] })).providers, []);
});

test("500-message cap is explicit, including when exactly at the limit", () => {
  const messages = Array.from({ length: 501 }, (_, i) => message(`m-${i}`, { metadata_json: { sequence: i }, content: i === 500 ? "beyond-cap" : "within-cap" }));
  const item = mapVoiceConversation(call({ messages }));
  assert.equal(item.messages.length, 500);
  assert.equal(item.transcriptLimitReached, true);
  assert.equal(voiceConversationMatches(item, "beyond-cap"), false);
  assert.equal(mapVoiceConversation(call({ messages: messages.slice(0, 500) })).transcriptLimitReached, true);
  assert.equal(mapVoiceConversation(call({ messages: messages.slice(0, 499) })).transcriptLimitReached, false);
});

test("search is literal case-insensitive ID/content substring, with a latest-call bounded scope", () => {
  const item = mapVoiceConversation(call({ messages: [message("turn-ID", { content: "Hello 你好 literal %_ (text)" })] }));
  for (const query of ["CALL-1", "TURN-id", "hello", "你好", "%_", " (text) ", ""]) assert.equal(voiceConversationMatches(item, query), true);
  for (const query of ["Qwen", "qwen-test", "does-not-exist", ".*"]) assert.equal(voiceConversationMatches(item, query), false);
  const rows = [
    call({ id: "older", created_at: "2026-10-22T10:00:00Z", messages: [message("hidden", { conversation_id: "older", content: "match only here" })] }),
    call({ id: "newer", messages: [] }),
    call({ id: "non-voice", channel: "api" }),
    call({ id: "out-of-window", created_at: "2026-08-01T00:00:00Z" }),
    call({ id: "future", created_at: "2026-10-23T00:00:00Z" }),
  ];
  const result = voiceHistoryResponse(rows, voiceHistoryOptions({ limit: 1, q: "match only here" }, now));
  assert.deepEqual(result.items, []);
  assert.equal(result.scope.scannedCalls, 1);
  assert.equal(result.scope.callLimitReached, true);
  assert.equal(result.scope.messageLimitPerCall, 500);
  assert.deepEqual(voiceHistoryResponse(rows, voiceHistoryOptions({ limit: 100 }, now)).items.map((i) => i.id), ["newer", "older"]);
});

test("mixed activity sorts newest first without modifying or inventing agent records", () => {
  const agent = { runId: "agent-1", startedAt: "2026-10-22T11:01:00Z", latencyMs: 1500 };
  const voice = mapVoiceConversation(call());
  const agents = [agent, { runId: "no-time" }];
  const voices = [voice];
  const merged = mergeConversationActivity(agents, voices);
  assert.equal(merged[0], agent);
  assert.equal(merged[1], voice);
  assert.equal(merged[2].runId, "no-time");
  assert.equal(agents.length, 2);
  assert.equal(voices.length, 1);
});

const require = createRequire(import.meta.url);
const { transform } = require("next/dist/build/swc");
async function compile(relativePath, mocks = {}) {
  const { code } = await transform(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    filename: relativePath, jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" },
  });
  const exports = {};
  new Function("require", "exports", code)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), exports);
  return exports;
}
function response() {
  return {
    code: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("voice endpoint authorizes first and never queries on denied or non-GET requests", async () => {
  for (const [method, authorized, expected] of [["GET", false, 403], ["POST", false, 403], ["POST", true, 405]]) {
    let guards = 0;
    const { default: handler } = await compile("../pages/api/admin/voice-conversations.js", {
      "../../../src/lib/agentServiceProxy": { requireAdminUser: async (_req, res) => { guards++; if (authorized) return { roles: "ADMIN" }; res.status(403).json({ error: "forbidden" }); return null; } },
      "../../../src/supabase/supabaseServer": { supabaseServer: { from() { assert.fail("Must not query database"); } } },
      "../../../src/lib/voice/historyView.mjs": history,
    });
    const res = response();
    await handler({ method, query: {} }, res);
    assert.equal(guards, 1);
    assert.equal(res.code, expected);
    assert.match(res.headers["Cache-Control"], /private, no-store/);
    if (expected === 405) assert.equal(res.headers.Allow, "GET");
  }
});

test("voice endpoint generates a bounded GET through the existing client and redacts query failures", async () => {
  const { createClient } = require("@supabase/supabase-js");
  let authorized = false;
  let failure = false;
  let urls = [];
  const client = createClient("https://fixture.example.test", "fixture-only-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, options) => {
      assert.equal(authorized, true);
      assert.equal(options.method, "GET");
      urls.push(new URL(input));
      return new Response(JSON.stringify(failure ? { message: "PRIVATE DATABASE DETAIL" } : []), { status: failure ? 400 : 200, headers: { "Content-Type": "application/json" } });
    } },
  });
  const { default: handler } = await compile("../pages/api/admin/voice-conversations.js", {
    "../../../src/lib/agentServiceProxy": { requireAdminUser: async () => { authorized = true; return { roles: "ADMIN" }; } },
    "../../../src/supabase/supabaseServer": { supabaseServer: client },
    "../../../src/lib/voice/historyView.mjs": history,
  });
  let res = response();
  await handler({ method: "GET", query: { hours: "999999", limit: "999999", q: "anything,or(id.eq.private)" } }, res);
  assert.equal(res.code, 200);
  assert.equal(urls.length, 1);
  const url = urls[0];
  assert.equal(url.pathname, "/rest/v1/conversation");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.get("messages.limit"), "500");
  assert.equal(url.searchParams.get("channel"), "in.(voice,voice-local)");
  assert.equal(url.searchParams.get("order"), "created_at.desc,id.asc");
  assert.equal(url.searchParams.get("messages.order"), "created_at.asc,metadata_json->sequence.asc.nullslast,id.asc");
  assert.ok(url.searchParams.get("select").includes("messages:message!conversation_id("));
  const [lower, upper] = url.searchParams.getAll("created_at").map((value) => Date.parse(value.slice(4)));
  assert.equal(upper - lower, 30 * 24 * 60 * 60 * 1000);
  assert.equal(url.searchParams.has("or"), false);
  assert.ok(!url.href.includes("private"));
  failure = true;
  res = response();
  await handler({ method: "GET", query: {} }, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.error, "voice_history_unavailable");
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE DATABASE DETAIL/);
});

test("admin API preserves agent requests and adds an authenticated no-store voice request", async (t) => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (path, options) => { requests.push({ path, options }); return new Response('{"items":[]}', { status: 200 }); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const { adminApi } = await compile("../src/lib/adminApi.js", {
    "../supabase/supabaseClient": { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fixture-session" } } }) } } },
  });
  await adminApi.conversations.list({ query: "agent query", hours: 24, limit: 100 });
  await adminApi.voiceConversations.list({ query: "voice %_", hours: 720, limit: 100 });
  assert.match(requests[0].path, /^\/api\/admin\/chat-conversations\?/);
  assert.match(requests[1].path, /^\/api\/admin\/voice-conversations\?/);
  assert.equal(new URL(requests[1].path, "https://fixture.test").searchParams.get("q"), "voice %_");
  assert.equal(requests[1].options.cache, "no-store");
  for (const request of requests) assert.equal(request.options.headers.Authorization, "Bearer fixture-session");
});

test("conversations UI merges fixtures, folds transcripts, and isolates partial failures", async (t) => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", { url: "https://fixture.test" });
  const previous = Object.fromEntries(["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of ["window", "document", "navigator"]) Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : dom.window[key], configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { act, Simulate } = require("react-dom/test-utils");
  const ui = await compile("../src/components/admin/AdminUI.js", { "./AdminPage.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } });
  let mode = "success";
  const pending = [];
  const agentItem = { runId: "agent-fixture", startedAt: end, status: "completed", completedAt: end, question: "Agent question", answer: "Agent answer", latencyMs: 1500 };
  const voiceItem = mapVoiceConversation(call({ messages: [message("fixture-message", { content: "<script>unsafe()</script> **plain transcript**" })] }));
  const voiceData = { items: [voiceItem], scope: voiceHistoryResponse([], voiceHistoryOptions({ limit: 100 }, now)).scope };
  const { default: Page } = await compile("../pages/admin/conversations.js", {
    "next/dynamic": { __esModule: true, default: () => ({ content }) => React.createElement("p", null, content) },
    "../../src/components/admin/AdminLayout": { __esModule: true, default: ({ children }) => React.createElement("main", null, children) },
    "../../src/components/admin/AdminUI": ui,
    "../../src/lib/voice/historyView.mjs": history,
    "../../src/lib/adminApi": { adminApi: {
      conversations: { list: async () => {
        if (mode === "agent-error" || mode === "both-error") throw new Error("Agent offline");
        return { items: [agentItem], summary: { runs: 1, completed: 1, blocked: 0, averageLatencyMs: 1500 } };
      } },
      voiceConversations: { list: async ({ query }) => {
        if (mode === "voice-error" || mode === "both-error") throw new Error("Voice offline");
        if (mode === "deferred") return new Promise((resolve) => pending.push({ query, resolve }));
        return voiceData;
      } },
    } },
  });
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 280)));
  const refresh = () => act(async () => Simulate.click([...document.querySelectorAll("button")].find((button) => button.textContent.includes("Refresh"))));
  await act(async () => root.render(React.createElement(Page)));
  await settle();
  assert.match(document.body.textContent, /Agent answer/);
  assert.match(document.body.textContent, /Voice \/ Qwen/);
  assert.match(document.body.textContent, /Call duration 2m 05s/);
  assert.equal(document.querySelectorAll("article").length, 2);
  assert.match(document.querySelectorAll("article")[0].textContent, /Agent question/);
  assert.equal(document.querySelector("details").open, false);
  assert.doesNotMatch(document.body.textContent, /plain transcript/);
  assert.equal(document.querySelector(".metricValue").textContent, "1");
  await act(async () => {
    const details = document.querySelector("details");
    details.open = true;
    details.dispatchEvent(new dom.window.Event("toggle"));
  });
  assert.match(document.body.textContent, /Generated \(playback unconfirmed\)/);
  assert.match(document.body.textContent, /does not confirm audio playback/);
  assert.match(document.body.textContent, /<script>unsafe\(\)<\/script> \*\*plain transcript\*\*/);
  assert.equal(document.querySelectorAll("script").length, 0);
  mode = "voice-error";
  await refresh();
  assert.match(document.body.textContent, /Voice records unavailable: Voice offline/);
  assert.match(document.body.textContent, /Agent answer/);
  assert.equal(document.querySelectorAll("article").length, 1);
  mode = "agent-error";
  await refresh();
  assert.match(document.body.textContent, /Agent records unavailable: Agent offline/);
  assert.match(document.body.textContent, /Voice \/ Qwen/);
  assert.equal(document.querySelector(".metricValue").textContent, "—");
  mode = "both-error";
  await refresh();
  assert.match(document.body.textContent, /Data unavailable/);
  assert.doesNotMatch(document.body.textContent, /Nothing here yet|No records match/);
  mode = "deferred";
  await refresh();
  const input = document.querySelector("input");
  await act(async () => Simulate.change(input, { target: { value: "new-query" } }));
  await act(async () => pending[0].resolve({ ...voiceData, items: [{ ...voiceItem, id: "stale-call" }] }));
  assert.match(document.body.textContent, /Loading data/);
  await settle();
  assert.equal(pending[1].query, "new-query");
  await act(async () => pending[1].resolve({ ...voiceData, items: [{ ...voiceItem, id: "fresh-call" }] }));
  assert.match(document.body.textContent, /fresh-call/);
  assert.doesNotMatch(document.body.textContent, /stale-call/);
});
