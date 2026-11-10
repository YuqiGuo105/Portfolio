const STAGES = {
  safety_check: "Input safety", routing: "Intent", knowledge_retrieval: "Retrieval",
  generation: "Generation", answer_generation: "Generation", generating: "Generation", web_research: "Research",
  output_safety: "Output safety", browser_actions: "Page controls",
};
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

// A positive schema, not a blacklist. Prompts, raw args, reasoning and user identifiers never enter this view.
export function recordPublicRunEvent(previous = [], event) {
  const label = STAGES[event?.stage];
  if (!label || !["started", "completed", "failed"].includes(event.status)) return previous;
  const row = { stage: event.stage, label, status: event.status,
    durationMs: number(event.durationMs),
    inputTokens: number(event.payload?.usage?.inputTokens),
    outputTokens: number(event.payload?.usage?.outputTokens),
    costUsd: number(event.payload?.usage?.costUsd) };
  const index = previous.findIndex(item => item.stage === row.stage);
  return index < 0 ? [...previous, row].slice(0, 12) : previous.map((item, i) => i === index ? row : item);
}

export function publicEvidence(sources = []) {
  return sources.flatMap(source => {
    if (source?.sourceRequiresLogin || typeof source?.url !== "string") return [];
    try {
      const url = new URL(source.url, "https://www.yuqi.site");
      if (url.protocol !== "https:" || url.username || url.password || url.search
          || !["www.yuqi.site", "yuqi.site", "github.com"].includes(url.hostname)
          || url.pathname.startsWith("/admin") || url.pathname.startsWith("/api")) return [];
      return [{ url: url.href, title: String(source.title || url.hostname).slice(0, 120) }];
    } catch { return []; }
  }).slice(0, 8);
}
