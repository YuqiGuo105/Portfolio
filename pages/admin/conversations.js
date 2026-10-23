import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Mic, RefreshCw, Search } from "lucide-react";
import dynamic from "next/dynamic";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, StatusPill, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { adminApi } from "../../src/lib/adminApi";
import { mergeConversationActivity } from "../../src/lib/voice/historyView.mjs";

const ChatMarkdown = dynamic(() => import("../../src/components/ChatMarkdown.mjs"));
const answerComponents = {
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ alt }) => <span>{alt || "[Image]"}</span>,
};

const WINDOWS = [
  { label: "24h", value: 24 },
  { label: "7d", value: 168 },
  { label: "30d", value: 720 },
];

const KIBANA_DASHBOARD = process.env.NEXT_PUBLIC_KIBANA_DASHBOARD_URL ||
  "https://os-79250b0-yguo105-17e7.l.aivencloud.com/app/data-explorer/discover#?" +
  "_a=(discover:(columns:!(_source),isDirty:!f,sort:!()),metadata:(indexPattern:ai-all,view:discover))" +
  "&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-7d,to:now))" +
  "&_q=(filters:!(),query:(language:kuery,query:''))";

export default function ConversationsPage() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [hours, setHours] = useState(168);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceScope, setVoiceScope] = useState(null);
  const requestState = useRef({ id: 0 }).current;

  const load = useCallback(async () => {
    const id = ++requestState.id;
    setLoading(true);
    setError("");
    setVoiceError("");
    setVoiceScope(null);
    setSummary(null);
    const [agent, voice] = await Promise.allSettled([
      adminApi.conversations.list({ query, hours, limit: 100 }),
      adminApi.voiceConversations.list({ query, hours, limit: 100 }),
    ]);
    if (id !== requestState.id) return;
    const agentItems = agent.status === "fulfilled" && Array.isArray(agent.value.items) ? agent.value.items : [];
    const voiceItems = voice.status === "fulfilled" && Array.isArray(voice.value.items) ? voice.value.items : [];
    if (agent.status === "fulfilled") setSummary(agent.value.summary || summarizeItems(agentItems));
    else setError(agent.reason?.message || "Agent activity could not be loaded.");
    if (voice.status === "fulfilled") setVoiceScope(voice.value.scope);
    else setVoiceError(voice.reason?.message || "Voice call history could not be loaded.");
    setItems(mergeConversationActivity(agentItems, voiceItems));
    setLoading(false);
  }, [hours, query, requestState]);

  useEffect(() => {
    // Invalidate the previous filters immediately, including the debounce interval.
    ++requestState.id;
    setLoading(true);
    const timer = setTimeout(load, 250);
    return () => { clearTimeout(timer); ++requestState.id; };
  }, [load, requestState]);

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Conversations"
          subtitle="Agent responses, execution records and voice transcripts."
          actions={(
            <>
              <button className={ui.buttonSecondary} type="button" onClick={load} disabled={loading}>
                <RefreshCw size={15} /> Refresh
              </button>
              <a className={ui.buttonPrimary} href={KIBANA_DASHBOARD} target="_blank" rel="noreferrer">
                Open Kibana <ExternalLink size={15} />
              </a>
            </>
          )}
        />

        <section className={ui.metrics} aria-label="Agent run summary">
          <Metric label="Agent runs" value={summary?.runs ?? "—"} hint={`Within ${windowLabel(hours)}`} />
          <Metric label="Completed" value={summary?.completed ?? "—"} hint="Answered or tool completed" />
          <Metric label="Blocked" value={summary?.blocked ?? "—"} hint="Safety policy outcomes" />
          <Metric label="Average latency" value={formatLatency(summary?.averageLatencyMs)} hint="Completed agent runs with timing" />
        </section>

        <section className={ui.panel}>
          <div className={ui.toolbar}>
            <div className={ui.searchWrap}>
              <Search className={ui.searchIcon} size={15} />
              <input
                className={ui.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search transcript, answer or ID"
                aria-label="Search conversations"
              />
            </div>
            <div className={ui.segmented} aria-label="Conversation time range">
              {WINDOWS.map((window) => (
                <button
                  key={window.value}
                  type="button"
                  className={`${ui.segment} ${hours === window.value ? ui.segmentActive : ""}`}
                  onClick={() => setHours(window.value)}
                >
                  {window.label}
                </button>
              ))}
            </div>
          </div>

          {!loading && error && <div className={ui.errorBanner} role="alert">Agent records unavailable: {error}</div>}
          {!loading && voiceError && <div className={ui.errorBanner} role="alert">Voice records unavailable: {voiceError}</div>}
          {!loading && voiceScope && <p className={ui.sectionMeta} style={{ margin: "12px 16px", lineHeight: 1.6 }}>
            Voice scope: latest {voiceScope.callLimit} calls started within {windowLabel(voiceScope.hours)}; first {voiceScope.messageLimitPerCall} saved messages per call, including drafts.
            {" "}Search matches call/message IDs or transcript text (case-insensitive). Local calls included.
          </p>}
          <DataState loading={loading} error={items.length === 0 ? error || voiceError : ""} empty={!loading && !error && !voiceError && items.length === 0} onRetry={load}>
            <div>
              {items.map((item) => item.kind === "voice" ? <VoiceConversation item={item} key={`voice:${item.id}`} /> : (
                <article className={ui.conversation} key={`agent:${item.runId}`}>
                  <div className={ui.conversationHeader}>
                    <div className={ui.conversationMeta}>
                      <StatusPill value={item.status || "running"} />
                      <span>{formatDateTime(item.startedAt || item.completedAt)}</span>
                      <span>{formatLatency(item.latencyMs)}</span>
                      {item.route && <span>{item.route}</span>}
                    </div>
                    <span className={ui.mono}>run {shortId(item.runId)}</span>
                  </div>
                  <div className={ui.messagePair}>
                    <div className={ui.messageRole}>User</div>
                    <p className={ui.messageText}>{item.question || "Question not captured for this run."}</p>
                  </div>
                  <FinalResponse item={item} />
                  {item.steps && item.steps.length > 0 && (
                    <details style={{ marginTop: "8px", fontSize: "13px" }}>
                      <summary style={{ cursor: "pointer", color: "#6b7280", fontWeight: 500 }}>
                        Pipeline steps ({item.steps.length})
                      </summary>
                      <div style={{ marginTop: "6px", borderLeft: "2px solid #e5e7eb", paddingLeft: "12px" }}>
                        {item.steps.map((step, i) => (
                          <div key={i} style={{ marginBottom: "6px", lineHeight: "1.5" }}>
                            <span style={{ fontWeight: 500, color: stepColor(step.type) }}>{stepLabel(step.type)}</span>
                            {step.latencyMs != null && <span style={{ color: "#9ca3af", marginLeft: "8px" }}>{formatLatency(step.latencyMs)}</span>}
                            {step.status && <span style={{ marginLeft: "8px", opacity: 0.7 }}>{step.status}</span>}
                            {step.detail && Object.keys(step.detail).length > 0 && (
                              <pre style={{ margin: "2px 0 0", fontSize: "11px", color: "#6b7280", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: "120px", overflow: "auto" }}>
                                {JSON.stringify(step.detail, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className={ui.conversationMeta}>
                    {item.sessionId && <span className={ui.mono}>session {shortId(item.sessionId)}</span>}
                    {item.conversationId && <span className={ui.mono}>conversation {shortId(item.conversationId)}</span>}
                  </div>
                </article>
              ))}
            </div>
          </DataState>
        </section>
      </div>
    </AdminLayout>
  );
}

function VoiceConversation({ item }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={ui.conversation}>
      <div className={ui.conversationHeader}>
        <div className={ui.conversationMeta}>
          <span className={`${ui.status} ${ui.statusArchived}`}><Mic size={12} aria-hidden="true" /> Voice{item.providers.length ? ` / ${item.providers.join(", ")}` : ""}</span>
          <StatusPill value={item.status} />
          {item.environment === "development" && <span className={`${ui.status} ${ui.statusDraft}`}>Local</span>}
          <span>{formatDateTime(item.startedAt)}</span>
          <span>{item.durationMs == null ? (item.status === "active" ? "Call duration pending" : "Call duration unavailable") : `Call duration ${formatCallDuration(item.durationMs)}`}</span>
        </div>
        <span className={ui.mono} title={item.id}>call {shortId(item.id)}</span>
      </div>
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary style={{ cursor: "pointer", color: "#6b7280", fontSize: "13px", fontWeight: 500 }}>
          Transcript ({item.messages.length}{item.transcriptLimitReached ? "+" : ""} saved turns)
        </summary>
        {expanded && <div style={{ display: "grid", gap: "12px", marginTop: "12px", minWidth: 0 }}>
          <p className={ui.sectionMeta} style={{ margin: 0 }}>Generated assistant text does not confirm audio playback or that the caller heard it.</p>
          {item.transcriptLimitReached && <p className={ui.sectionMeta} style={{ margin: 0 }}>Transcript limit reached. Only the first 500 saved messages are available in this view and search.</p>}
          {!item.messages.length && <p className={ui.answerMissing}>No transcript saved for this call.</p>}
          {item.messages.map((message) => (
            <div className={ui.messagePair} key={message.id} style={{ minWidth: 0 }}>
              <div className={ui.messageRole}>{message.role === "user" ? "User" : "Assistant"}</div>
              <div style={{ minWidth: 0 }}>
                <div className={ui.conversationMeta} style={{ overflowWrap: "anywhere", marginBottom: "4px" }}>
                  <span>{formatDateTime(message.createdAt)}</span>
                  <span>{completionLabel(message.completion)}</span>
                  {message.truncated && <span>Text truncated at capture</span>}
                  {message.provider && <span>{message.provider}</span>}
                  {message.model && <span>{message.model}</span>}
                  {message.pagePath && <span>{message.pagePath}</span>}
                </div>
                <p className={ui.messageText} style={{ overflowWrap: "anywhere" }}>{message.content || (message.completion === "pending" ? "Transcript pending." : "No text saved for this turn.")}</p>
              </div>
            </div>
          ))}
        </div>}
      </details>
    </article>
  );
}

function completionLabel(completion) {
  return { transcribed: "Transcribed", generated: "Generated (playback unconfirmed)", interrupted: "Interrupted", "call-ended": "Call ended", pending: "Pending draft / streaming" }[completion] || "Completion unknown";
}

function formatCallDuration(value) {
  const seconds = Math.floor(value / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function FinalResponse({ item }) {
  const [copyState, setCopyState] = useState("");
  const answer = typeof item.answer === "string" && item.answer.trim() ? item.answer : null;
  const running = !item.completedAt && ["running", "pending", "streaming"].includes(item.status || "running");
  useEffect(() => {
    if (!copyState) return;
    const timer = setTimeout(() => setCopyState(""), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(answer);
      setCopyState("Copied");
    } catch {
      setCopyState("Copy failed. Select the response to copy it.");
    }
  }
  return (
    <section className={ui.finalResponse} aria-label="Final response">
      <div className={ui.responseHeader}>
        <h2>Final response</h2>
        {answer && <button className={ui.responseCopy} type="button" onClick={copy} aria-label="Copy final response" title="Copy final response">
          {copyState === "Copied" ? <Check size={16} /> : <Copy size={16} />}
        </button>}
      </div>
      {copyState && <span className={ui.conversationMeta} role="status">{copyState}</span>}
      {answer ? <div className={ui.responseBody}><ChatMarkdown content={answer} components={answerComponents} /></div>
        : <p className={ui.answerMissing}>{running
          ? "The agent has not recorded a final response yet. Refresh to check this run."
          : "No final response was saved for this run. Execution steps are available below when recorded."}</p>}
    </section>
  );
}

function Metric({ label, value, hint }) {
  return <div className={ui.metric}><div className={ui.metricLabel}>{label}</div><div className={ui.metricValue}>{value}</div><div className={ui.metricHint}>{hint}</div></div>;
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function summarizeItems(items) {
  const incompleteStatuses = new Set([
    "blocked",
    "failed",
    "budget_exhausted",
    "forbidden",
    "unauthorized",
    "rate_limited",
    "cancelled",
  ]);
  const completedItems = items.filter((item) =>
    item.completedAt && !incompleteStatuses.has(String(item.status || "").toLowerCase()),
  );
  return {
    runs: items.length,
    completed: completedItems.length,
    blocked: items.filter((item) => String(item.status || "").toLowerCase() === "blocked").length,
    averageLatencyMs: average(completedItems.map((item) => item.latencyMs).filter(Number.isFinite)),
  };
}

function formatLatency(value) {
  if (!Number.isFinite(value)) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function formatDateTime(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function shortId(value) {
  const text = String(value || "");
  return text.length > 12 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
}

function windowLabel(hours) {
  if (hours === 24) return "24 hours";
  if (hours === 168) return "7 days";
  return "30 days";
}

function stepLabel(type) {
  const labels = {
    "model_call.completed": "Model call",
    "retrieval.completed": "Knowledge retrieval",
    "safety.check_completed": "Safety check",
    "safety.checked": "Safety check",
    "tool_call.completed": "Tool call",
  };
  return labels[type] || type;
}

function stepColor(type) {
  const colors = {
    "model_call.completed": "#2563eb",
    "retrieval.completed": "#059669",
    "safety.check_completed": "#d97706",
    "safety.checked": "#d97706",
    "tool_call.completed": "#7c3aed",
  };
  return colors[type] || "#374151";
}
