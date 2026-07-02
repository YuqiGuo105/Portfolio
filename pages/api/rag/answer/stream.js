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
 *
 * === 2026-07 新增功能 ===
 *  - scopeMode="GENERAL" (deep thinking) 时启用 Gemini google_search
 *    grounding，允许回答通识问题并附带来源卡片。
 *  - 流结束前通过 OpenSearch 检索相关博客/项目，以 related_links 帧
 *    推送给前端 RelatedLinks 组件展示。
 */
import { createClient } from "@supabase/supabase-js";
import { searchItems } from "../../src/lib/searchItems";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_RAG_MODEL || "gemini-2.5-flash";
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

// 联网检索开关（环境变量控制，方便降级）
const WEB_SEARCH_ENABLED =
  (process.env.RAG_WEB_SEARCH_ENABLED ?? "true").toLowerCase() !== "false";

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

function buildSystemPrompt(rows, pageCtx, scopeMode) {
  const ctx = buildContextBlock(rows);
  const pageBlock = pageCtx
    ? `\nThe user is currently viewing the page "${pageCtx.pageTitle || ""}" (${pageCtx.currentPageUrl || ""}). When relevant, refer to what is on that page.\n`
    : "";

  // GENERAL 模式：允许用通用知识和联网检索回答任意问题，但对 Yuqi 相关内容仍以 KB 为准
  if (scopeMode === "GENERAL") {
    return `You are Yuqi Guo's portfolio assistant. You can answer both questions about Yuqi AND general knowledge questions.

RULES:
- For questions about Yuqi Guo (his projects, skills, experience, education): answer ONLY from the knowledge base below. Never invent facts about Yuqi that are not in the knowledge base.
- For general questions unrelated to Yuqi (technology concepts, current events, explanations): use your general knowledge and web search results freely.
- When you use web search results, naturally cite the source in your answer.
- Reply in the SAME LANGUAGE the user used. If the user mixes languages, prefer English.
- Be concise (1–3 short paragraphs). Use Markdown for structure when it helps.
- Do not mention "knowledge base" or "context" explicitly — just answer naturally.
${pageBlock}
=== KNOWLEDGE BASE (${rows.length} entries) ===
${ctx}
=== END KNOWLEDGE BASE ===`;
  }

  // OWNER_ONLY 模式（默认/fast）：仅基于知识库回答
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

  const { question, ext, conversationHistory, scopeMode: rawScope } = req.body || {};
  // 默认 OWNER_ONLY 保持向后兼容
  const scopeMode = rawScope === "GENERAL" ? "GENERAL" : "OWNER_ONLY";

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

    const systemPrompt = buildSystemPrompt(rows, ext || null, scopeMode);

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
        // GENERAL 模式启用 grounding 时不能同时用 thinkingConfig
        ...(scopeMode === "GENERAL" && WEB_SEARCH_ENABLED
          ? {}
          : { thinkingConfig: { thinkingBudget: 0 } }),
      },
      // GENERAL 模式且联网开启时，添加 google_search grounding 工具
      ...(scopeMode === "GENERAL" && WEB_SEARCH_ENABLED
        ? { tools: [{ google_search: {} }] }
        : {}),
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

    // 收集 Gemini grounding 来源元数据（联网检索时返回）
    const groundingSources = [];

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
          const candidate = chunk?.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          for (const p of parts) {
            const delta = typeof p?.text === "string" ? p.text : "";
            if (delta) {
              finalText += delta;
              sseWrite(res, { stage: "answer_delta", payload: { delta } });
              if (typeof res.flush === "function") res.flush();
            }
          }
          // 提取 grounding 元数据（Gemini google_search 返回的网页来源）
          const gm = candidate?.groundingMetadata;
          if (gm?.groundingChunks) {
            for (const gc of gm.groundingChunks) {
              const web = gc?.web;
              if (web?.uri) {
                groundingSources.push({ uri: web.uri, title: web.title || "" });
              }
            }
          }
        }
      }
    }

    if (!finalText) {
      finalText = "I couldn't generate a response for that. Try rephrasing your question.";
      sseWrite(res, { stage: "answer_delta", payload: { delta: finalText } });
    }

    // --- 发送 sources_found 帧：Gemini 联网来源卡片 ---
    if (groundingSources.length > 0) {
      // 去重（按 URI）
      const seen = new Set();
      const dedupedSources = [];
      for (const s of groundingSources) {
        if (seen.has(s.uri)) continue;
        seen.add(s.uri);
        dedupedSources.push({
          id: `web-${dedupedSources.length}`,
          type: "web",
          title: s.title || new URL(s.uri).hostname,
          url: s.uri,
        });
      }
      if (dedupedSources.length > 0) {
        sseWrite(res, {
          stage: "sources_found",
          payload: { sources: dedupedSources.slice(0, 5) },
        });
        if (typeof res.flush === "function") res.flush();
      }
    }

    // --- 发送 related_links 帧：从 OpenSearch 检索相关博客/项目 ---
    try {
      const { results } = await searchItems({ q: question, limit: 5 });
      // 只保留博客和项目类型，且有有效 URL
      const MIN_SCORE = 1.0; // 最低相关性阈值，低于此分不推荐
      const links = results
        .filter((r) => {
          const st = (r.source || "").toLowerCase();
          return (
            (st === "blog" || st === "life" || st === "projects") &&
            r.url &&
            (r.rank ?? 0) >= MIN_SCORE
          );
        })
        .slice(0, 4)
        .map((r) => ({
          type: r.source === "Projects" ? "project" : "blog",
          id: r.sourceId,
          title: r.title || "Untitled",
          url: r.url,
          snippet: r.description || "",
          relevanceScore: r.rank ?? 0,
        }));
      if (links.length > 0) {
        sseWrite(res, { stage: "related_links", payload: { links } });
        if (typeof res.flush === "function") res.flush();
      }
    } catch (searchErr) {
      // fail-open：OpenSearch 不可用时不影响正常答案
      console.warn("[rag/stream] OpenSearch related_links 检索失败:", searchErr?.message);
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
