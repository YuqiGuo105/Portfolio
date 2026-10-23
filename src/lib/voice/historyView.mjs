export const VOICE_CHANNELS = Object.freeze(["voice", "voice-local"]);
export const VOICE_MAX_HOURS = 30 * 24;
export const VOICE_MAX_CALLS = 100;
export const VOICE_MAX_MESSAGES = 500;

const TERMINAL_STATUSES = new Set(["completed", "interrupted", "failed"]);
const COMPLETIONS = new Set(["transcribed", "generated", "interrupted", "call-ended"]);

function boundedInteger(value, fallback, max) {
  if (Array.isArray(value) || value == null || String(value).trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(1, Math.floor(number))) : fallback;
}

function timestamp(value) {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function metadataOf(message) {
  const value = message?.metadata_json;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function voiceHistoryOptions(params = {}, now = Date.now()) {
  const hours = boundedInteger(params.hours, 168, VOICE_MAX_HOURS);
  return {
    hours,
    limit: boundedInteger(params.limit, 50, VOICE_MAX_CALLS),
    query: typeof params.q === "string" ? params.q.trim() : "",
    from: new Date(now - hours * 60 * 60 * 1000).toISOString(),
    to: new Date(now).toISOString(),
  };
}

export function compareVoiceMessages(a, b) {
  const timeA = timestamp(a.created_at);
  const timeB = timestamp(b.created_at);
  const timeOrder = (Number.isFinite(timeA) ? timeA : Infinity) - (Number.isFinite(timeB) ? timeB : Infinity);
  if (timeOrder) return timeOrder;
  const sequenceA = metadataOf(a).sequence;
  const sequenceB = metadataOf(b).sequence;
  const sequenceOrder = (Number.isSafeInteger(sequenceA) ? sequenceA : Infinity) -
    (Number.isSafeInteger(sequenceB) ? sequenceB : Infinity);
  return sequenceOrder || compareText(String(a.id || ""), String(b.id || ""));
}

export function mapVoiceConversation(row) {
  if (!row || !VOICE_CHANNELS.includes(row.channel) || typeof row.id !== "string" || !row.id) return null;
  const rows = Array.isArray(row.messages) ? row.messages : [];
  const messages = rows.slice().sort(compareVoiceMessages).slice(0, VOICE_MAX_MESSAGES)
    .filter((message) => ["user", "assistant"].includes(message.role) &&
      (!message.conversation_id || message.conversation_id === row.id))
    .map((message) => {
      const metadata = metadataOf(message);
      const pending = metadata.streaming === true || metadata.pending === true || metadata.draft === true ||
        ["streaming", "pending", "draft"].includes(metadata.completion);
      return {
        id: message.id,
        role: message.role,
        content: typeof message.content === "string" ? message.content : "",
        createdAt: message.created_at || null,
        sequence: Number.isSafeInteger(metadata.sequence) ? metadata.sequence : null,
        provider: ["Qwen", "Google"].includes(metadata.provider) ? metadata.provider : null,
        model: typeof metadata.model === "string" ? metadata.model : null,
        pagePath: typeof metadata.pagePath === "string" ? metadata.pagePath : null,
        truncated: metadata.truncated === true,
        completion: pending ? "pending" : COMPLETIONS.has(metadata.completion) ? metadata.completion : "unknown",
      };
    });
  const started = timestamp(row.created_at);
  const ended = timestamp(row.updated_at);
  const terminal = TERMINAL_STATUSES.has(row.status);
  // The writer closes a call by setting its terminal status and updated_at to the call end.
  const durationMs = terminal && Number.isFinite(started) && Number.isFinite(ended) && ended >= started
    ? ended - started : null;
  return {
    kind: "voice",
    id: row.id,
    conversationId: row.id,
    channel: row.channel,
    environment: row.channel === "voice-local" ? "development" : "production",
    status: terminal || row.status === "active" ? row.status : "unknown",
    startedAt: row.created_at || null,
    endedAt: terminal && Number.isFinite(ended) ? row.updated_at : null,
    durationMs,
    providers: [...new Set(messages.map((message) => message.provider).filter(Boolean))],
    messages,
    // At exactly the cap we cannot claim that the transcript is complete.
    transcriptLimitReached: rows.length >= VOICE_MAX_MESSAGES,
  };
}

export function voiceConversationMatches(item, query) {
  const needle = String(query || "").trim().toLowerCase();
  return !needle || [item.id, ...item.messages.flatMap((message) => [message.id, message.content])]
    .some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}

export function voiceHistoryResponse(rows, options) {
  const from = timestamp(options.from);
  const to = timestamp(options.to);
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => VOICE_CHANNELS.includes(row.channel) && timestamp(row.created_at) >= from && timestamp(row.created_at) <= to)
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at) || compareText(String(a.id), String(b.id)))
    .slice(0, Math.min(VOICE_MAX_CALLS, options.limit));
  return {
    items: candidates.map(mapVoiceConversation).filter(Boolean).filter((item) => voiceConversationMatches(item, options.query)),
    scope: {
      from: options.from,
      to: options.to,
      hours: options.hours,
      callLimit: options.limit,
      messageLimitPerCall: VOICE_MAX_MESSAGES,
      scannedCalls: candidates.length,
      callLimitReached: candidates.length >= options.limit,
      search: "case-insensitive-substring-in-call-id-message-id-or-transcript",
    },
  };
}

export function mergeConversationActivity(agentItems, voiceItems) {
  return [...agentItems, ...voiceItems].sort((a, b) => {
    const aTime = timestamp(a.startedAt || a.completedAt);
    const bTime = timestamp(b.startedAt || b.completedAt);
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0) ||
      compareText(String(a.runId || a.id || ""), String(b.runId || b.id || ""));
  });
}
