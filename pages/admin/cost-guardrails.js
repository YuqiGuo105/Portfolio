import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, StatusPill, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { adminApi } from "../../src/lib/adminApi";

const EMPTY = {
  enabled: false,
  limitUsd: 0,
  reservedUsd: 0,
  remainingUsd: 0,
  estimatedLlmUsd: 0,
  chatRequests: 0,
  budgetDeniedRequests: 0,
  modelCalls: 0,
  standardModelCalls: 0,
  deepModelCalls: 0,
  deepModelRatio: 0,
  toolCalls: 0,
  webSearchCalls: 0,
  downgradedDeepCalls: 0,
  usageRatio: 0,
  highCostPathAllowed: false,
  guardrailMode: "UNKNOWN",
};

export default function CostGuardrailsPage() {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSnapshot({ ...EMPTY, ...(await adminApi.costGuardrail.snapshot()) });
    } catch (err) {
      setError(err.message || "Cost guardrail data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const usagePercent = clampPercent(toNumber(snapshot.usageRatio) * 100);
  const deepPercent = clampPercent(toNumber(snapshot.deepModelRatio) * 100);
  const mode = String(snapshot.guardrailMode || "UNKNOWN").toUpperCase();
  const healthy = snapshot.highCostPathAllowed && mode === "NORMAL";
  const resetAt = useMemo(() => formatDateTime(snapshot.resetAt), [snapshot.resetAt]);

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Cost guardrails"
          subtitle="Track daily AI usage, high-cost path exposure, and automatic model downgrade behavior."
          actions={(
            <button className={ui.buttonSecondary} type="button" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        />

        <section className={ui.metrics} aria-label="AI cost summary">
          <Metric label="Estimated LLM spend" value={formatUsd(snapshot.estimatedLlmUsd)} hint={`Reserved ${formatUsd(snapshot.reservedUsd)} / ${formatUsd(snapshot.limitUsd)}`} />
          <Metric label="Tool calls" value={formatInt(snapshot.toolCalls)} hint="MCP and platform tools today" />
          <Metric label="Web search" value={formatInt(snapshot.webSearchCalls)} hint="Grounded deep path calls" />
          <Metric label="Deep model ratio" value={`${Math.round(deepPercent)}%`} hint={`${formatInt(snapshot.deepModelCalls)} of ${formatInt(snapshot.modelCalls)} model calls`} />
        </section>

        <section className={ui.panel}>
          <div className={ui.toolbar}>
            <div className={ui.toolbarGroup}>
              {healthy ? <CheckCircle2 size={18} color="#0f766e" /> : <AlertTriangle size={18} color="#b45309" />}
              <strong>Guardrail status</strong>
              <StatusPill value={mode} />
            </div>
            <div className={ui.conversationMeta}>
              {resetAt && <span>Reset {resetAt}</span>}
              <span>{snapshot.enabled ? "Budget enabled" : "Budget disabled"}</span>
            </div>
          </div>

          <DataState loading={loading} error={error} empty={false} onRetry={load}>
            <div style={{ display: "grid", gap: 22, padding: 20 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#66717d", fontSize: 13 }}>
                  <span>Daily reserved budget usage</span>
                  <span>{Math.round(usagePercent)}%</span>
                </div>
                <div style={{ height: 12, borderRadius: 999, background: "#edf1f3", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${usagePercent}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: usagePercent >= 90 ? "#c2410c" : usagePercent >= 70 ? "#b45309" : "#0f766e",
                    }}
                  />
                </div>
                <div style={{ color: "#7a858e", fontSize: 12 }}>
                  Remaining {formatUsd(snapshot.remainingUsd)}. High-cost path is {snapshot.highCostPathAllowed ? "enabled" : "downgraded or disabled"}.
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <DetailCard title="Request volume" value={formatInt(snapshot.chatRequests)} detail={`${formatInt(snapshot.budgetDeniedRequests)} budget denied`} />
                <DetailCard title="Model mix" value={`${formatInt(snapshot.standardModelCalls)} standard`} detail={`${formatInt(snapshot.deepModelCalls)} deep model calls`} />
                <DetailCard title="Downgrades" value={formatInt(snapshot.downgradedDeepCalls)} detail="Deep path converted to standard" />
              </div>

              <div style={{ display: "grid", gap: 10, padding: 16, border: "1px solid #dfe4e8", borderRadius: 8, background: "#f8faf9" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#17212b", fontWeight: 700 }}>
                  <ShieldCheck size={17} /> Runtime policy
                </div>
                <p style={{ margin: 0, color: "#66717d", fontSize: 13, lineHeight: 1.55 }}>
                  The planner can still choose STANDARD or DEEP semantically. The guardrail only gates the expensive path:
                  when daily usage approaches the configured limit, DEEP requests continue through retrieval and standard
                  generation without web search, while tool execution and low-cost answers remain available.
                </p>
              </div>
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

function DetailCard({ title, value, detail }) {
  return (
    <div style={{ padding: 16, border: "1px solid #dfe4e8", borderRadius: 8, background: "#ffffff" }}>
      <div className={ui.metricLabel}>{title}</div>
      <div style={{ marginTop: 8, color: "#17212b", fontSize: 22, fontWeight: 720 }}>{value}</div>
      <div style={{ marginTop: 5, color: "#7a858e", fontSize: 12 }}>{detail}</div>
    </div>
  );
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function formatUsd(value) {
  return `$${toNumber(value).toFixed(3)}`;
}

function formatInt(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
