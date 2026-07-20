import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, ExternalLink, Pencil, Plus, RefreshCw, RotateCcw, Search, X } from "lucide-react";
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
  includeAdmin: false,
};
const EMPTY_SUMMARY = { totalEvents: 0, uniqueVisitors: 0, countries: 0, cities: 0 };
const EMPTY_ALERTS = {
  rules: [],
  incidents: [],
  summary: { total: 0, notified: 0, pendingNotification: 0 },
};

export default function VisitorsPage() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [hours, setHours] = useState(24);
  const [page, setPage] = useState(0);
  const [pageInfo, setPageInfo] = useState({ number: 0, size: PAGE_SIZE, totalElements: 0, totalPages: 0 });
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [alerts, setAlerts] = useState(EMPTY_ALERTS);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState("");
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

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError("");
    try {
      const data = await adminApi.visitorAlerts.overview({ hours });
      setAlerts({
        rules: Array.isArray(data.rules) ? data.rules : [],
        incidents: Array.isArray(data.incidents) ? data.incidents : [],
        summary: data.summary || EMPTY_ALERTS.summary,
      });
    } catch (requestError) {
      setAlertsError(requestError.message || "Visitor alerts could not be loaded.");
    } finally {
      setAlertsLoading(false);
    }
  }, [hours]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

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
            <button
              className={ui.buttonSecondary}
              type="button"
              onClick={() => { load(); loadAlerts(); }}
              disabled={loading || alertsLoading}
            >
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        />

        <section className={ui.metrics} aria-label="Visitor query summary">
          <Metric
            label="Events"
            value={summary.totalEvents}
            hint={`${windowLabel(hours)} · ${filters.includeAdmin ? "All traffic" : "Public traffic"}`}
          />
          <Metric label="Unique visitors" value={summary.uniqueVisitors} hint="Session, anonymous ID or IP" />
          <Metric label="Countries" value={summary.countries} hint="Matching events" />
          <Metric label="Cities" value={summary.cities} hint="Matching events" />
        </section>

        <VisitorAlerts
          data={alerts}
          loading={alertsLoading}
          error={alertsError}
          hours={hours}
          onRetry={loadAlerts}
          onChanged={loadAlerts}
        />

        {error && !loading && items.length > 0 && <div className={ui.errorBanner}>{error}</div>}

        <section className={ui.panel}>
          <form className={visitorStyles.queryForm} onSubmit={submitQuery}>
            <div className={visitorStyles.queryTop}>
              <div className={`${ui.searchWrap} ${visitorStyles.search}`}>
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
              <label className={visitorStyles.trafficToggle}>
                <input
                  className={visitorStyles.toggleInput}
                  type="checkbox"
                  checked={draft.includeAdmin}
                  onChange={(event) => updateDraft("includeAdmin", event.target.checked)}
                />
                <span className={visitorStyles.toggleTrack} aria-hidden="true">
                  <span className={visitorStyles.toggleThumb} />
                </span>
                <span>Include admin</span>
              </label>
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
            <div className={`${ui.tableWrap} ${visitorStyles.visitorTableWrap}`}>
              <table className={`${ui.table} ${visitorStyles.visitorTable}`}>
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
                      <td className={ui.numeric}>
                        <time className={visitorStyles.eventTime} dateTime={item.eventTime} title={formatDateTime(item.eventTime)}>
                          <span>{formatDate(item.eventTime)}</span>
                          <small>{formatTime(item.eventTime)}</small>
                        </time>
                      </td>
                      <td>
                        <span className={visitorStyles.eventName}>
                          <span className={visitorStyles.eventDot} aria-hidden="true" />
                          {humanizeEventName(item.eventName)}
                        </span>
                      </td>
                      <td>
                        <div className={visitorStyles.contentStack}>
                          <ContentReference content={item.pageContent} url={item.pageUrl} label="Page" />
                          {shouldShowTarget(item) && (
                            <ContentReference content={item.targetContent} url={item.targetUrl} label="Target" compact />
                          )}
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
                        <details className={visitorStyles.identity}>
                          <summary title={item.ipAddress}>{item.ipAddress || "Unknown IP"}</summary>
                          <span title={item.sessionId}>Session {shortId(item.sessionId)}</span>
                          <span title={item.anonymousId}>Anonymous {shortId(item.anonymousId)}</span>
                          <span title={item.eventId}>Event {shortId(item.eventId)}</span>
                        </details>
                      </td>
                      <td>
                        <div className={visitorStyles.cellStack}>
                          <span className={visitorStyles.cellPrimary} title={item.referrer}>{displayHost(item.referrer) || "Direct"}</span>
                          <span className={visitorStyles.cellSecondary}>{item.referrer ? "Referral traffic" : "No referrer"}</span>
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

