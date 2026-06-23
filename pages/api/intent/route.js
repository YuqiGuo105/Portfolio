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
const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    routeKind: { type: "string", enum: ROUTE_KINDS },
    targetTool: { type: "string", nullable: true },
    confidence: { type: "number" },
    language: { type: "string" },
    normalizedQuery: { type: "string" },
    toolArguments: { type: "object" },
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
    "toolArguments",
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
    "  - CLARIFICATION_NEEDED: maps to a manifest tool but a REQUIRED argument is missing, ambiguous, or would force you to invent an opaque ID.",
    "",
    "Hard rules:",
    "  • NEVER invent sourceId, recipientId, subscriberId, jobId, or any opaque identifier.",
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
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }
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
