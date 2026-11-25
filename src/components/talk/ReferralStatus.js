import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { TALK_PATH } from "./links";
import styles from "./Talk.module.css";

export const STATUS_KEY = "talk:referral:status:v1";
const TOKEN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/;

// What each stage means, in the order a request moves through them. The page says where the
// request stands; it never shows a score or a reason.
const STEPS = [
  { id: "received", label: "Received" },
  { id: "screening", label: "Screening" },
  { id: "review", label: "With Yuqi" },
  { id: "outcome", label: "Outcome" },
];
const STAGES = {
  screening: { step: 1, title: "Your request is being screened", text: "The résumé is checked and the request is screened against what I look for. This usually takes under a minute; this page updates by itself." },
  file_problem: { step: 1, tone: "warn", title: "Your résumé could not be read", text: "The file was not a plain PDF, was password-protected, or contained something a résumé does not need, so it was deleted. Nothing else was lost: you can send the request again with a plain PDF." },
  review: { step: 2, title: "Your request is with Yuqi", text: "It passed the automatic checks that could be made and is waiting for me to read it. There is nothing you need to do." },
  qualified: { step: 2, title: "Your request passed screening", text: "I have been asked to submit your referral. A referral is not guaranteed, and it is not a job offer: I still read the request myself." },
  referred: { step: 3, done: true, title: "You have been referred", text: "I submitted your referral. What happens next is decided by the company’s recruiting team, who will contact you directly if they go ahead." },
  not_selected: { step: 3, done: true, tone: "warn", title: "This request was not selected", text: "I am not able to refer you for this request. Requests are screened automatically against what I look for before I refer anyone, and this outcome is not a judgement of you. Your résumé file is deleted." },
  closed: { step: 3, done: true, title: "This request is closed", text: "It is no longer being considered. Your résumé file is deleted." },
};
const when = (value) => { try { return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } };

export default function ReferralStatus() {
  const [token, setToken] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const polls = useRef(0);

  // The link carries the token after "#", which never leaves the browser except in the request below.
  // On the device the request was sent from, the page also works without the link.
  useEffect(() => {
    let found = window.location.hash.slice(1);
    try { if (TOKEN.test(found)) localStorage.setItem(STATUS_KEY, found); else found = localStorage.getItem(STATUS_KEY) || ""; } catch { /* Storage is optional. */ }
    setToken(TOKEN.test(found) ? found : "");
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch("/api/referral/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 404) { setStatus(null); setError("not_found"); return; }
      if (!response.ok) throw new Error(body.error || "The status could not be loaded.");
      setStatus(body.status); setError("");
    } catch (failure) { setError(failure instanceof TypeError ? "The connection dropped. Try again in a moment." : failure.message); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // While it is being screened, look again every few seconds for about a minute, then leave it to the button.
  useEffect(() => {
    if (status?.stage !== "screening" || polls.current >= 12) return undefined;
    const timer = setTimeout(() => { polls.current += 1; load(); }, 5000);
    return () => clearTimeout(timer);
  }, [status, load]);

  if (token === null) return <div className={styles.hub}><p className={styles.lead}>Loading…</p></div>;
  if (!token || error === "not_found") {
    return (
      <div className={styles.hub}><div className={styles.explain}>
        <h2 className={styles.panelTitle}>{token ? "This request could not be found" : "Open this page from your status link"}</h2>
        <p>{token
          ? "The link may be incomplete, or the request has been removed. Requests are kept for up to 180 days."
          : "The link was shown when you sent your referral request, and it is in the confirmation email if one was sent. On the device you used to send the request, this page opens without it."}</p>
        <div className={styles.explainActions}><Link href={TALK_PATH}><a className={styles.secondary}>Back to Talk with me</a></Link></div>
      </div></div>
    );
  }
  if (!status) {
    return <div className={styles.hub}><p className={styles.lead} role={error ? "alert" : "status"}>{error || "Loading your request…"}</p>
      {error && <button type="button" className={styles.secondary} onClick={load}>Try again</button>}</div>;
  }

  const stage = STAGES[status.stage] || STAGES.review;
  return (
    <div className={styles.hub}>
      <ol className={styles.track} aria-label="Progress of your request">
        {STEPS.map((item, index) => {
          const state = index < stage.step || (stage.done && index === stage.step) ? "done" : index === stage.step ? "current" : "todo";
          return <li key={item.id} className={styles.trackStep} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className={styles.trackDot}>{state === "done" ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
            <span>{item.label}</span>
          </li>;
        })}
      </ol>
      <div className={styles.explain} data-tone={stage.tone} role="status">
        <h2 className={styles.panelTitle}>
          {status.stage === "screening" ? <LoaderCircle size={20} className={styles.spinner} aria-hidden="true" /> : stage.tone === "warn" ? <CircleAlert size={20} aria-hidden="true" /> : null}
          {stage.title}
        </h2>
        <p>{stage.text}</p>
        {status.stage === "file_problem" && <div className={styles.explainActions}><Link href={`${TALK_PATH}?intent=referral`}><a className={styles.primary}>Send the request again</a></Link></div>}
      </div>
      <dl className={styles.statusFacts}>
        <div><dt>Reference</dt><dd><span className={styles.reference}>{status.reference}</span></dd></div>
        <div><dt>For</dt><dd>{status.roles.join(" · ")}{status.company ? ` at ${status.company}` : ""}</dd></div>
        <div><dt>Sent</dt><dd>{when(status.receivedAt)}</dd></div>
        <div><dt>Last change</dt><dd>{when(status.updatedAt)}</dd></div>
      </dl>
      <div className={styles.explainActions}>
        <button type="button" className={styles.secondary} onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? styles.spinner : undefined} aria-hidden="true" />Check again</button>
      </div>
      {error && <p className={styles.notice} role="alert">{error}</p>}
      <p className={styles.small} style={{ display: "block", marginTop: 18 }}>Keep this link to yourself: anyone who has it can see this page. One request per person is considered for each company.</p>
    </div>
  );
}
