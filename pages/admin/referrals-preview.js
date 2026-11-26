import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import ReferralInbox from "../../src/components/admin/ReferralInbox";
import shell from "../../src/components/admin/AdminLayout.module.css";
import ui from "../../src/components/admin/AdminPage.module.css";

// Local preview of /admin/referrals over made-up requests (`npm run dev:talk`). It needs no
// sign-in because it can only be served by the preview server on this machine.
async function request(path, options) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Preview unavailable");
  return body;
}

export default function ReferralsPreview() {
  const [outbox, setOutbox] = useState({ outbox: [], aiEnabled: false });
  const [tick, setTick] = useState(0);
  const api = useMemo(() => ({
    list: () => request("/api/referral/preview"),
    update: (id, change) => request("/api/referral/preview", { method: "POST", body: JSON.stringify({ id, ...change }) }),
    remove: (id) => request("/api/referral/preview", { method: "POST", body: JSON.stringify({ id, action: "delete" }) }),
    resume: (id) => request("/api/referral/preview", { method: "POST", body: JSON.stringify({ id, action: "resume" }) }),
    offer: (change) => request("/api/referral/preview", { method: "POST", body: JSON.stringify(change) }),
  }), []);
  useEffect(() => { request("/api/referral/preview?view=outbox").then(setOutbox).catch(() => {}); }, [tick]);
  return (
    <div className={shell.shell} style={{ padding: "32px clamp(16px, 4vw, 48px) 64px" }}>
      <Head><title>Referral requests | Local preview</title><meta name="robots" content="noindex,nofollow" /></Head>
      <div className={ui.page} style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header className={ui.pageHeader}>
          <div>
            <h1 className={ui.title}>Referral requests <span className={`${ui.status} ${ui.statusPending}`} style={{ marginLeft: 8, verticalAlign: "middle" }}>Local preview</span></h1>
            <p className={ui.subtitle}>
              This is what /admin/referrals will show. Entries marked “sample” are made up and have no résumé file; anything you send from{" "}
              <Link href="/referral"><a style={{ color: "#0f766e" }}>the form on /referral</a></Link> on this machine appears here too, with its file.
              {outbox.aiEnabled ? " AI screening is on and uses the shared monthly budget." : " No model runs in this preview: a stand-in passes a request that names a GitHub or LeetCode link and scores any other under the bar, so you can watch a pass (two emails below) and an automatic decline."}
            </p>
          </div>
          <div className={ui.headerActions}><button className={ui.buttonSecondary} onClick={() => setTick((value) => value + 1)}>Refresh</button></div>
        </header>
        <ReferralInbox key={tick} api={api} />
        <section className={ui.section}>
          <div className={ui.sectionHeader}><h2 className={ui.sectionTitle}>Emails this preview would have sent</h2><span className={ui.sectionMeta}>Kept in memory, never sent</span></div>
          {outbox.outbox.length === 0
            ? <p className={ui.stateText}>None yet. Send a message or a referral request from /talk and refresh.</p>
            : outbox.outbox.map((mail) => (
              <details key={mail.at + mail.subject} style={{ border: "1px solid #e3e7eb", borderRadius: 8, padding: "10px 14px", background: "#fff" }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 650 }}>{mail.subject}{mail.replyTo ? <span className={ui.sectionMeta}> · reply-to {mail.replyTo}</span> : null}</summary>
                <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", font: "12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace", color: "#35414b" }}>{mail.text}</pre>
              </details>
            ))}
        </section>
      </div>
    </div>
  );
}

export async function getServerSideProps({ req }) {
  if (process.env.NODE_ENV !== "development" || process.env.TALK_PREVIEW !== "1" || !/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || "")) return { notFound: true };
  return { props: {} };
}
