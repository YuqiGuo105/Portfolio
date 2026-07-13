import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, StatusPill, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { adminApi } from "../../src/lib/adminApi";

const STATUSES = ["ALL", "ACTIVE", "UNSUBSCRIBED", "BOUNCED"];
const PAGE_SIZE = 50;

export default function SubscriptionsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("ALL");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.subscribers.list({ status, query, limit: PAGE_SIZE, offset });
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || "Subscribers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [offset, query, status]);

  useEffect(() => {
    const timer = setTimeout(load, 220);
    return () => clearTimeout(timer);
  }, [load]);

  async function changeStatus(item, nextStatus) {
    if (nextStatus === item.status) return;
    const confirmed = window.confirm(
      `Change ${item.email} from ${item.status} to ${nextStatus}?\n\nThis updates subscription state only; no subscriber record will be deleted.`
    );
    if (!confirmed) return;
    setUpdatingId(item.id);
    setError("");
    try {
      const updated = await adminApi.subscribers.updateStatus(item.id, nextStatus);
      setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
    } catch (err) {
      setError(err.message || "Subscriber status could not be updated.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Subscribers"
          subtitle="Manage audience lifecycle and delivery eligibility. Records are retained when a subscriber opts out."
          actions={(
            <button type="button" className={ui.buttonSecondary} onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        />

        {error && !loading && (
          <div className={ui.errorBanner} role="alert">
            <span>{error}</span>
            <button className={ui.buttonSecondary} onClick={load}>Retry</button>
          </div>
        )}

        <section className={ui.panel}>
          <div className={ui.toolbar}>
            <div className={ui.searchWrap}>
              <Search className={ui.searchIcon} size={15} />
              <input
                className={ui.input}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setOffset(0); }}
                placeholder="Search subscriber email"
                aria-label="Search subscriber email"
              />
            </div>
            <div className={ui.segmented} aria-label="Subscriber status filter">
              {STATUSES.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={`${ui.segment} ${status === value ? ui.segmentActive : ""}`}
                  onClick={() => { setStatus(value); setOffset(0); }}
                >
                  {value === "ALL" ? "All" : value.replace("UNSUBSCRIBED", "Unsubscribed").replace("ACTIVE", "Active").replace("BOUNCED", "Bounced")}
                </button>
              ))}
            </div>
          </div>

          <DataState loading={loading} empty={!loading && items.length === 0}>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Subscriber</th>
                    <th>Status</th>
                    <th>Email topics</th>
                    <th>Web topics</th>
                    <th>Joined</th>
                    <th>State source</th>
                    <th>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className={ui.primaryCell}>{item.email}</div>
                        <div className={`${ui.secondaryCell} ${ui.mono}`}>{item.id}</div>
                      </td>
                      <td><StatusPill value={item.status} /></td>
                      <td className={ui.numeric}>{item.emailTopicCount}</td>
                      <td className={ui.numeric}>{item.webTopicCount}</td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>{item.unsubscribeSource || "—"}</td>
                      <td>
                        <select
                          className={ui.select}
                          value={item.status}
                          disabled={updatingId === item.id}
                          onChange={(event) => changeStatus(item, event.target.value)}
                          aria-label={`Change status for ${item.email}`}
                        >
                          {STATUSES.filter((value) => value !== "ALL").map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataState>

          <div className={ui.pagination}>
            <span>{total === 0 ? "0 records" : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}</span>
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}
