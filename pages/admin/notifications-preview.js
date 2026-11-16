import Head from "next/head";
import { ChevronRight, ShieldCheck } from "lucide-react";
import AdminNotifications from "../../src/components/admin/AdminNotifications";
import { initials } from "../../src/lib/adminNotifications.mjs";
import shell from "../../src/components/admin/AdminLayout.module.css";

// Local preview of the admin top bar (`npm run dev:talk`): the notification bell over made-up items
// and the account picture, once with a picture and once with initials. No sign-in, local only.
export async function getServerSideProps({ req }) {
  if (process.env.NODE_ENV !== "development" || process.env.TALK_PREVIEW !== "1" || !/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || "")) return { notFound: true };
  return { props: {} };
}

const clearedKeys = new Set();
const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const sample = {
  alerts: async () => ({ incidents: [
    { incidentId: "s1", ruleName: "Traffic spike on the home page (sample)", createdAt: at(4), measuredValue: 420, threshold: 300 },
    { incidentId: "s2", ruleName: "New visitors from LinkedIn (sample)", createdAt: at(95), measuredValue: 12, threshold: 10 },
  ] }),
  referrals: async () => ({ requests: [{ id: "s3", status: "new", name: "Maya Lin (sample)", role_title: "Associate, Software Engineering", company: "Goldman Sachs", created_at: at(40) }] }),
  flags: async () => ({ flags: [{ id: "s4", emoji: "👋", message: "Hello from Lisbon (sample)", city: "Lisbon", country: "Portugal", created_at: at(300) }] }),
  reviews: async () => ({ reviews: [] }),
  failures: async () => ({ items: Array.from({ length: 11 }, (_, index) => ({ kind: "OUTBOX_EVENT", id: `s-old-${index}`, lastError: "Quarantined at cutover (sample)", updatedAt: at(60 * 24 * 121 + index) })) }),
  cleared: async () => ({ enabled: true, keys: [...clearedKeys] }),
  clear: async (keys) => { keys.forEach((key) => clearedKeys.add(key)); return { enabled: true, cleared: keys.length }; },
};
const empty = { alerts: async () => ({}), referrals: async () => ({}), flags: async () => ({}), reviews: async () => ({}), failures: async () => [] };

function Bar({ source, picture, name, email, label }) {
  return (
    <div className={shell.topbar} style={{ border: "1px solid #e8eaed", borderRadius: 8 }}>
      <nav aria-label="Breadcrumb" className={shell.breadcrumb}><span>{label}</span><ChevronRight size={14} aria-hidden="true" /><strong>Overview</strong></nav>
      <div className={shell.topbarRight}>
        <AdminNotifications source={source} />
        <div className={shell.identity}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {picture ? <img className={shell.avatar} src={picture} alt="" width={28} height={28} /> : <span className={shell.avatarInitials} aria-hidden="true">{initials(name, email)}</span>}
          <span>{email}</span>
          <ShieldCheck size={15} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export default function NotificationsPreview() {
  return (
    <div className={shell.shell} style={{ display: "block", minHeight: "100vh", padding: "32px clamp(16px, 4vw, 48px)" }}>
      <Head><title>Admin top bar | Local preview</title><meta name="robots" content="noindex,nofollow" /></Head>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 320 }}>
        <Bar source={sample} picture="/assets/images/yuqi-guo-profile-512.png" name="Yuqi Guo" email="owner@example.com" label="Signed in with Google: picture and new items" />
        <Bar source={empty} name="Yuqi Guo" email="owner@example.com" label="No picture and nothing waiting" />
      </div>
    </div>
  );
}