function ContentReference({ content, url, label, compact = false }) {
  const path = displayPath(url);
  const href = content?.canonicalUrl || path || "";
  const title = content?.title || path || "Unknown page";
  const type = content?.type || label;

  if (compact) {
    return (
      <a className={visitorStyles.targetLink} href={href || undefined} target="_blank" rel="noreferrer" title={url || title}>
        <span>{label}</span>
        <strong>{title}</strong>
        <ExternalLink size={11} aria-hidden="true" />
      </a>
    );
  }

  return (
    <div className={visitorStyles.contentReference} tabIndex={0}>
      <div className={visitorStyles.contentSummary}>
        <span className={visitorStyles.contentThumb} aria-hidden="true">
          <span>{contentInitials(type)}</span>
          {content?.coverUrl && <img src={content.coverUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
        </span>
        <span className={visitorStyles.contentCopy}>
          <span className={visitorStyles.contentType}>{type}</span>
          <a href={href || undefined} target="_blank" rel="noreferrer" title={url || title}>{title}</a>
          <small>{path || "Unknown path"}</small>
        </span>
      </div>
      <div className={visitorStyles.contentPreview} aria-label={`${title} details`}>
        <span className={visitorStyles.previewCover} aria-hidden="true">
          <span>{contentInitials(type)}</span>
          {content?.coverUrl && <img src={content.coverUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
        </span>
        <span className={visitorStyles.previewCopy}>
          <strong>{title}</strong>
          <span>{url || href || "No URL recorded"}</span>
          {href && (
            <a href={href} target="_blank" rel="noreferrer">
              Open {type} <ExternalLink size={11} aria-hidden="true" />
            </a>
          )}
        </span>
      </div>
    </div>
  );
}

function VisitorAlerts({ data, loading, error, hours, onRetry, onChanged }) {
  const rules = data.rules || [];
  const incidents = data.incidents || [];
  const activeRules = rules.filter((rule) => rule.enabled).length;
  const summary = data.summary || EMPTY_ALERTS.summary;
  const [editingRule, setEditingRule] = useState(null);
  const [preparedChange, setPreparedChange] = useState(null);
  const [mutationError, setMutationError] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);

  async function prepareRuleChange({ patch, reason }) {
    setMutationBusy(true);
    setMutationError("");
    try {
      const prepared = await adminApi.visitorAlerts.prepareChange({
        ruleId: editingRule.ruleId,
        patch,
        reason,
      });
      if (!prepared.diff || Object.keys(prepared.diff).length === 0) {
        setMutationError("No policy changes to review.");
        return;
      }
      setEditingRule(null);
      setPreparedChange(prepared);
    } catch (requestError) {
      setMutationError(requestError.message || "The policy change could not be prepared.");
    } finally {
      setMutationBusy(false);
    }
  }

  async function applyRuleChange() {
    setMutationBusy(true);
    setMutationError("");
    try {
      await adminApi.visitorAlerts.applyChange(preparedChange.changeId);
      setPreparedChange(null);
      await onChanged();
    } catch (requestError) {
      setMutationError(requestError.message || "The policy change could not be applied.");
    } finally {
      setMutationBusy(false);
    }
  }

  function openRuleEditor(rule) {
    setMutationError("");
    setPreparedChange(null);
    setEditingRule(rule);
  }

  function openRuleCreator() {
    setMutationError("");
    setPreparedChange(null);
    setEditingRule({
      ruleId: null,
      siteId: rules.find((rule) => rule.siteId)?.siteId || "",
      name: "",
      eventType: "",
      geoLevel: "GLOBAL",
      geoAreaId: "",
      granularity: "5m",
      threshold: 0,
      comparator: ">=",
      cooldownSeconds: 1800,
      enabled: true,
    });
  }

  return (
    <>
      <section className={`${ui.panel} ${visitorStyles.alertPanel}`} aria-label="Visitor behavior alerts">
        <div className={visitorStyles.alertHeader}>
          <div>
            <div className={visitorStyles.alertTitle}><BellRing size={17} /> Behavior alerts</div>
            <div className={visitorStyles.alertSubtitle}>{windowLabel(hours)} evaluation window</div>
          </div>
          <div className={visitorStyles.alertHeaderActions}>
            <button className={ui.buttonPrimary} type="button" onClick={openRuleCreator} disabled={loading}>
              <Plus size={14} /> New rule
            </button>
            <button className={ui.buttonSecondary} type="button" onClick={onRetry} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {error && <div className={ui.errorBanner}>{error}</div>}
        {loading && !rules.length && !incidents.length ? (
          <div className={visitorStyles.alertEmpty}>Loading alert state...</div>
        ) : (
          <>
            <div className={visitorStyles.alertStats}>
              <AlertStat label="Active rules" value={`${activeRules} / ${rules.length}`} />
              <AlertStat label="Triggered" value={summary.total || 0} />
              <AlertStat label="Delivered" value={summary.notified || 0} />
              <AlertStat label="Retry queue" value={summary.pendingNotification || 0} tone={summary.pendingNotification ? "warning" : "normal"} />
            </div>

            <div className={visitorStyles.alertGrid}>
              <div className={visitorStyles.alertSection}>
                <div className={visitorStyles.alertSectionTitle}>Rules</div>
                {rules.length ? rules.map((rule) => (
                  <div className={visitorStyles.ruleRow} key={rule.ruleId}>
                    <div className={visitorStyles.ruleCopy}>
                      <span className={visitorStyles.ruleName}>{rule.name}</span>
                      <span className={visitorStyles.ruleMeta}>
                        {rule.eventType} · {formatScope(rule)} · {rule.granularity}
                      </span>
                    </div>
                    <div className={visitorStyles.ruleValue}>
                      <strong>{rule.comparator} {rule.threshold}</strong>
                      <span className={rule.enabled ? visitorStyles.ruleEnabled : visitorStyles.ruleDisabled}>
                        {rule.enabled ? "Enabled" : "Paused"}
                      </span>
                    </div>
                    <button
                      className={visitorStyles.ruleEditButton}
                      type="button"
                      onClick={() => openRuleEditor(rule)}
                      title={`Edit ${rule.name}`}
                      aria-label={`Edit ${rule.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )) : <div className={visitorStyles.alertEmpty}>No rules configured.</div>}
              </div>

              <div className={visitorStyles.alertSection}>
                <div className={visitorStyles.alertSectionTitle}>Recent incidents</div>
                {incidents.length ? incidents.slice(0, 6).map((incident) => (
                  <div className={visitorStyles.incidentRow} key={incident.incidentId}>
                    <span className={incident.notified ? visitorStyles.incidentDelivered : visitorStyles.incidentPending} aria-hidden="true" />
                    <div className={visitorStyles.ruleCopy}>
                      <span className={visitorStyles.ruleName}>{incident.ruleName}</span>
                      <span className={visitorStyles.ruleMeta}>
                        Measured {incident.measuredValue} {incident.comparator} {incident.threshold}
                      </span>
                    </div>
                    <div className={visitorStyles.incidentTime}>
                      <span>{incident.notified ? "Delivered" : `Retry ${incident.notificationAttempts || 0}`}</span>
                      <time dateTime={incident.createdAt}>{formatDateTime(incident.createdAt)}</time>
                    </div>
                  </div>
                )) : <div className={visitorStyles.alertEmpty}>No incidents in this window.</div>}
              </div>
            </div>
          </>
        )}
      </section>

      {editingRule && (
        <AlertRuleEditor
          key={editingRule.ruleId}
          rule={editingRule}
          busy={mutationBusy}
          error={mutationError}
          onCancel={() => { setEditingRule(null); setMutationError(""); }}
          onReview={prepareRuleChange}
        />
      )}

      {preparedChange && (
        <PreparedRuleChange
          change={preparedChange}
          busy={mutationBusy}
          error={mutationError}
          onBack={() => {
            const rule = rules.find((candidate) => candidate.ruleId === preparedChange.ruleId);
            setPreparedChange(null);
            setMutationError("");
            if (rule) {
              setEditingRule(rule);
            } else if (!preparedChange.ruleId) {
              setEditingRule({ ruleId: null, ...(preparedChange.after || {}) });
            }
          }}
          onCancel={() => { setPreparedChange(null); setMutationError(""); }}
          onApply={applyRuleChange}
        />
      )}
    </>
  );
}

function AlertRuleEditor({ rule, busy, error, onCancel, onReview }) {
  const [form, setForm] = useState({
    siteId: rule.siteId || "",
    name: rule.name || "",
    eventType: rule.eventType || "",
    geoLevel: rule.geoLevel || "GLOBAL",
    geoAreaId: rule.geoAreaId || "",
    granularity: rule.granularity || "5m",
    threshold: String(rule.threshold ?? 0),
    comparator: rule.comparator || ">=",
    cooldownSeconds: String(rule.cooldownSeconds ?? 1800),
    enabled: Boolean(rule.enabled),
    reason: "",
  });
  const [localError, setLocalError] = useState("");

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function submit(event) {
    event.preventDefault();
    const threshold = Number(form.threshold);
    const cooldownSeconds = Number(form.cooldownSeconds);
    if (!form.siteId.trim() || !form.name.trim() || !form.eventType.trim() || !form.reason.trim()) {
      setLocalError("Site ID, name, event type and change reason are required.");
      return;
    }
    if (!Number.isSafeInteger(threshold) || threshold < 0) {
      setLocalError("Threshold must be a non-negative integer.");
      return;
    }
    if (!Number.isSafeInteger(cooldownSeconds) || cooldownSeconds < 60) {
      setLocalError("Cooldown must be at least 60 seconds.");
      return;
    }
    setLocalError("");
    onReview({
      patch: {
        siteId: form.siteId.trim(),
        name: form.name.trim(),
        eventType: form.eventType.trim(),
        geoLevel: form.geoLevel,
        geoAreaId: form.geoLevel === "GLOBAL" ? "" : form.geoAreaId.trim(),
        granularity: form.granularity,
        threshold,
        comparator: form.comparator,
        cooldownSeconds,
        enabled: form.enabled,
      },
      reason: form.reason.trim(),
    });
  }

  return (
    <div className={visitorStyles.dialogBackdrop} role="presentation">
      <section className={visitorStyles.policyDialog} role="dialog" aria-modal="true" aria-labelledby="alert-rule-editor-title">
        <header className={visitorStyles.dialogHeader}>
          <div>
            <span className={visitorStyles.dialogEyebrow}>Alert policy</span>
            <h2 id="alert-rule-editor-title">{rule.ruleId ? `Edit ${rule.name}` : "Create alert rule"}</h2>
          </div>
          <button className={visitorStyles.dialogClose} type="button" onClick={onCancel} disabled={busy} aria-label="Close editor">
            <X size={17} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className={visitorStyles.policyForm}>
            <PolicyField label="Site ID">
              <input value={form.siteId} onChange={(event) => update("siteId", event.target.value)} maxLength={120} disabled={Boolean(rule.ruleId)} />
            </PolicyField>
            <PolicyField label="Name">
              <input value={form.name} onChange={(event) => update("name", event.target.value)} maxLength={160} />
            </PolicyField>
            <PolicyField label="Event type">
              <input value={form.eventType} onChange={(event) => update("eventType", event.target.value)} maxLength={80} />
            </PolicyField>
            <PolicyField label="Scope level">
              <select value={form.geoLevel} onChange={(event) => update("geoLevel", event.target.value)}>
                <option value="GLOBAL">Global</option>
                <option value="COUNTRY">Country</option>
                <option value="REGION">Region</option>
                <option value="METRO">Metro</option>
              </select>
            </PolicyField>
            <PolicyField label="Scope ID">
              <input
                value={form.geoAreaId}
                onChange={(event) => update("geoAreaId", event.target.value)}
                disabled={form.geoLevel === "GLOBAL"}
                maxLength={120}
                placeholder={form.geoLevel === "GLOBAL" ? "All areas" : "Area identifier"}
              />
            </PolicyField>
            <PolicyField label="Evaluation window">
              <select value={form.granularity} onChange={(event) => update("granularity", event.target.value)}>
                <option value="5m">5 minutes</option>
                <option value="1d">1 day</option>
              </select>
            </PolicyField>
            <PolicyField label="Comparator">
              <select value={form.comparator} onChange={(event) => update("comparator", event.target.value)}>
                <option value=">=">Greater than or equal</option>
                <option value="<=">Less than or equal</option>
              </select>
            </PolicyField>
            <PolicyField label="Threshold">
              <input type="number" min="0" step="1" value={form.threshold} onChange={(event) => update("threshold", event.target.value)} />
            </PolicyField>
            <PolicyField label="Cooldown (seconds)">
              <input type="number" min="60" step="60" value={form.cooldownSeconds} onChange={(event) => update("cooldownSeconds", event.target.value)} />
            </PolicyField>
            <label className={visitorStyles.policyStatus}>
              <span>
                <strong>Rule status</strong>
                <small>{form.enabled ? "Evaluated by the scheduler" : "Evaluation paused"}</small>
              </span>
              <input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} />
              <span className={visitorStyles.policySwitch} aria-hidden="true"><span /></span>
            </label>
            <PolicyField label="Change reason" wide>
              <textarea value={form.reason} onChange={(event) => update("reason", event.target.value)} rows="3" maxLength={400} placeholder="Reason for this policy revision" />
            </PolicyField>
          </div>

          {(localError || error) && <div className={visitorStyles.dialogError}>{localError || error}</div>}
          <footer className={visitorStyles.dialogActions}>
            <button className={ui.buttonSecondary} type="button" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className={ui.buttonPrimary} type="submit" disabled={busy}>{busy ? "Preparing..." : "Review changes"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PreparedRuleChange({ change, busy, error, onBack, onCancel, onApply }) {
  const entries = Object.entries(change.diff || {});
  return (
    <div className={visitorStyles.dialogBackdrop} role="presentation">
      <section className={`${visitorStyles.policyDialog} ${visitorStyles.reviewDialog}`} role="alertdialog" aria-modal="true" aria-labelledby="alert-rule-review-title">
        <header className={visitorStyles.dialogHeader}>
          <div>
            <span className={visitorStyles.dialogEyebrow}>Confirmation</span>
            <h2 id="alert-rule-review-title">Review policy changes</h2>
          </div>
          <button className={visitorStyles.dialogClose} type="button" onClick={onCancel} disabled={busy} aria-label="Cancel policy change">
            <X size={17} />
          </button>
        </header>
        <div className={visitorStyles.changeList}>
          {entries.map(([field, values]) => (
            <div className={visitorStyles.changeRow} key={field}>
              <strong>{humanizeField(field)}</strong>
              <span>{formatPolicyValue(values.from)}</span>
              <span className={visitorStyles.changeArrow}>→</span>
              <span>{formatPolicyValue(values.to)}</span>
            </div>
          ))}
        </div>
        {change.warnings?.length > 0 && (
          <div className={visitorStyles.policyWarnings}>
            {change.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        )}
        {error && <div className={visitorStyles.dialogError}>{error}</div>}
        <footer className={visitorStyles.dialogActions}>
          <button className={ui.buttonSecondary} type="button" onClick={onBack} disabled={busy}>Back</button>
          <button className={ui.buttonPrimary} type="button" onClick={onApply} disabled={busy}>
            <Check size={14} /> {busy ? "Applying..." : "Apply changes"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function PolicyField({ label, wide = false, children }) {
  return (
    <label className={`${visitorStyles.policyField} ${wide ? visitorStyles.policyFieldWide : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function AlertStat({ label, value, tone = "normal" }) {
  return (
    <div className={`${visitorStyles.alertStat} ${tone === "warning" ? visitorStyles.alertStatWarning : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function formatScope(rule) {
  if (rule.geoAreaId) return rule.geoAreaId;
  return rule.geoLevel || "GLOBAL";
}

function humanizeField(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatPolicyValue(value) {
  if (value === null || value === undefined || value === "null" || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Enabled" : "Paused";
  return String(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
}

function humanizeEventName(value) {
  const normalized = String(value || "unknown").replace(/[_-]+/g, " ").trim();
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shouldShowTarget(item) {
  const target = displayPath(item.targetUrl);
  return Boolean(target && target !== displayPath(item.pageUrl));
}

function contentInitials(value) {
  return String(value || "page")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
