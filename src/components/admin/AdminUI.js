import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import styles from "./AdminPage.module.css";

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

export function StatusPill({ value }) {
  const key = String(value || "pending").replace(/[^a-z]/gi, "").toLowerCase();
  const statusClass = {
    active: styles.statusActive,
    sent: styles.statusSent,
    completed: styles.statusCompleted,
    toolcompleted: styles.statusCompleted,
    normal: styles.statusActive,
    degraded: styles.statusPending,
    hardlimit: styles.statusBlocked,
    disabled: styles.statusArchived,
    unsubscribed: styles.statusUnsubscribed,
    archived: styles.statusArchived,
    bounced: styles.statusBounced,
    failed: styles.statusFailed,
    blocked: styles.statusBlocked,
    pending: styles.statusPending,
    draft: styles.statusDraft,
  }[key] || styles.statusUnsubscribed;
  return <span className={`${styles.status} ${statusClass}`}>{value || "Unknown"}</span>;
}

export function DataState({ loading, error, empty, onRetry, children }) {
  if (!loading && !error && !empty) return children;
  const Icon = loading ? Loader2 : error ? AlertCircle : Inbox;
  const title = loading ? "Loading data" : error ? "Data unavailable" : "Nothing here yet";
  const detail = loading ? "Fetching the latest operational data." : error || "No records match the current filters.";
  return (
    <div className={styles.state}>
      <div className={styles.stateInner}>
        <Icon className={styles.stateIcon} size={24} aria-hidden="true" />
        <div className={styles.stateTitle}>{title}</div>
        <div className={styles.stateText}>{detail}</div>
        {error && onRetry && <button className={styles.buttonSecondary} onClick={onRetry}>Try again</button>}
      </div>
    </div>
  );
}

export { styles as adminStyles };
