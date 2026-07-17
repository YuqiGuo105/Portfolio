import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCcw, Search } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { DataState, PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import visitorStyles from "../../src/components/admin/VisitorsPage.module.css";
import { adminApi } from "../../src/lib/adminApi";

const PAGE_SIZE = 50;
const WINDOWS = [
  { label: "24h", value: 24 },
  { label: "7d", value: 168 },
  { label: "30d", value: 720 },
];
const EMPTY_FILTERS = {
  query: "",
  event: "",
  path: "",
  country: "",
  city: "",
  device: "",
  browser: "",
  referrer: "",
  sessionId: "",
};
const EMPTY_SUMMARY = { totalEvents: 0, uniqueVisitors: 0, countries: 0, cities: 0 };

export default function VisitorsPage() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [hours, setHours] = useState(24);
  const [page, setPage] = useState(0);
  const [pageInfo, setPageInfo] = useState({ number: 0, size: PAGE_SIZE, totalElements: 0, totalPages: 0 });
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.visitors.list({ ...filters, hours, page, size: PAGE_SIZE });
      setItems(Array.isArray(data.items) ? data.items : []);
      setSummary(data.summary || EMPTY_SUMMARY);
      setPageInfo(data.page || { number: page, size: PAGE_SIZE, totalElements: 0, totalPages: 0 });
    } catch (requestError) {
      setError(requestError.message || "Visitor logs could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filters, hours, page]);

  useEffect(() => { load(); }, [load]);

  function updateDraft(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function submitQuery(event) {
    event.preventDefault();
    setPage(0);
    setFilters({ ...draft });
  }

  function resetQuery() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(0);
  }

  function selectWindow(value) {
    setHours(value);
    setPage(0);
  }

  const total = Number(pageInfo.totalElements || 0);
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Visitor logs"
          subtitle="Query protected visitor events by time, behavior, page, location and client context."
          actions={(
            <button className={ui.buttonSecondary} type="button" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        />

        <section className={ui.metrics} aria-label="Visitor query summary">
          <Metric label="Events" value={summary.totalEvents} hint={`Within ${windowLabel(hours)}`} />
          <Metric label="Unique visitors" value={summary.uniqueVisitors} hint="Session, anonymous ID or IP" />
          <Metric label="Countries" value={summary.countries} hint="Matching events" />
          <Metric label="Cities" value={summary.cities} hint="Matching events" />
        </section>

        {error && !loading && items.length > 0 && <div className={ui.errorBanner}>{error}</div>}

        <section className={ui.panel}>
          <form className={visitorStyles.queryForm} onSubmit={submitQuery}>
            <div className={visitorStyles.queryTop}>
              <div className={ui.searchWrap}>
                <Search className={ui.searchIcon} size={15} />
                <input
                  className={ui.input}
                  value={draft.query}
                  onChange={(event) => updateDraft("query", event.target.value)}
                  placeholder="Search IP, visitor ID, page, referrer or location"
                  aria-label="Search visitor logs"
                />
              </div>
              <div className={ui.segmented} aria-label="Visitor log time range">
                {WINDOWS.map((window) => (
                  <button
                    key={window.value}
                    type="button"
                    className={`${ui.segment} ${hours === window.value ? ui.segmentActive : ""}`}
                    onClick={() => selectWindow(window.value)}
                  >
                    {window.label}
                  </button>
                ))}
              </div>
              <div className={visitorStyles.queryActions}>
                <button className={ui.buttonPrimary} type="submit" disabled={loading}>
                  <Search size={14} /> Query
                </button>
                <button className={ui.iconButton} type="button" onClick={resetQuery} title="Reset filters" aria-label="Reset filters">
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>

            <div className={visitorStyles.filterGrid}>
              <Filter label="Event" name="event" value={draft.event} onChange={updateDraft} placeholder="page_view" />
              <Filter label="Page / target" name="path" value={draft.path} onChange={updateDraft} placeholder="/blog" />
              <Filter label="Country" name="country" value={draft.country} onChange={updateDraft} placeholder="US" />
              <Filter label="City" name="city" value={draft.city} onChange={updateDraft} placeholder="Seattle" />
              <Filter label="Device" name="device" value={draft.device} onChange={updateDraft} placeholder="desktop" />
              <Filter label="Browser" name="browser" value={draft.browser} onChange={updateDraft} placeholder="Chrome" />
              <Filter label="Referrer" name="referrer" value={draft.referrer} onChange={updateDraft} placeholder="google.com" />
              <Filter label="Session ID" name="sessionId" value={draft.sessionId} onChange={updateDraft} placeholder="Session identifier" />
            </div>
          </form>

          <DataState loading={loading} error={error && !items.length ? error : ""} empty={!loading && !error && items.length === 0} onRetry={load}>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Page / target</th>
                    <th>Location</th>
                    <th>Client</th>
                    <th>Visitor</th>
                    <th>Referrer</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.eventId}>
                      <td className={ui.numeric}>{formatDateTime(item.eventTime)}</td>
                      <td>
                        <span className={visitorStyles.eventName}>
                          <span className={visitorStyles.eventDot} aria-hidden="true" />
                          {item.eventName || "unknown"}
                        </span>
                      </td>
                      <td>
                        <div className={visitorStyles.cellStack}>
                          <span className={visitorStyles.cellPrimary} title={item.pageUrl}>{displayPath(item.pageUrl) || "—"}</span>
                          <span className={visitorStyles.cellSecondary} title={item.targetUrl}>{displayPath(item.targetUrl) || "No target"}</span>
                        </div>
                      </td>
                      <td>
                        <div className={visitorStyles.cellStack}>
                          <span className={visitorStyles.cellPrimary}>{[item.city, item.region].filter(Boolean).join(", ") || "Unknown"}</span>
                          <span className={visitorStyles.cellSecondary}>{item.country || "No country"}</span>
                        </div>
                      </td>
                      <td>
                        <div className={visitorStyles.cellStack}>
                          <span className={visitorStyles.cellPrimary}>{[item.deviceType, item.browser].filter(Boolean).join(" · ") || "Unknown"}</span>
                          <span className={visitorStyles.cellSecondary}>{item.os || "No OS"} {item.bot ? <span className={visitorStyles.bot}>Bot</span> : null}</span>
                        </div>
                      </td>
                      <td>
                        <div className={visitorStyles.identity}>
                          <span title={item.ipAddress}>IP {item.ipAddress || "—"}</span>
                          <span title={item.sessionId}>Session {shortId(item.sessionId)}</span>
                          <span title={item.anonymousId}>Anon {shortId(item.anonymousId)}</span>
                        </div>
                      </td>
                      <td>
                        <div className={visitorStyles.cellStack}>
                          <span className={visitorStyles.cellPrimary} title={item.referrer}>{displayHost(item.referrer) || "Direct"}</span>
                          <span className={visitorStyles.cellSecondary} title={item.eventId}>{shortId(item.eventId)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataState>

          <div className={ui.pagination}>
            <span>{total === 0 ? "0 events" : `${start}–${end} of ${total}`}</span>
            <div className={ui.paginationActions}>
              <button className={ui.buttonSecondary} type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button>
              <button className={ui.buttonSecondary} type="button" disabled={page + 1 >= pageInfo.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

function Filter({ label, name, value, onChange, placeholder }) {
  return (
    <label className={visitorStyles.field}>
      <span className={visitorStyles.fieldLabel}>{label}</span>
      <input className={visitorStyles.fieldInput} value={value} onChange={(event) => onChange(name, event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Metric({ label, value, hint }) {
  return <div className={ui.metric}><div className={ui.metricLabel}>{label}</div><div className={ui.metricValue}>{value ?? 0}</div><div className={ui.metricHint}>{hint}</div></div>;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function displayPath(value) {
  if (!value) return "";
  try { return new URL(value, "https://www.yuqi.site").pathname; } catch { return String(value); }
}

function displayHost(value) {
  if (!value) return "";
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return String(value); }
}

function shortId(value) {
  const text = String(value || "—");
  return text.length > 18 ? `${text.slice(0, 9)}…${text.slice(-5)}` : text;
}

function windowLabel(hours) {
  if (hours === 24) return "24 hours";
  if (hours === 168) return "7 days";
  return "30 days";
}
