/**
 * POST /api/rag/answer/stream
 *
 * SSE 端点：自动判断用户问题类型（通识 / 个人作品集），选择合适策略回答。
 *
 *   - OWNER_ONLY（个人相关）：用完整知识库回答，不联网。
 *   - GENERAL（通识问题）：用 Gemini google_search grounding 联网回答，
 *     不注入大量 KB 避免超限。
 *
 * 流结束前通过 OpenSearch 检索相关博客/项目，以 related_links 帧推送。
 */
import { createClient } from "@supabase/supabase-js";
import { searchItems } from "../../../../src/lib/searchItems";

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

// ─── 自动分类：判断问题是否与 Yuqi / 作品集相关 ───────────────────────
const OWNER_PATTERNS = [
  /\byuqi\b/i,
  /\bguo\b/i,
  /\byour\s+(project|portfolio|resume|cv|skill|experience|education|work|intern|blog|tech\s*stack)/i,
  /\b(tell\s+me\s+about\s+you|who\s+are\s+you|introduce\s+yourself)\b/i,
  /\b(portfolio|作品集|简历|履历)\b/i,
  /\b(talknest|gift\s*galaxy|polyglotbot|curastone)\b/i,
  /\b(你的|你做过|你会|你的经[历验]|你学)\b/,
];

function classifyQuestion(question) {
  const q = question.trim();
  for (const pat of OWNER_PATTERNS) {
    if (pat.test(q)) return "OWNER_ONLY";
  }
  return "GENERAL";
}

// ─── Supabase helpers ─────────────────────────────────────────────────
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
  if (error) throw new Error("Supabase kb_documents fetch failed: " + error.message);
  _kbCache = { rows: data || [], ts: now };
  return _kbCache.rows;
}

function buildContextBlock(rows) {
  const lines = [];
  rows.forEach((r, i) => {
    const meta = r.metadata || {};
    const tag = meta.type || meta.doc_type || "kb";
    lines.push("### [" + (i + 1) + "] type=" + tag);
    lines.push(String(r.content || "").trim());
    lines.push("");
  });
  return lines.join("\n");
}

// ─── System prompts ───────────────────────────────────────────────────
function buildOwnerPrompt(rows, pageCtx) {
  const ctx = buildContextBlock(rows);
  const pageBlock = pageCtx
    ? "\nThe user is currently viewing the page \"" + (pageCtx.pageTitle || "") + "\" (" + (pageCtx.currentPageUrl || "") + "). When relevant, refer to what is on that page.\n"
    : "";

  return "You are Yuqi Guo's portfolio assistant.\n\nAnswer the user's question using ONLY the knowledge base entries below.\n- If the knowledge base does not contain the answer, say so politely (in the user's language) and suggest what the user could ask instead.\n- Reply in the SAME LANGUAGE the user used. If the user mixes languages, prefer English.\n- Be concise (1-3 short paragraphs). Use Markdown for structure when it helps.\n- Never invent facts about Yuqi that are not present in the knowledge base.\n- Do not mention \"knowledge base\" or \"context\" explicitly - just answer naturally.\n" + pageBlock + "\n=== KNOWLEDGE BASE (" + rows.length + " entries) ===\n" + ctx + "\n=== END KNOWLEDGE BASE ===";
}

function buildGeneralPrompt(pageCtx) {
  const pageBlock = pageCtx
    ? "\nThe user is currently viewing Yuqi Guo's portfolio page \"" + (pageCtx.pageTitle || "") + "\" (" + (pageCtx.currentPageUrl || "") + "). Keep this context in mind.\n"
    : "";

  return "You are Yuqi Guo's portfolio assistant, but you can answer general knowledge questions too.\n\nRULES:\n- Use your general knowledge and web search results to answer the question.\n- When you use web search results, naturally cite the source in your answer.\n- Reply in the SAME LANGUAGE the user used. If the user mixes languages, prefer English.\n- Be concise (1-3 short paragraphs). Use Markdown for structure when it helps.\n- If the question is about Yuqi Guo specifically, say you'd be happy to answer portfolio-related questions and suggest they ask about his projects, skills, or experience.\n" + pageBlock;
}

// ─── SSE helpers ──────────────────────────────────────────────────────
function sseWrite(res, payload) {
  res.write("event: message\n");
  res.write("data: " + JSON.stringify(payload) + "\n\n");
}

