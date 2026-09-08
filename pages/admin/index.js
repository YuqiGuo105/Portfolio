import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Bot,
  BookOpen,
  BriefcaseBusiness,
  ExternalLink,
  FileText,
  History,
  Eye,
  Users,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { PageHeader, adminStyles as ui } from "../../src/components/admin/AdminUI";
import { writerApi } from "../../src/lib/writerApi";
import { adminApi } from "../../src/lib/adminApi";

const CONTENT = [
  { key: "blogs", type: "BLOG", label: "Tech blogs", href: "/admin/blogs", icon: FileText },
  { key: "lifeBlogs", type: "LIFE_BLOG", label: "Life blogs", href: "/admin/life-blogs", icon: BookOpen },
  { key: "projects", type: "PROJECT", label: "Projects", href: "/admin/projects", icon: BriefcaseBusiness },
];

const ACTIONS = [
  { label: "Visitor logs", text: "Query visitor behavior, location and client context.", href: "/admin/visitors", icon: Eye },
  { label: "Subscribers", text: "Search subscribers and update lifecycle status.", href: "/admin/subscriptions", icon: Users },
  { label: "Notifications", text: "Review notification fan-out and delivery outcomes.", href: "/admin/notifications", icon: Bell },
  { label: "Conversations", text: "Inspect recent Agent runs and final responses.", href: "/admin/conversations", icon: History },
  { label: "Operate console", text: "Run authenticated natural-language operations.", href: "/admin/agent", icon: Bot },
];

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState({ content: "…", active: "…", notifications: "…", conversations: "…" });

  useEffect(() => {
    let active = true;
    Promise.allSettled(CONTENT.map((section) => writerApi.content.list(section.type, { limit: 200 })))
      .then((results) => {
        if (!active) return;
        const total = results.reduce((sum, result) => sum + (
          result.status === "fulfilled" && Array.isArray(result.value?.items)
            ? result.value.items.length : 0
        ), 0);
        setMetrics((current) => ({ ...current, content: total }));
      });

    adminApi.subscribers.list({ status: "ACTIVE", limit: 1 }).then((data) => {
      if (active) setMetrics((current) => ({ ...current, active: data.total ?? 0 }));
    }).catch(() => active && setMetrics((current) => ({ ...current, active: "—" })));

    adminApi.notifications.list({ limit: 1 }).then((data) => {
      if (active) setMetrics((current) => ({ ...current, notifications: data.total ?? 0 }));
    }).catch(() => active && setMetrics((current) => ({ ...current, notifications: "—" })));

    adminApi.conversations.list({ hours: 24, limit: 100 }).then((data) => {
      if (active) setMetrics((current) => ({ ...current, conversations: data.total ?? 0 }));
    }).catch(() => active && setMetrics((current) => ({ ...current, conversations: "—" })));

    return () => { active = false; };
  }, []);

  return (
    <AdminLayout>
      <div className={ui.page}>
        <PageHeader
          title="Dashboard"
          subtitle="Portfolio workspace"
          actions={(
            <>
            <Link href="/admin/agent"><a className={ui.buttonPrimary}><Bot size={16} /> Operate console</a></Link>
            <a href="https://www.yuqi.site" target="_blank" rel="noreferrer" className={ui.buttonSecondary}>
              View site <ExternalLink size={15} />
            </a>
            </>
          )}
        />

        <section className={ui.metrics} aria-label="Admin summary">
          <Metric label="Managed content" value={metrics.content} hint="Across three content types" />
          <Metric label="Active subscribers" value={metrics.active} hint="Current email audience" />
          <Metric label="Notifications" value={metrics.notifications} hint="All published events" />
          <Metric label="Agent runs today" value={metrics.conversations} hint="Last 24 hours" />
        </section>

        <section className={ui.section}>
          <div className={ui.sectionHeader}>
            <h2 className={ui.sectionTitle}>Content workspace</h2>
          </div>
          <div className={ui.contentList}>
            {CONTENT.map(({ key, label, href, icon: Icon, type }) => (
              <div key={key} className={ui.contentRow}>
                <span className={ui.actionIcon}><Icon size={19} aria-hidden="true" /></span>
                <span className={ui.contentName}>{label}</span>
                <span className={ui.contentCount}>{type === "PROJECT" ? "Case studies" : type === "LIFE_BLOG" ? "Journal" : "Articles"}</span>
                <div className={ui.contentActions}>
                  <Link href={href}><a className={ui.buttonSecondary} aria-label={`View all ${label.toLowerCase()}`}>View all</a></Link>
                  <Link href={`${href}/new`}><a className={ui.iconButton} aria-label={`Create ${label.toLowerCase()}`} title={`Create ${label.toLowerCase()}`}><Plus size={16} /></a></Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={ui.section}>
          <div className={ui.sectionHeader}>
            <h2 className={ui.sectionTitle}>Operations</h2>
          </div>
          <div className={ui.actionGrid}>
            {ACTIONS.map((item) => <ActionCard key={item.href} {...item} />)}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className={ui.metric}>
      <div className={ui.metricLabel}>{label}</div>
      <div className={ui.metricValue}>{value}</div>
      <div className={ui.metricHint}>{hint}</div>
    </div>
  );
}

function ActionCard({ label, href, icon: Icon }) {
  return (
    <Link href={href}>
      <a className={ui.actionCard}>
        <span className={ui.actionIcon}><Icon size={18} /></span>
        <span className={ui.actionTitle}>{label}</span>
        <ArrowUpRight className={ui.actionLink} size={16} aria-hidden="true" />
      </a>
    </Link>
  );
}
