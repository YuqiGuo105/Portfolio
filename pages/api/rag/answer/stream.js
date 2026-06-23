/**
 * POST /api/rag/answer/stream
 *
 * Server-Sent-Events endpoint that grounds an arbitrary user question in
 * the Supabase `kb_documents` table and streams a Gemini answer back in
 * the shape the existing ChatWidget already consumes:
 *
 *   event: message
 *   data:  {"stage":"answer_delta","payload":{"delta":"..."}}
 *   ...
 *   event: message
 *   data:  {"stage":"answer_final","payload":{"answer":"..."}}
 *
 * Request body (matches the legacy Railway contract — extra fields are ignored):
 *   {
 *     "question":   string,
 *     "sessionId":  string,
 *     "mode":       "FAST" | "DEEPTHINKING",
 *     "scopeMode":  "OWNER_ONLY" | "GENERAL",
 *     "ext":        { currentPageUrl?, currentPagePattern?, pageContextText?, pageTitle? },
 *     "userEmail":  string?
 *   }
 *
 * Implementation notes:
 *  - The full `kb_documents` table (~45 KB, 106 rows) is fetched on demand
 *    and cached in process memory for 5 minutes. This costs one Supabase
 *    round-trip per cold start — trivial for our scale.
 *  - Gemini's `streamGenerateContent` endpoint is invoked with
 *    `alt=sse` so we can pipe its chunks through with minimal massaging.
 *  - Hidden "thinking" tokens are disabled (thinkingBudget=0) to make
 *    first-token latency match the user expectation for a chat widget.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_RAG_MODEL || "gemini-2.5-flash";
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

const KB_CACHE_TTL_MS = 5 * 60 * 1000;
let _kbCache = { rows: null, ts: 0 };

function getSupabase() {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not configured");
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!key) throw new Error("No Supabase key configured");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadKbRows() {
  const now = Date.now();
  if (_kbCache.rows && now - _kbCache.ts < KB_CACHE_TTL_MS) {
    return _kbCache.rows;
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from("kb_documents")
    .select("id,content,metadata");
  if (error) throw new Error(`Supabase kb_documents fetch failed: ${error.message}`);
  _kbCache = { rows: data || [], ts: now };
  return _kbCache.rows;
}

function buildContextBlock(rows) {
  // Each entry is short (avg ~430 chars); just enumerate them.
  const lines = [];
  rows.forEach((r, i) => {
    const meta = r.metadata || {};
    const tag = meta.type || meta.doc_type || "kb";
    lines.push(`### [${i + 1}] type=${tag}`);
    lines.push(String(r.content || "").trim());
    lines.push("");
  });
  return lines.join("\n");
}

function buildSystemPrompt(rows, pageCtx) {
  const ctx = buildContextBlock(rows);
  const pageBlock = pageCtx
    ? `\nThe user is currently viewing the page "${pageCtx.pageTitle || ""}" (${pageCtx.currentPageUrl || ""}). When relevant, refer to what is on that page.\n`
    : "";
  return `You are Yuqi Guo's portfolio assistant.

Answer the user's question using ONLY the knowledge base entries below.
- If the knowledge base does not contain the answer, say so politely (in the user's language) and suggest what the user could ask instead.
- Reply in the SAME LANGUAGE the user used. If the user mixes languages, prefer English.
- Be concise (1–3 short paragraphs). Use Markdown for structure when it helps.
- Never invent facts about Yuqi that are not present in the knowledge base.
- Do not mention "knowledge base" or "context" explicitly — just answer naturally.
${pageBlock}
=== KNOWLEDGE BASE (${rows.length} entries) ===
${ctx}
=== END KNOWLEDGE BASE ===`;
}

function sseWrite(res, payload) {
  res.write(`event: message\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export const config = {
  api: {
    // Disable Next.js automatic response buffering for streaming.
    responseLimit: false,
    bodyParser: { sizeLimit: "1mb" },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { question, ext, conversationHistory } = req.body || {};
  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "question is required" });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
  }

  // SSE response headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering
  });
  // Force-flush headers
  res.write(": ok\n\n");
  if (typeof res.flush === "function") res.flush();

  let upstream;
  let finalText = "";

  try {
    // --- Stage: retrieval -------------------------------------------------
    // Surface the KB load in the widget's logic-chain timeline.
    const cacheHit =
      _kbCache.rows && Date.now() - _kbCache.ts < KB_CACHE_TTL_MS;
    const rows = await loadKbRows();
    const totalChars = rows.reduce(
      (acc, r) => acc + String(r?.content || "").length,
      0,
    );
    sseWrite(res, {
      stage: "retrieval",
      message: `Loaded ${rows.length} knowledge-base entries (${(
        totalChars / 1024
      ).toFixed(1)} KB) ${cacheHit ? "from cache" : "from Supabase"}`,
      payload: {
        docCount: rows.length,
        totalChars,
        cached: !!cacheHit,
        source: "supabase:kb_documents",
      },
    });
    if (typeof res.flush === "function") res.flush();

    const systemPrompt = buildSystemPrompt(rows, ext || null);

    // Build multi-turn contents[]. History turns go first so Gemini can
    // resolve pronouns and follow-up questions ("what about his education?").
    // Gemini requires alternating user/model turns — filter out back-to-back
    // same roles to stay within the API contract.
    const historyTurns = [];
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      for (const turn of conversationHistory) {
        const role = turn.role === "assistant" ? "model" : "user";
        const text = String(turn.content || "").trim();
        if (!text) continue;
        // Merge consecutive same-role turns into one part.
        const last = historyTurns[historyTurns.length - 1];
        if (last && last.role === role) {
          last.parts[0].text += "\n" + text;
        } else {
          historyTurns.push({ role, parts: [{ text }] });
        }
      }
    }
    // Gemini requires the final turn to be role=user.
    const contents = [
      ...historyTurns,
      { role: "user", parts: [{ text: question }] },
    ];

    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const url =
      `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}` +
      `:streamGenerateContent?alt=sse&key=${encodeURIComponent(GEMINI_API_KEY)}`;

    // --- Stage: generating ------------------------------------------------
    sseWrite(res, {
      stage: "generating",
      message: `Streaming answer from ${GEMINI_MODEL}`,
      payload: { model: GEMINI_MODEL, provider: "gemini" },
    });
    if (typeof res.flush === "function") res.flush();

    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const errBody = await upstream.text().catch(() => "");
      throw new Error(`Gemini HTTP ${upstream.status}: ${errBody.slice(0, 400)}`);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // Gemini's `alt=sse` stream uses CRLF SSE framing:
    //   data: { ...GenerateContentResponse... }\r\n\r\n
    // Normalize to LF before splitting on the blank-line frame separator.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;
          let chunk;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }
          const parts = chunk?.candidates?.[0]?.content?.parts || [];
          for (const p of parts) {
            const delta = typeof p?.text === "string" ? p.text : "";
            if (delta) {
              finalText += delta;
              sseWrite(res, { stage: "answer_delta", payload: { delta } });
              if (typeof res.flush === "function") res.flush();
            }
          }
        }
      }
    }

    if (!finalText) {
      finalText = "I couldn't generate a response for that. Try rephrasing your question.";
      sseWrite(res, { stage: "answer_delta", payload: { delta: finalText } });
    }

    sseWrite(res, { stage: "answer_final", payload: { answer: finalText } });
  } catch (err) {
    console.error("[rag/answer/stream]", err);
    const msg = `⚠️ RAG failed: ${err?.message || String(err)}`;
    try {
      sseWrite(res, { stage: "answer_delta", payload: { delta: msg } });
      sseWrite(res, { stage: "answer_final", payload: { answer: msg } });
    } catch {}
  } finally {
    try {
      res.write(`event: end\ndata: {}\n\n`);
      res.end();
    } catch {}
  }
}
