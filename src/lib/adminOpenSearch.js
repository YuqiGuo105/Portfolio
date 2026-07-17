function config() {
  const host = process.env.OPENSEARCH_HOST;
  const port = process.env.OPENSEARCH_PORT || "443";
  const username = process.env.OPENSEARCH_USERNAME;
  const password = process.env.OPENSEARCH_PASSWORD;
  if (!host || !username || !password) {
    throw new Error("OpenSearch admin query is not configured.");
  }
  return { host, port, username, password };
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function eventTypeQuery() {
  const values = [
    "agent_run.started",
    "agent_run.completed",
    "answer.generated",
    "answer.blocked",
    "model_call.completed",
    "retrieval.completed",
    "safety.checked",
    "tool_call.completed",
  ];
  return {
    bool: {
      should: [
        { terms: { "eventType.keyword": values } },
        { terms: { eventType: values } },
      ],
      minimum_should_match: 1,
    },
  };
}

export async function listAgentConversations({ query, hours, limit } = {}) {
  const safeHours = clampNumber(hours, 168, 1, 24 * 30);
  const safeLimit = clampNumber(limit, 50, 1, 100);
  const filters = [
    { range: { timestamp: { gte: `now-${safeHours}h` } } },
    eventTypeQuery(),
  ];
  const must = [];
  if (query && String(query).trim()) {
    must.push({
      simple_query_string: {
        query: String(query).trim(),
        fields: ["payload.question^3", "payload.answer^2", "payload.sessionId", "runId"],
        default_operator: "and",
      },
    });
  }

  const body = {
    size: Math.min(safeLimit * 10, 1000),
    sort: [{ timestamp: { order: "desc" } }],
    query: { bool: { filter: filters, must } },
    _source: true,
  };

  const { host, port, username, password } = config();
  const indices = process.env.OPENSEARCH_AGENT_INDEXES || "ai-*";
  const endpoint = `https://${host}:${port}/${indices}/_search?ignore_unavailable=true`;
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenSearch returned ${response.status}: ${detail.slice(0, 180)}`);
  }

  const data = await response.json();
  const grouped = new Map();
  for (const hit of data?.hits?.hits || []) {
    const source = hit?._source || {};
    const runId = source.runId || hit?._id;
    if (!runId) continue;
    const current = grouped.get(runId) || { runId, steps: [] };
    const payload = source.payload || {};

    if (source.eventType === "agent_run.started") {
      current.startedAt = source.timestamp;
      current.question = payload.question || "";
      current.sessionId = payload.sessionId || "";
      current.conversationId = payload.conversationId || "";
    } else if (source.eventType === "agent_run.completed") {
      current.completedAt = source.timestamp;
      current.status = payload.finalStatus || source.status || "completed";
      current.latencyMs = source.latencyMs ?? null;
    } else if (source.eventType === "answer.generated" || source.eventType === "answer.blocked") {
      current.answer = payload.answer || "";
      current.route = payload.route || "";
      current.status = source.status || current.status;
      current.latencyMs = source.latencyMs ?? current.latencyMs ?? null;
    } else {
      // Pipeline steps: model_call, retrieval, safety, tool_call
      current.steps.push({
        type: source.eventType,
        timestamp: source.timestamp,
        latencyMs: source.latencyMs ?? null,
        status: source.status || payload.verdict || null,
        detail: payload,
      });
    }
    grouped.set(runId, current);
  }

  // Sort steps within each run by timestamp
  for (const item of grouped.values()) {
    item.steps.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  }

  const items = Array.from(grouped.values())
    .filter((item) => item.question || item.answer)
    .sort((a, b) => String(b.startedAt || b.completedAt || "")
      .localeCompare(String(a.startedAt || a.completedAt || "")))
    .slice(0, safeLimit);

  return { items, total: items.length, hours: safeHours };
}
