/**
 * POST /api/intent/route
 *
 * Manifest-driven route planner. Replaces the brittle frontend
 * heuristic gate (`looksLikeAction`) and the slow agent-service
 * pre-classifier on the hot path.
 *
 * Pipeline:
 *   1. Load the MCP tool manifest (file MVP — swappable for a remote
 *      MCP /tools/list via INTENT_MANIFEST_URL).
 *   2. Ask Gemini 2.5 Flash (cheap, fast, structured-output) to choose
 *      ONE of four route kinds and, if a tool is needed, pick it from
 *      the manifest and propose typed arguments.
 *   3. Deterministic validator strips any prompt-injection / tool-name
 *      hallucination / risk-level lies. The manifest is the source of
 *      truth for risk + confirmation.
 *   4. Return a single RouteDecision. The widget renders the decision;
 *      execution is done by KB_QA → RAG, MCP_TOOL → agent service, etc.
 *
 * NO regex / no keyword list / no per-language verb table. The LLM picks
 * tools from the manifest descriptions; the validator enforces shape.
 */
import { loadManifest, manifestForLLM } from "../../../src/lib/intentManifest.js";
import { validateRouteDecision } from "../../../src/lib/intentValidator.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_ROUTER_MODEL || "gemini-2.5-flash";
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

const ROUTE_KINDS = ["KB_QA", "MCP_TOOL", "GENERAL_CHAT", "CLARIFICATION_NEEDED"];
const RISK_LEVELS = ["READ_ONLY", "WRITE", "RISKY_WRITE"];

// JSON schema we hand to Gemini's responseSchema so we get a guaranteed-shape
// payload. (Gemini's structured output uses a JSON-Schema-ish subset.)
//
// IMPORTANT — `toolArguments` is declared as a STRING containing JSON, not a
// raw object. Gemini's structured-output engine emits `{}` for any
// `type: "object"` field that has no `properties` declared, because it has
// no keys to fill. Since the property set of `toolArguments` is
// tool-dependent and not known at schema-build time, we ask Gemini to emit a
// JSON-stringified object instead, and parse it on our side. This is the
// only reliable way to get free-form key/value output from Gemini
// structured output.
const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    routeKind: { type: "string", enum: ROUTE_KINDS },
    targetTool: { type: "string", nullable: true },
    confidence: { type: "number" },
    language: { type: "string" },
    normalizedQuery: { type: "string" },
    toolArgumentsJson: {
      type: "string",
      description:
        'JSON-stringified object of arguments for the chosen tool. Use "{}" when no tool. Keys MUST match the selected tool inputSchema.properties keys exactly.',
    },
    missingArguments: { type: "array", items: { type: "string" } },
    riskLevel: { type: "string", enum: RISK_LEVELS },
    requiresConfirmation: { type: "boolean" },
    clarificationQuestion: { type: "string", nullable: true },
  },
  required: [
    "routeKind",
    "confidence",
    "language",
    "normalizedQuery",
    "toolArgumentsJson",
    "missingArguments",
  ],
};

