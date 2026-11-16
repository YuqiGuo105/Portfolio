import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Copy, Download, Mail, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { RECOMMENDATION_LABELS, RELATIONSHIPS, STATUSES } from "../../lib/referral/config.mjs";
import { sameCompany } from "../../lib/currentRole.mjs";
import styles from "./ReferralInbox.module.css";

const STATUS_LABELS = { new: "New", reviewing: "Reviewing", referred: "Referred", declined: "Declined", archived: "Archived" };
const FLAG_LABELS = { spam: "Looks like spam", injection: "Tried to steer the AI", off_topic: "Off topic", incomplete: "Missing details" };
const CONSISTENCY = { consistent: "Introduction matches the résumé.", minor_gaps: "Small gaps between the introduction and the résumé.", conflicts: "The introduction and the résumé disagree.", not_checked: "The résumé was not compared with the introduction." };
const RANK = { strong: 0, promising: 1, unclear: 2, weak: 3 };

const when = (value) => {
  if (!value) return "";
  try { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return value; }
};

const pending = (request) => request.state === "queued" || request.state === "screening";

// A request sent while I worked somewhere else: I can no longer refer for it.
const elsewhere = (request, offer) => Boolean(request.company && offer?.company && !sameCompany(request.company, offer.company));

function Signal({ request, offer }) {
  const note = request.screening || {};
  const ai = note.source === "ai";
  const former = elsewhere(request, offer) ? <span className={styles.pill} data-tone="flag">For {request.company}, a previous employer</span> : null;
  if (pending(request)) return <span className={styles.signal}><span className={styles.pill} data-tone="unclear">Screening in progress</span>{former}</span>;
  return (
    <span className={styles.signal}>
      <span className={styles.pill} data-tone={ai ? note.recommendation : "unclear"}>
        {ai ? `${RECOMMENDATION_LABELS[note.recommendation] || "Needs a closer look"}${Number.isInteger(note.fit) ? ` · ${note.fit}` : ""}` : "Not AI-screened"}
      </span>
      {former}
      {request.state === "file_rejected" && <span className={styles.pill} data-tone="weak">Résumé refused</span>}
      {(note.flags || []).filter((flag) => flag !== "incomplete").map((flag) => <span key={flag} className={styles.pill} data-tone="flag">{FLAG_LABELS[flag] || flag}</span>)}
    </span>
  );
}