export const config = {
  api: {
    responseLimit: false,
    bodyParser: { sizeLimit: "1mb" },
  },
};

// ─── Handler ──────────────────────────────────────────────────────────
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

  // 自动分类
  const scopeMode = classifyQuestion(question);
  const useWebSearch = scopeMode === "GENERAL" && WEB_SEARCH_ENABLED;

  // SSE response headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": ok\n\n");
  if (typeof res.flush === "function") res.flush();

  let upstream;
  let finalText = "";

  try {
    // --- Stage: retrieval -------------------------------------------------
    const cacheHit =
      _kbCache.rows && Date.now() - _kbCache.ts < KB_CACHE_TTL_MS;
    const rows = await loadKbRows();
    const totalChars = rows.reduce(
      (acc, r) => acc + String(r?.content || "").length,
      0,
    );
    sseWrite(res, {
      stage: "retrieval",
      message: scopeMode === "OWNER_ONLY"
        ? "Loaded " + rows.length + " knowledge-base entries (" + (totalChars / 1024).toFixed(1) + " KB) " + (cacheHit ? "from cache" : "from Supabase")
        : "General question detected - using web search" + (cacheHit ? "" : " (KB cached)"),
      payload: {
        docCount: rows.length,
        totalChars,
        cached: !!cacheHit,
        source: "supabase:kb_documents",
        scopeMode,
      },
    });
    if (typeof res.flush === "function") res.flush();

    // 根据分类结果构建不同的 system prompt
    const systemPrompt = scopeMode === "OWNER_ONLY"
      ? buildOwnerPrompt(rows, ext || null)
      : buildGeneralPrompt(ext || null);

    // Build multi-turn contents[]
    const historyTurns = [];
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      for (const turn of conversationHistory) {
        const role = turn.role === "assistant" ? "model" : "user";
        const text = String(turn.content || "").trim();
        if (!text) continue;
        const last = historyTurns[historyTurns.length - 1];
        if (last && last.role === role) {
          last.parts[0].text += "\n" + text;
        } else {
          historyTurns.push({ role, parts: [{ text }] });
        }
      }
    }
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
      ...(useWebSearch ? { tools: [{ google_search: {} }] } : {}),
    };

    const url =
      GEMINI_BASE_URL + "/models/" + encodeURIComponent(GEMINI_MODEL) +
      ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(GEMINI_API_KEY);

    // --- Stage: generating ------------------------------------------------
    sseWrite(res, {
      stage: "generating",
      message: "Streaming answer from " + GEMINI_MODEL + (useWebSearch ? " + web search" : ""),
      payload: { model: GEMINI_MODEL, provider: "gemini", webSearch: useWebSearch },
    });
    if (typeof res.flush === "function") res.flush();

    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const errBody = await upstream.text().catch(() => "");
      throw new Error("Gemini HTTP " + upstream.status + ": " + errBody.slice(0, 400));
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // 收集 Gemini grounding 来源元数据
    const groundingSources = [];

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
            if (p.thought) continue;
            const delta = typeof p?.text === "string" ? p.text : "";
            if (delta) {
              finalText += delta;
              sseWrite(res, { stage: "answer_delta", payload: { delta } });
              if (typeof res.flush === "function") res.flush();
            }
          }
          // 提取 grounding 元数据
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
      const seen = new Set();
      const dedupedSources = [];
      for (const s of groundingSources) {
        if (seen.has(s.uri)) continue;
        seen.add(s.uri);
        dedupedSources.push({
          id: "web-" + dedupedSources.length,
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
      const MIN_SCORE = 1.0;
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
      console.warn("[rag/stream] OpenSearch related_links failed:", searchErr?.message);
    }

    sseWrite(res, { stage: "answer_final", payload: { answer: finalText } });
  } catch (err) {
    console.error("[rag/answer/stream]", err);
    const msg = "\u26a0\ufe0f RAG failed: " + (err?.message || String(err));
    try {
      sseWrite(res, { stage: "answer_delta", payload: { delta: msg } });
      sseWrite(res, { stage: "answer_final", payload: { answer: msg } });
    } catch {}
  } finally {
    try {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    } catch {}
  }
}
