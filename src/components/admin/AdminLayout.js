import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Bell,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  ChevronLeft,
  CircleUserRound,
  FileText,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import AdminTokenGate from "./AdminTokenGate";
import { supabase } from "../../supabase/supabaseClient";
import styles from "./AdminLayout.module.css";

const ADMIN_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_ADMIN_SERVICE_SWAGGER_URL ||
  "https://portfolio-admin-service-y45c2mnbja-uc.a.run.app/swagger-ui.html";

const NOTIFICATION_SERVICE_SWAGGER =
  process.env.NEXT_PUBLIC_NOTIFICATION_SERVICE_SWAGGER_URL ||
  "https://portfolio-notification-service-y45c2mnbja-uc.a.run.app/swagger-ui.html";

const KIBANA_DASHBOARD = process.env.NEXT_PUBLIC_KIBANA_DASHBOARD_URL ||
  "https://console.aiven.io/account/a5c1cacf06ce/project/yguo105-17e7/services/os-79250b0/overview";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", exact: true, icon: LayoutDashboard }],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/blogs", label: "Tech blogs", icon: FileText },
      { href: "/admin/life-blogs", label: "Life blogs", icon: BookOpen },
      { href: "/admin/projects", label: "Projects", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "Audience",
    items: [
      { href: "/admin/subscriptions", label: "Subscribers", icon: Users },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "AI Operations",
    items: [
      { href: "/admin/conversations", label: "Conversations", icon: History },
      { href: "/admin/agent", label: "Operate console", icon: Bot },
      { href: KIBANA_DASHBOARD, label: "OpenSearch", icon: Gauge, external: true },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/jobs", label: "Jobs & audit", icon: ScrollText },
      { href: ADMIN_SERVICE_SWAGGER, label: "Admin API", icon: Radio, external: true },
      { href: NOTIFICATION_SERVICE_SWAGGER, label: "Notification API", icon: Radio, external: true },
    ],
  },
];

export default function AdminLayout({ children }) {
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [router.asPath]);

  async function handleLogout() {
    await supabase.auth.signOut().catch(() => {});
    router.replace("/admin/login");
  }

  function isActive(item) {
    if (item.external) return false;
    if (item.exact) return router.pathname === item.href;
    return router.pathname.startsWith(item.href);
  }

  function navItem(item) {
    const Icon = item.icon;
    const content = (
      <>
        <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
        <span>{item.label}</span>
        {item.external && <span className={styles.externalMark}>↗</span>}
      </>
    );
    const className = `${styles.navLink} ${isActive(item) ? styles.active : ""}`;
    if (item.external) {
      return (
        <a key={item.href} href={item.href} target="_blank" rel="noreferrer noopener" className={className}>
          {content}
        </a>
      );
    }
    return (
      <Link key={item.href} href={item.href}>
        <a className={className}>{content}</a>
      </Link>
    );
  }

  return (
    <AdminTokenGate>
      <div className={styles.shell}>
        <header className={styles.mobileHeader}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setNavOpen(true)}
            aria-label="Open admin navigation"
            title="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className={styles.mobileBrand}>Yuqi Admin</div>
          <CircleUserRound size={21} aria-hidden="true" />
        </header>

        {navOpen && <button className={styles.backdrop} aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
        <aside className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ""}`}>
          <div className={styles.brandRow}>
            <Link href="/admin"><a className={styles.brand}>Yuqi <span>Admin</span></a></Link>
            <button
              className={`${styles.iconButton} ${styles.mobileClose}`}
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close admin navigation"
              title="Close navigation"
            >
              <X size={19} />
            </button>
          </div>

          <nav className={styles.nav} aria-label="Admin navigation">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className={styles.navGroup}>
                <div className={styles.navGroupTitle}>{group.label}</div>
                {group.items.map(navItem)}
              </div>
            ))}
          </nav>

          <div className={styles.sidebarFooter}>
            <a href="https://www.yuqi.site" target="_blank" rel="noreferrer noopener" className={styles.siteLink}>
              <ChevronLeft size={16} />
              <span>Back to yuqi.site</span>
            </a>
            <button type="button" className={styles.logoutButton} onClick={handleLogout}>
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.content}>{children}</div>
        </main>
      </div>
    </AdminTokenGate>
  );
}
