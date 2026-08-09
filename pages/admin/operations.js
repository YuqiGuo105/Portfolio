import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitBranch, RefreshCw, Search, Server, Workflow } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { supabase } from "../../src/supabase/supabaseClient";
import styles from "../../src/components/admin/OperationsTimeline.module.css";

const WRITER_API = (process.env.NEXT_PUBLIC_WRITER_API_URL || "http://localhost:8081").replace(/\/+$/, "");

export default function OperationsTimelinePage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [data, setData] = useState({ events: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projectionUnavailable, setProjectionUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setProjectionUnavailable(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Admin session is not available.");
      const params = new URLSearchParams({ q: submittedQuery, limit: "300" });
      const response = await fetch(`${WRITER_API}/api/admin/operations/timeline?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      const projectionOffline = response.status === 503
        && body.error === "timeline_projection_unavailable";
      setProjectionUnavailable(projectionOffline);
      if (!response.ok) {
        const message = body.message || `Timeline query failed: ${response.status}`;
        throw new Error(projectionOffline ? `${message} Retrying automatically in 30 seconds.` : message);
      }
      setData(body);
    } catch (requestError) {
      setError(requestError.message || "Operations timeline could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [submittedQuery]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!projectionUnavailable) return undefined;
    const retry = window.setTimeout(load, 30_000);
    return () => window.clearTimeout(retry);
  }, [load, projectionUnavailable]);

  const events = useMemo(
    () => [...(data.events || [])].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)),
    [data.events]
  );
  const summary = data.summary || {};

  function submit(event) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  }

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Operations timeline"
          subtitle="Trace a request, content change, Kafka projection, alert or delivery across platform services."
          actions={(
            <button className={ui.buttonSecondary} type="button" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        />

        <section className={ui.metrics} aria-label="Timeline summary">
          <Metric icon={Workflow} label="Events" value={projectionUnavailable ? "—" : (summary.events ?? 0)} unavailable={projectionUnavailable} />
          <Metric icon={Server} label="Services" value={projectionUnavailable ? "—" : (summary.services ?? 0)} unavailable={projectionUnavailable} />
          <Metric icon={AlertTriangle} label="Failures" value={projectionUnavailable ? "—" : (summary.failures ?? 0)} danger={!projectionUnavailable && summary.failures > 0} unavailable={projectionUnavailable} />
          <Metric icon={GitBranch} label="Retries" value={projectionUnavailable ? "—" : (summary.retries ?? 0)} unavailable={projectionUnavailable} />
        </section>

        <section className={ui.panel}>
          <form className={styles.queryBar} onSubmit={submit}>
            <div className={ui.searchWrap}>
              <Search className={ui.searchIcon} size={16} />
              <input
                className={ui.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search run ID, event ID, content ID, session ID or correlation ID"
                aria-label="Search operations timeline"
              />
            </div>
            <button className={ui.buttonPrimary} type="submit" disabled={loading}>
              <Search size={15} /> Trace
            </button>
          </form>

          {data.correlationIds?.length > 0 && (
            <div className={styles.correlationStrip}>
              <span>Correlation</span>
              {data.correlationIds.map((id) => <code key={id}>{id}</code>)}
            </div>
          )}

          <DataState loading={loading} error={error} empty={!loading && !data.events?.length} onRetry={load}>
            <div className={styles.timeline}>
              <header className={styles.timelineHeader}>
                <Workflow size={16} />
                <strong>{submittedQuery ? "Correlated request path" : "Latest platform operations"}</strong>
                <span>{events.length} events across {summary.services ?? 0} services</span>
              </header>
              <div className={styles.eventList}>
                {events.map((event, index) => (
                  <EventCard event={event} key={event.eventId || `${event.sourceService}-${index}`} />
                ))}
              </div>
            </div>
          </DataState>
        </section>
      </div>
    </AdminLayout>
  );
}

function Metric({ icon: Icon, label, value, danger = false, unavailable = false }) {
  return (
    <div className={ui.metric}>
      <div className={ui.metricLabel}><Icon size={14} /> {label}</div>
      <div className={`${ui.metricValue} ${danger ? styles.danger : ""}`}>{value}</div>
      <div className={ui.metricHint}>{unavailable ? "Projection rebuilding" : "Current trace result"}</div>
    </div>
  );
}

function EventCard({ event }) {
  const failed = ["failed", "dlq", "blocked"].includes(String(event.status || "").toLowerCase());
  return (
    <article className={`${styles.eventCard} ${failed ? styles.eventFailed : ""}`}>
      <div className={styles.eventRail}><span /></div>
      <div className={styles.eventBody}>
        <div className={styles.eventTopline}>
          <div>
            <span className={styles.serviceName}>{event.sourceService || "unknown-service"}</span>
            <strong>{humanize(event.eventType)}</strong>
          </div>
          <span className={`${styles.status} ${failed ? styles.statusFailed : ""}`}>{event.status || "unknown"}</span>
        </div>
        <div className={styles.eventMeta}>
          <time>{formatTime(event.occurredAt)}</time>
          {Number.isFinite(event.durationMs) && <span>{formatDuration(event.durationMs)}</span>}
          {Number(event.attempt) > 1 && <span>attempt {event.attempt}</span>}
          {event.subject?.type && <span>{event.subject.type}: {shortId(event.subject.id)}</span>}
          {event.actor?.id && <span>actor: {shortId(event.actor.id)}</span>}
        </div>
        <details className={styles.eventDetails}>
          <summary>Identifiers</summary>
          <dl>
            <Identifier label="event" value={event.eventId} />
            <Identifier label="run" value={event.runId} />
            <Identifier label="caused by" value={event.causationId} />
            <Identifier label="idempotency" value={event.idempotencyKey} />
          </dl>
          {event.attributes && Object.keys(event.attributes).length > 0 && (
            <pre>{JSON.stringify(event.attributes, null, 2)}</pre>
          )}
        </details>
      </div>
    </article>
  );
}

function Identifier({ label, value }) {
  if (!value) return null;
  return <><dt>{label}</dt><dd><code>{value}</code></dd></>;
}

function humanize(value) {
  return String(value || "Operation event").replaceAll(/[._-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function formatDuration(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function shortId(value) {
  const text = String(value || "");
  return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
}
