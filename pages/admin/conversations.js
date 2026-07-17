import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, StatusPill, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { adminApi } from "../../src/lib/adminApi";

const WINDOWS = [
  { label: "24h", value: 24 },
  { label: "7d", value: 168 },
  { label: "30d", value: 720 },
];

const KIBANA_DASHBOARD = process.env.NEXT_PUBLIC_KIBANA_DASHBOARD_URL ||
  "https://console.aiven.io/account/a5c1cacf06ce/project/yuqi-791c/services/os-b4cbaea/opensearch";

export default function ConversationsPage() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [hours, setHours] = useState(168);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.conversations.list({ query, hours, limit: 100 });
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err.message || "Conversation activity could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [hours, query]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const summary = useMemo(() => ({
    completed: items.filter((item) => ["completed", "answered", "tool_completed"].includes(item.status)).length,
    blocked: items.filter((item) => item.status === "blocked").length,
    averageLatency: average(items.map((item) => item.latencyMs).filter(Number.isFinite)),
  }), [items]);

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Agent conversations"
          subtitle="Review user questions, final answers, route outcomes and latency from protected OpenSearch observability indexes."
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

        <section className={ui.metrics} aria-label="Conversation summary">
          <Metric label="Runs" value={items.length} hint={`Within ${windowLabel(hours)}`} />
          <Metric label="Completed" value={summary.completed} hint="Answered or tool completed" />
          <Metric label="Blocked" value={summary.blocked} hint="Safety policy outcomes" />
          <Metric label="Average latency" value={formatLatency(summary.averageLatency)} hint="Completed runs with timing" />
        </section>

        <section className={ui.panel}>
          <div className={ui.toolbar}>
            <div className={ui.searchWrap}>
              <Search className={ui.searchIcon} size={15} />
              <input
                className={ui.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search question, answer, session or run ID"
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

          <DataState loading={loading} error={error} empty={!loading && items.length === 0} onRetry={load}>
            <div>
              {items.map((item) => (
                <article className={ui.conversation} key={item.runId}>
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
                    <div className={ui.messageRole}>Assistant</div>
                    <p className={`${ui.messageText} ${!item.answer ? ui.answerMissing : ""}`}>
                      {item.answer || "Final answer was not captured by the event schema used for this older run."}
                    </p>
                  </div>
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

function Metric({ label, value, hint }) {
  return <div className={ui.metric}><div className={ui.metricLabel}>{label}</div><div className={ui.metricValue}>{value}</div><div className={ui.metricHint}>{hint}</div></div>;
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
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
