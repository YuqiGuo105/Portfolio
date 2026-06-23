/**
 * GET /api/rag/health
 *
 * Lightweight probe consumed by `resolveRagEndpoint` in ChatWidget.
 * Returns 200 when the Gemini key is configured so the widget will
 * route /api/rag/answer/stream through this server instead of falling
 * back to a (currently dead) external Railway service.
 */
export default function handler(req, res) {
  const ok = Boolean(process.env.GEMINI_API_KEY);
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "missing_gemini_key",
    backend: "gemini",
    model: process.env.GEMINI_RAG_MODEL || "gemini-2.5-flash",
  });
}
