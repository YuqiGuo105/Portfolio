import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, StatusPill, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { adminApi } from "../../src/lib/adminApi";

const PAGE_SIZE = 50;

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.notifications.list({ limit: PAGE_SIZE, offset });
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || "Notifications could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { load(); }, [load]);

  const delivery = useMemo(() => items.reduce((summary, item) => ({
    recipients: summary.recipients + Number(item.recipientCount || 0),
    sent: summary.sent + Number(item.sentCount || 0),
    failed: summary.failed + Number(item.failedCount || 0),
    pending: summary.pending + Number(item.pendingCount || 0),
  }), { recipients: 0, sent: 0, failed: 0, pending: 0 }), [items]);

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Notifications"
          subtitle="Review published notification events and channel delivery outcomes across all subscribers."
          actions={(
            <button type="button" className={ui.buttonSecondary} onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        />

        <section className={ui.metrics} aria-label="Visible page delivery summary">
          <Metric label="Events" value={items.length} hint={`${total} total`} />
          <Metric label="Recipients" value={delivery.recipients} hint="Email and web fan-out" />
          <Metric label="Sent" value={delivery.sent} hint="Includes web reads" />
          <Metric label="Failed / pending" value={`${delivery.failed} / ${delivery.pending}`} hint="Needs operational attention" />
        </section>

        {error && !loading && <div className={ui.errorBanner}>{error}</div>}

        <section className={ui.panel}>
          <DataState loading={loading} error={error && !items.length ? error : ""} empty={!loading && !error && items.length === 0} onRetry={load}>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Notification</th>
                    <th>Topic</th>
                    <th>Recipients</th>
                    <th>Sent</th>
                    <th>Failed</th>
                    <th>Pending</th>
                    <th>Created</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className={ui.primaryCell}>{item.title}</div>
                        <div className={`${ui.secondaryCell} ${ui.truncate}`}>{item.body || "No preview"}</div>
                      </td>
                      <td><StatusPill value={formatTopic(item.topic)} /></td>
                      <td className={ui.numeric}>{item.recipientCount}</td>
                      <td className={ui.numeric}>{item.sentCount}</td>
                      <td className={ui.numeric}>{item.failedCount}</td>
                      <td className={ui.numeric}>{item.pendingCount}</td>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>
                        {item.url && (
                          <a className={ui.iconButton} href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title}`} title="Open content">
                            <ExternalLink size={15} />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataState>
          <div className={ui.pagination}>
            <span>{total === 0 ? "0 events" : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}</span>
            <div className={ui.paginationActions}>
              <button className={ui.buttonSecondary} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
              <button className={ui.buttonSecondary} disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
            </div>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

function Metric({ label, value, hint }) {
  return <div className={ui.metric}><div className={ui.metricLabel}>{label}</div><div className={ui.metricValue}>{value}</div><div className={ui.metricHint}>{hint}</div></div>;
}

function formatTopic(value) {
  return String(value || "Unknown").replace(/_/g, " ");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
