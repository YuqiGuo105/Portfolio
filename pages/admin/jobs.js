import Link from "next/link";
import { Bot, BookOpen, RotateCcw, ScrollText } from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { ADMIN_API_DOCS_PATH } from "../../src/lib/adminApiDocs.mjs";
import styles from "../../src/components/admin/JobsPage.module.css";

const OPERATIONS = [
  { method: "GET", path: "/api/admin/indexing-jobs", purpose: "Filter RAG and search indexing jobs by status." },
  { method: "POST", path: "/api/admin/indexing-jobs/{jobId}/retry", purpose: "Retry a failed indexing job with an audit trail." },
  { method: "GET", path: "/api/admin/outbox-events", purpose: "Inspect pending and failed event publication." },
];

export default function JobsAuditPage() {
  return <AdminLayout><JobsAuditWorkspace /></AdminLayout>;
}

export function JobsAuditWorkspace() {
  return (
      <div className={ui.page}>
        <PageHeader
          title="Jobs & audit"
          subtitle="Operational entry points for indexing retries, outbox delivery and content audit history."
          actions={(
            <>
              <Link href="/admin/agent"><a className={ui.buttonSecondary}><Bot size={15} /> Use operate console</a></Link>
              <Link href={ADMIN_API_DOCS_PATH}><a className={ui.buttonPrimary}>
                Open Admin API <BookOpen size={15} />
              </a></Link>
            </>
          )}
        />

        <section className={ui.actionGrid}>
          <OperationCard icon={RotateCcw} title="Indexing recovery" text="List failed jobs and retry an individual job after reviewing its error." />
          <OperationCard icon={ScrollText} title="Outbox inspection" text="Check whether content and indexing events are waiting for publication." />
          <OperationCard icon={Bot} title="Natural-language ops" text="Use MCP read tools directly; write actions remain confirmation-gated." />
        </section>

        <section className={ui.panel}>
          <div className={ui.toolbar}>
            <h2 className={ui.sectionTitle}>Available operations</h2>
            <span className={ui.sectionMeta}>Authorization required</span>
          </div>
          <div className={ui.tableWrap} role="region" aria-label="Available API operations" tabIndex={0}>
            <table className={`${ui.table} ${styles.operationsTable}`}>
              <thead><tr><th>Method</th><th>Endpoint</th><th>Purpose</th></tr></thead>
              <tbody>
                {OPERATIONS.map((operation) => (
                  <tr key={operation.path}>
                    <td><span className={ui.status}>{operation.method}</span></td>
                    <td className={ui.mono}>{operation.path}</td>
                    <td>{operation.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
  );
}

function OperationCard({ icon: Icon, title, text }) {
  return (
    <div className={`${ui.actionCard} ${styles.operationCard}`}>
      <span className={ui.actionIcon}><Icon size={18} aria-hidden="true" /></span>
      <span className={styles.operationCopy}>
        <span className={ui.actionTitle}>{title}</span>
        <span className={ui.actionText}>{text}</span>
      </span>
    </div>
  );
}
