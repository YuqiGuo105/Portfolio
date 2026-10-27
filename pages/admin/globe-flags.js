import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, Trash2, X } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { adminApi } from "../../src/lib/adminApi";

const TABS = [
  { id: "pending", label: "Waiting for review" },
  { id: "approved", label: "On the globe" },
  { id: "rejected", label: "Rejected" },
];

const when = (value) => {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return value; }
};

export default function GlobeFlagsPage() {
  const [status, setStatus] = useState("pending");
  const [flags, setFlags] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await adminApi.globeFlags.list(status);
      setEnabled(payload.enabled !== false);
      setFlags(Array.isArray(payload.flags) ? payload.flags : []);
    } catch (err) {
      setError(err.message || "Flags could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function review(id, action) {
    setBusy(id);
    setError("");
    try {
      await adminApi.globeFlags.review(id, action);
      setFlags((current) => current.filter((flag) => flag.id !== id));
    } catch (err) {
      setError(err.message || "The flag could not be updated.");
    } finally {
      setBusy("");
    }
  }

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Globe flags"
          subtitle="Flags visitors plant on the visitor globe. Emoji-only flags appear immediately; flags with a note wait here until you approve them."
          actions={(
            <button className={ui.buttonSecondary} onClick={load} disabled={loading}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />
        {!enabled && (
          <div className={ui.errorBanner}>
            The globe_flags table is missing. Apply supabase/migrations/20261027210000_globe_flags.sql to turn the guestbook on.
          </div>
        )}
        {error && flags.length > 0 && <div className={ui.errorBanner}>{error}</div>}
        <div className={ui.toolbar}>
          <div className={ui.segmented} role="tablist" aria-label="Flag status">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={status === tab.id}
                className={`${ui.segment} ${status === tab.id ? ui.segmentActive : ""}`}
                onClick={() => setStatus(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <section className={ui.panel}>
          <DataState loading={loading} error={error && !flags.length ? error : ""} empty={!loading && !error && flags.length === 0} onRetry={load}>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr><th>Flag</th><th>Note</th><th>Where</th><th>Planted</th><th aria-label="Actions" /></tr>
                </thead>
                <tbody>
                  {flags.map((flag) => (
                    <tr key={flag.id}>
                      <td style={{ fontSize: 22 }}>{flag.emoji}</td>
                      <td className={ui.primaryCell}>{flag.message || <span className={ui.secondaryCell}>No note</span>}</td>
                      <td className={ui.secondaryCell}>
                        {[flag.city, flag.country].filter(Boolean).join(", ") || "Picked on the globe"}
                        <div className={ui.mono}>{Number(flag.lat).toFixed(2)}, {Number(flag.lng).toFixed(2)}</div>
                      </td>
                      <td className={ui.secondaryCell}>{when(flag.created_at)}</td>
                      <td>
                        <div className={ui.contentActions}>
                          {status !== "approved" && (
                            <button className={ui.buttonPrimary} disabled={busy === flag.id} onClick={() => review(flag.id, "approve")}>
                              <Check size={15} aria-hidden="true" /> Approve
                            </button>
                          )}
                          {status !== "rejected" && (
                            <button className={ui.buttonSecondary} disabled={busy === flag.id} onClick={() => review(flag.id, "reject")}>
                              <X size={15} aria-hidden="true" /> {status === "approved" ? "Hide" : "Reject"}
                            </button>
                          )}
                          <button className={ui.iconButton} aria-label="Delete flag" title="Delete" disabled={busy === flag.id} onClick={() => review(flag.id, "delete")}>
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataState>
        </section>
      </div>
    </AdminLayout>
  );
}
