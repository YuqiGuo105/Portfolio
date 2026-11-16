import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminStyles as ui } from "../../src/components/admin/AdminUI";
import shell from "../../src/components/admin/AdminLayout.module.css";
import WorkHistory from "../../src/components/admin/WorkHistory";

// Local preview of /admin/experience over a work history kept in memory (`npm run dev:talk`).
// It needs no sign-in because it can only be served by the preview server on this machine.
export async function getServerSideProps({ req }) {
  if (process.env.NODE_ENV !== "development" || process.env.TALK_PREVIEW !== "1" || !/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || "")) return { notFound: true };
  return { props: {} };
}

async function call(path, options) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "The preview could not do that.");
  return body;
}
const post = (body) => call("/api/referral/preview-history", { method: "POST", body: JSON.stringify(body) });

export default function ExperiencePreview() {
  const [indexed, setIndexed] = useState([]);
  const refreshLog = useCallback(() => call("/api/referral/preview-history").then((body) => setIndexed(body.indexed || [])).catch(() => {}), []);
  const api = useMemo(() => ({
    list: () => call("/api/referral/preview-history"),
    get: (id) => call(`/api/referral/preview-history?id=${encodeURIComponent(id)}`),
    save: (id, data) => post({ action: "save", id, data }),
    publish: (id, options) => post({ action: "publish", id, ...options }).finally(refreshLog),
    refresh: () => post({ action: "refresh" }),
  }), [refreshLog]);
  useEffect(() => { refreshLog(); }, [refreshLog]);
  return (
    <div className={shell.shell} style={{ padding: "32px clamp(16px, 4vw, 48px) 64px" }}>
      <Head><title>Work history | Local preview</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main>
        <div className={ui.page} style={{ maxWidth: 900, margin: "0 auto" }}>
          <header className={ui.pageHeader}>
            <div>
              <h1 className={ui.title}>Work history <span className={`${ui.status} ${ui.statusPending}`} style={{ marginLeft: 8, verticalAlign: "middle" }}>Local preview</span></h1>
              <p className={ui.subtitle}>
                This is what /admin/experience will show, over a made-up work history kept in memory. Record a job change, then open{" "}
                <Link href="/talk?intent=referral"><a>the referral form</a></Link>, <Link href="/"><a>the home page</a></Link> and{" "}
                <Link href="/admin/referrals-preview"><a>the review list</a></Link> to see them follow. Restarting the preview resets it.
              </p>
            </div>
          </header>
          <WorkHistory api={api} />
          <section className={ui.section} style={{ marginTop: 28 }}>
            <div className={ui.sectionHeader}><h2 className={ui.sectionTitle}>What publishing would have triggered</h2><span className={ui.sectionMeta}>Recorded here, nothing is sent</span></div>
            {indexed.length
              ? <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>{indexed.map((entry) => <li key={entry.at + entry.role}>{entry.role}: search index and assistant knowledge queued; subscribers {entry.notified ? "emailed" : "not emailed"}</li>)}</ul>
              : <p className={ui.subtitle}>Nothing yet. On the real site each published role is re-indexed for search and for the assistant.</p>}
          </section>
        </div>
      </main>
    </div>
  );
}