function buildSystemPrompt() {
  return [
    "You are a route planner for a Portfolio MCP system.",
    "The user may write in any language (English, Chinese, or mixed).",
    "",
    "You MUST choose exactly one of these route kinds:",
    "  - KB_QA: the user is asking a knowledge / portfolio question (about Yuqi Guo, his work, experience, blogs, projects, skills, or anything explainable from the knowledge base).",
    "  - MCP_TOOL: the user wants to OPERATE on live state via one of the tools in the manifest (search, list, publish, send, contact, etc.). Pick a tool ONLY from the manifest by `name`.",
    "  - GENERAL_CHAT: pure chit-chat / greetings / acknowledgements with no informational or operational need.",
    "  - CLARIFICATION_NEEDED: maps to a manifest tool but a REQUIRED argument is truly absent from BOTH `input` AND all of `recentMessages`.",
    "",
    "Filling toolArgumentsJson — CRITICAL:",
    "  • `toolArgumentsJson` is a STRING containing a JSON object — e.g. `'{\"name\":\"Alice\",\"email\":\"a@b.c\",\"message\":\"hi\"}'`.",
    "  • When routeKind is MCP_TOOL, populate it with EVERY argument you can find.",
    "  • Key names inside the JSON MUST match the selected tool's `inputSchema.properties` keys exactly (case-sensitive).",
    "  • Scan BOTH `input` (the current message) AND `recentMessages` (conversation history, newest last).",
    "  • Plain user-supplied fields (name, email, message, subject, keyword, content, body, etc.)",
    "    MAY be extracted from history even if they are absent from the current `input`.",
    "  • Be tolerant of user formatting — labels like `name:`, `email:`, `Message:` (any case),",
    "    bullet lists, separate lines, or JSON-ish snippets all yield the same fields. Strip the label.",
    "  • Use `\"{}\"` for `toolArgumentsJson` when no tool is selected.",
    "  • Return CLARIFICATION_NEEDED ONLY when a required field cannot be found in EITHER `input` OR `recentMessages`.",
    "",
    "Worked examples (CONTACT use case):",
    "  INPUT: \"name: Alice\\nemail: alice@example.com\\nMessage: Hello world\"",
    "  TOOL:  contact.email_owner  (required: name, email, message)",
    "  OUTPUT: {",
    "    \"routeKind\": \"MCP_TOOL\", \"targetTool\": \"contact.email_owner\",",
    "    \"confidence\": 0.95, \"language\": \"en\",",
    "    \"normalizedQuery\": \"send a contact message to the site owner\",",
    "    \"toolArgumentsJson\": \"{\\\"name\\\":\\\"Alice\\\",\\\"email\\\":\\\"alice@example.com\\\",\\\"message\\\":\\\"Hello world\\\"}\",",
    "    \"missingArguments\": [], \"riskLevel\": \"WRITE\", \"requiresConfirmation\": true,",
    "    \"clarificationQuestion\": null",
    "  }",
    "",
    "  INPUT (turn 1): \"name: Alice, email: alice@example.com, message: Hello\"",
    "  INPUT (turn 2): \"send it\"",
    "  → On turn 2, you STILL fill toolArgumentsJson from turn 1's recentMessages,",
    "    output the same MCP_TOOL shape above. DO NOT return CLARIFICATION_NEEDED.",
    "",
    "Worked example (SUBSCRIPTION use case):",
    "  INPUT: \"email: bob@example.com, subscribe for all updates\"",
    "  TOOL:  subscription.create  (required: email; optional: topics)",
    "  OUTPUT: {",
    "    \"routeKind\": \"MCP_TOOL\", \"targetTool\": \"subscription.create\",",
    "    \"confidence\": 0.95, \"language\": \"en\",",
    "    \"normalizedQuery\": \"subscribe email to all site update topics\",",
    "    \"toolArgumentsJson\": \"{\\\"email\\\":\\\"bob@example.com\\\",\\\"topics\\\":[\\\"ARTICLE_UPDATES\\\",\\\"FEATURE_UPDATES\\\",\\\"JOB_UPDATES\\\"]}\",",
    "    \"missingArguments\": [], \"riskLevel\": \"WRITE\", \"requiresConfirmation\": true,",
    "    \"clarificationQuestion\": null",
    "  }",
    "  • If the user says 'subscribe' / '订阅' but does not specify topics, pick `subscription.create` and either omit `topics` or use [\"ARTICLE_UPDATES\",\"FEATURE_UPDATES\"] as a safe default. DO NOT ask for a name or a message — only email is required.",
    "  • If the user says 'all updates' / 'everything' / '所有更新' / '全部', set topics to all three: [\"ARTICLE_UPDATES\",\"FEATURE_UPDATES\",\"JOB_UPDATES\"].",
    "",
    "Subscribe vs. Contact disambiguation (CRITICAL):",
    "  • Intent = subscribe / receive updates / newsletter / follow / 订阅 / 订阅更新 / 关注更新 → `subscription.create` (only `email` is required).",
    "  • Intent = contact / message owner / send a message to Yuqi / 联系 / 给站长留言 → `contact.email_owner` (needs `name`, `email`, `message`).",
    "  • A bare email plus the word 'subscribe' is NEVER a contact request. Do NOT route it to `contact.email_owner` and do NOT ask the user for a name or a message.",
    "  • Intent = unsubscribe / stop emails / 退订 / 取消订阅 → `subscription.unsubscribe`.",
    "  • Intent = change my subscription topics / update preferences → `subscription.update`.",
    "",
    "Hard rules:",
    "  • NEVER invent sourceId, recipientId, subscriberId, jobId, or any opaque internal identifier —",
    "    even if something resembling one appears in history. Only verbatim user-provided plain values count.",
    "  • NEVER pick a tool name that is not in the manifest.",
    "  • NEVER execute a tool — you only ROUTE.",
    "  • NEVER set riskLevel or requiresConfirmation to values that disagree with the manifest. (A downstream validator will overwrite them anyway.)",
    "  • confidence ∈ [0,1]. Be honest. < 0.55 means you are not sure.",
    "  • If the user asks to 'contact' / '联系' / 'reach' the site owner and they look like a public visitor, prefer the `contact.email_owner` tool, NOT any notification tool.",
    "  • `normalizedQuery` is a short English paraphrase used downstream for retrieval. Keep it under 200 chars.",
    "",
    "Return JSON only. No code fence, no prose.",
  ].join("\n");
}