function Detail({ request, busy, onStatus, onNote, onDelete, onResume, onRescreen }) {
  const note = request.screening || {};
  const [ownerNote, setOwnerNote] = useState(request.owner_note || "");
  const [copied, setCopied] = useState(false);
  const relationship = RELATIONSHIPS.find((item) => item.id === request.relationship)?.label || request.relationship;
  const copy = async () => {
    try { await navigator.clipboard.writeText(request.intro); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* Clipboard may be blocked; the text is selectable. */ }
  };
  // A completeness check lists what was provided and what is missing; only a model's note has strengths and concerns.
  const ai = note.source === "ai";
  const lists = [[ai ? "Strengths" : "Provided", note.strengths], [ai ? "Concerns" : "Missing", note.concerns], ["Worth asking", note.followUps]].filter(([, items]) => items?.length);
  const hasFile = Boolean(request.resume_path) && request.state === "ready";
  const fileNote = pending(request) ? "being checked" : request.state === "file_rejected" ? "refused and deleted" : request.resume_path ? "" : "deleted";
  return (
    <div className={styles.detail}>
      <div>
        <div className={styles.block}>
          <h4 className={styles.blockTitle}>
            Introduction, in the applicant’s own words
            <button type="button" className={styles.copy} onClick={copy}>{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button>
          </h4>
          <p className={styles.paste}>{request.intro}</p>
        </div>
        <div className={styles.block}>
          <h4 className={styles.blockTitle}>{pending(request) ? "Screening" : note.source === "ai" ? "AI note" : "Completeness check"}</h4>
          <div className={styles.note}>
            {pending(request)
              ? <p>This request is waiting to be screened. It usually takes under a minute; refresh to see the note.</p>
              : <>
                <p>{note.summary || "No note was recorded for this request."}</p>
                {lists.map(([title, items]) => (
                  <div key={title}><p className={styles.noteLabel}>{title}</p><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>
                ))}
                <p className={styles.caveat}>
                  {note.source === "ai"
                    ? `${CONSISTENCY[note.consistency] || CONSISTENCY.not_checked} ${note.resumeRead ? "The model read the résumé." : "The model saw the form answers only."} A heuristic to help you triage, not a decision.`
                    : "No model judged this request. Read the résumé and the introduction."}
                </p>
              </>}
          </div>
        </div>
        {request.why_role && <div className={styles.block}><h4 className={styles.blockTitle}>Why this role</h4><p className={styles.plain}>{request.why_role}</p></div>}
        {request.requirements && <div className={styles.block}><h4 className={styles.blockTitle}>Requirements they pasted</h4><p className={styles.plain}>{request.requirements}</p></div>}
      </div>
      <div>
        <div className={styles.block}>
          <h4 className={styles.blockTitle}>Details</h4>
          <dl className={styles.facts}>
            {request.company && <><dt>Company</dt><dd>{request.company}</dd></>}
            <dt>Posting</dt><dd><a href={request.job_url} target="_blank" rel="noopener noreferrer">{request.job_id ? `Job ${request.job_id}` : "Open the posting"}</a>{request.location ? ` · ${request.location}` : ""}</dd>
            <dt>Email</dt><dd><a href={`mailto:${request.email}?subject=${encodeURIComponent(`Your referral request: ${request.role_title}`)}`}>{request.email}</a></dd>
            {request.profile_url && <><dt>Profile</dt><dd><a href={request.profile_url} target="_blank" rel="noopener noreferrer">{request.profile_url.replace(/^https:\/\/(www\.)?/, "")}</a></dd></>}
            {request.current_title && <><dt>Now</dt><dd>{request.current_title}</dd></>}
            {request.years_experience !== null && request.years_experience !== undefined && <><dt>Experience</dt><dd>{request.years_experience} years</dd></>}
            <dt>Connection</dt><dd>{[relationship, request.relationship_note].filter(Boolean).join(" · ")}</dd>
            <dt>Résumé</dt><dd>{request.resume_filename}{fileNote ? ` · ${fileNote}` : ""}</dd>
            <dt>Reference</dt><dd>{request.reference}</dd>
          </dl>
          <div className={styles.buttons}>
            <button type="button" className={styles.action} disabled={busy || !hasFile} onClick={onResume}><Download size={13} aria-hidden="true" />Download résumé</button>
            <button type="button" className={styles.action} disabled={busy || !hasFile} onClick={onRescreen}><RotateCw size={13} aria-hidden="true" />Screen again</button>
          </div>
        </div>
        <div className={styles.block}>
          <h4 className={styles.blockTitle}>Status</h4>
          <div className={styles.buttons} style={{ marginTop: 0 }}>
            {STATUSES.map((status) => (
              <button key={status} type="button" className={styles.action} aria-pressed={request.status === status} disabled={busy}
                onClick={() => request.status !== status && onStatus(status)}>{STATUS_LABELS[status]}</button>
            ))}
          </div>
          <p className={styles.caveat}>Declining or archiving deletes the résumé file straight away. Otherwise it is deleted 30 days after the request arrived.</p>
        </div>
        <div className={styles.block}>
          <h4 className={styles.blockTitle}><label htmlFor={`note-${request.id}`}>Your note</label></h4>
          <textarea id={`note-${request.id}`} className={styles.ownerNote} value={ownerNote} maxLength={2000} onChange={(event) => setOwnerNote(event.target.value)} />
          <div className={styles.buttons}>
            <button type="button" className={styles.action} disabled={busy || ownerNote.trim() === (request.owner_note || "")} onClick={() => onNote(ownerNote)}>Save note</button>
            <a className={styles.action} href={`mailto:${request.email}?subject=${encodeURIComponent(`Your referral request: ${request.role_title}`)}`}><Mail size={13} aria-hidden="true" />Reply by email</a>
            <button type="button" className={styles.danger} disabled={busy} onClick={onDelete}><Trash2 size={13} aria-hidden="true" />Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// `api` is { list(), update(id, change), remove(id), resume(id) }: the admin API in production, the
// in-memory preview API on the local preview page.
export default function ReferralInbox({ api, onState }) {
  const [requests, setRequests] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("new");
  const [sort, setSort] = useState("newest");
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState("");
  // Where requests are open right now: { company, accepting, reason, switchedOn, since }.
  const [offer, setOffer] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const payload = await api.list();
      setEnabled(payload.enabled !== false);
      setRequests(Array.isArray(payload.requests) ? payload.requests : []);
      setOffer(payload.offer || null);
    } catch (err) { setError(err.message || "Referral requests could not be loaded."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { onState?.({ loading, reload: load }); }, [loading, load, onState]);

  const counts = useMemo(() => Object.fromEntries(STATUSES.map((status) => [status, requests.filter((item) => item.status === status).length])), [requests]);
  const shown = useMemo(() => {
    const rows = requests.filter((item) => tab === "all" || item.status === tab);
    const rank = (item) => (item.screening?.source === "ai" ? RANK[item.recommendation] ?? 2 : 2);
    return sort === "match"
      ? [...rows].sort((a, b) => rank(a) - rank(b) || (b.fit ?? -1) - (a.fit ?? -1) || b.created_at.localeCompare(a.created_at))
      : [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [requests, tab, sort]);

  async function change(id, body) {
    setBusy(id); setError("");
    try {
      const updated = await api.update(id, body);
      setRequests((current) => current.map((item) => (item.id === id ? { ...item, ...updated } : item)));
    } catch (err) { setError(err.message || "The request could not be updated."); }
    finally { setBusy(""); }
  }
  // Pause or reopen the form, or read the work history again straight after a job change.
  async function setting(change) {
    setBusy("offer"); setError("");
    try { const result = await api.offer(change); setOffer(result.offer || null); }
    catch (err) { setError(err.message || "That setting could not be changed."); }
    finally { setBusy(""); }
  }

  async function download(id) {
    setBusy(id); setError("");
    try { const { url } = await api.resume(id); window.open(url, "_blank", "noopener"); }
    catch (err) { setError(err.message || "The résumé could not be opened."); }
    finally { setBusy(""); }
  }
  async function remove(id) {
    if (!window.confirm("Delete this request? It cannot be undone.")) return;
    setBusy(id); setError("");
    try { await api.remove(id); setRequests((current) => current.filter((item) => item.id !== id)); setOpen(""); }
    catch (err) { setError(err.message || "The request could not be deleted."); }
    finally { setBusy(""); }
  }

  return (
    <div className={styles.inbox}>
      {!enabled && <div className={styles.banner}>The referral_requests table is missing. Apply supabase/migrations/20261116090000_referral_requests.sql; until then the referral form cannot accept requests.</div>}
      {error && <div className={styles.banner} role="alert">{error}</div>}
      {offer && (
        <div className={styles.offer} data-open={offer.accepting ? "yes" : "no"}>
          <p className={styles.offerText}>
            {offer.accepting && <>The form on /talk is open for referrals at <strong>{offer.company}</strong>, your current employer in the work history{offer.since ? ` (since ${offer.since})` : ""}.</>}
            {!offer.accepting && offer.reason === "paused" && <>The form on /talk is closed: you paused it{offer.company ? <>. When open, it is for <strong>{offer.company}</strong></> : null}.</>}
            {!offer.accepting && offer.reason === "no_employer" && <>The form on /talk is closed: your work history has no current employer. It opens when a role ending in “Current” is added.</>}
            {!offer.accepting && offer.reason === "unknown" && <>The work history could not be read just now, so the form on /talk is closed until it can.</>}
          </p>
          <div className={styles.offerActions}>
            {offer.switchedOn !== false
              ? <button type="button" className={styles.action} disabled={busy === "offer"} onClick={() => setting({ action: "accepting", accepting: false })}>Pause requests</button>
              : <button type="button" className={styles.action} disabled={busy === "offer"} onClick={() => setting({ action: "accepting", accepting: true })}>Open requests</button>}
            <button type="button" className={styles.action} disabled={busy === "offer"} onClick={() => setting({ action: "refresh" })} title="Read the work history again and regenerate the pages that name the employer">Re-read work history</button>
          </div>
        </div>
      )}
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Request status">
          {[...STATUSES, "all"].map((status) => (
            <button key={status} type="button" role="tab" className={styles.tab} aria-selected={tab === status} onClick={() => { setTab(status); setOpen(""); }}>
              {status === "all" ? "All" : STATUS_LABELS[status]}<span className={styles.count}>{status === "all" ? requests.length : counts[status]}</span>
            </button>
          ))}
        </div>
        <label className={styles.sort}>Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="newest">Newest first</option>
            <option value="match">Strongest match first</option>
          </select>
        </label>
      </div>
      <div className={styles.list}>
        {loading && !requests.length && <p className={styles.empty}><RefreshCw size={14} aria-hidden="true" /> Loading requests…</p>}
        {!loading && !shown.length && <p className={styles.empty}>{tab === "new" ? `No new requests. They appear here when someone asks for a referral${offer?.company ? ` at ${offer.company}` : ""} on /talk.` : "Nothing in this list."}</p>}
        {shown.map((request) => (
          <div key={request.id} className={styles.item}>
            <button type="button" className={styles.rowButton} aria-expanded={open === request.id} onClick={() => setOpen(open === request.id ? "" : request.id)}>
              <span className={styles.who}><strong>{request.name}</strong><span>{request.role_title}</span></span>
              <Signal request={request} offer={offer} />
              <span className={styles.when}>{tab === "all" && <span className={styles.pill} data-tone="status" style={{ marginRight: 8 }}>{STATUS_LABELS[request.status]}</span>}{when(request.created_at)}</span>
              <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />
            </button>
            {open === request.id && (
              <Detail key={request.id} request={request} busy={busy === request.id}
                onStatus={(status) => change(request.id, { action: "status", status })}
                onNote={(note) => change(request.id, { action: "note", note })}
                onResume={() => download(request.id)}
                onRescreen={() => change(request.id, { action: "rescreen" })}
                onDelete={() => remove(request.id)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