function buildUserPrompt({ input, manifest, recentMessages }) {
  return JSON.stringify(
    {
      input,
      recentMessages: Array.isArray(recentMessages) ? recentMessages.slice(-6) : [],
      toolManifest: manifestForLLM(manifest),
      routes: ROUTE_KINDS,
    },
    null,
    2,
  );
}

async function callGeminiRouter({ input, manifest, recentMessages }) {
  const body = {
    systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
    contents: [
      {
        role: "user",
        parts: [{ text: buildUserPrompt({ input, manifest, recentMessages }) }],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseSchema: ROUTE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const url =
    `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}` +
    `:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => "");
    throw new Error(`Gemini HTTP ${r.status}: ${errBody.slice(0, 400)}`);
  }
  const json = await r.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
  if (!text) {
    throw new Error("Gemini returned empty response");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }

  // The schema asks Gemini for a stringified `toolArgumentsJson`. Promote it
  // to a real `toolArguments` object for the validator. Defensive: tolerate
  // (a) string JSON, (b) an actual object if Gemini ignored the type, (c)
  // missing / malformed → empty object.
  let toolArguments = {};
  const rawArgs = parsed.toolArgumentsJson ?? parsed.toolArguments;
  if (typeof rawArgs === "string" && rawArgs.trim()) {
    try {
      const obj = JSON.parse(rawArgs);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        toolArguments = obj;
      }
    } catch {
      // leave as {}
    }
  } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    toolArguments = rawArgs;
  }
  parsed.toolArguments = toolArguments;
  delete parsed.toolArgumentsJson;
  return parsed;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  }

  const { input, conversationId, recentMessages } = req.body || {};
  if (!input || typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ error: "`input` is required" });
  }

  const t0 = Date.now();
  let manifest;
  try {
    manifest = await loadManifest();
  } catch (err) {
    console.error("[intent/route] manifest load failed:", err);
    return res.status(500).json({ error: "manifest unavailable" });
  }

  let rawDecision;
  let classifierError = null;
  try {
    rawDecision = await callGeminiRouter({
      input,
      manifest,
      recentMessages,
    });
    // Server-side trace: when MCP_TOOL was picked but toolArguments is empty
    // we almost certainly have a prompt-following bug — log loudly so the
    // next regression is easy to diagnose. We never leak this to the client.
    if (
      rawDecision?.routeKind === "MCP_TOOL" &&
      rawDecision?.targetTool &&
      (!rawDecision.toolArguments ||
        Object.keys(rawDecision.toolArguments).length === 0)
    ) {
      console.warn(
        "[intent/route] suspicious: MCP_TOOL picked but toolArguments empty",
        {
          tool: rawDecision.targetTool,
          input: String(input).slice(0, 200),
          historyTurns: Array.isArray(recentMessages) ? recentMessages.length : 0,
        },
      );
    }
  } catch (err) {
    classifierError = err.message || String(err);
    console.error("[intent/route] classifier failed:", classifierError);
    // Fail safe: route to KB_QA. RAG is always available and the user
    // still gets a useful answer instead of an error toast.
    rawDecision = {
      routeKind: "KB_QA",
      targetTool: null,
      confidence: 0,
      language: "en",
      normalizedQuery: input,
      toolArguments: {},
      missingArguments: [],
      riskLevel: "READ_ONLY",
      requiresConfirmation: false,
      clarificationQuestion: null,
    };
  }

  const { decision, errors } = validateRouteDecision(rawDecision, manifest);

  return res.status(200).json({
    ...decision,
    trace: {
      classifierModel: GEMINI_MODEL,
      classifierError,
      toolManifestVersion: manifest.version,
      validation: errors.length === 0 ? "PASSED" : "FIXED",
      validationErrors: errors,
      latencyMs: Date.now() - t0,
      conversationId: conversationId || null,
    },
  });
}
