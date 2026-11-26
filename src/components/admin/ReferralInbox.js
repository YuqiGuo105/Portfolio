import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Copy, Download, Mail, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { RELATIONSHIPS, STATUSES } from "../../lib/referral/config.mjs";
import { currentScreening, EVIDENCE_PATHS, linkedInProfile, screeningLabel, screeningRank } from "../../lib/referral/rubric.mjs";
import { sameCompany } from "../../lib/currentRole.mjs";
import { storedRoles } from "../../lib/referral/roles.mjs";
import styles from "./ReferralInbox.module.css";

const STATUS_LABELS = { new: "New", reviewing: "Reviewing", referred: "Referred", declined: "Declined", archived: "Archived" };
const FLAG_LABELS = { spam: "Looks like spam", injection: "Tried to steer the AI", off_topic: "Off topic", incomplete: "Missing details" };
const CHECK_LABELS = { verified: "Checked against public data: the cited work is there.", contradicted: "Checked against public data: the cited references do not hold, so this path is capped at 39.",
  unavailable: "The public lookup could not be made; judged on what was submitted." };
const OUTCOME = { passed: "Passed screening", auto_declined: "Declined automatically", review: "Waiting for you" };
const CONSISTENCY = { consistent: "Introduction matches the résumé.", minor_gaps: "Small gaps between the introduction and the résumé.", conflicts: "The introduction and the résumé disagree.", not_checked: "The résumé was not compared with the introduction." };

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
      <span className={styles.pill} data-tone={ai && currentScreening(note) ? note.recommendation : "unclear"}>
        {screeningLabel(note)}
      </span>
      {former}
      {request.state === "file_rejected" && <span className={styles.pill} data-tone="weak">Résumé refused</span>}
      {(note.flags || []).filter((flag) => flag !== "incomplete").map((flag) => <span key={flag} className={styles.pill} data-tone="flag">{FLAG_LABELS[flag] || flag}</span>)}
    </span>
  );
}

function EvidenceScore({ request, busy, onBadge }) {
  const note = request.screening;
  const [reviewNote, setReviewNote] = useState("");
  const profile = linkedInProfile(request.profile_url) || linkedInProfile(note.linkedinProfile);
  const save = async (confirmed) => { if (await onBadge(confirmed, reviewNote)) setReviewNote(""); };
  return (
    <div className={styles.evidenceScore}>
      <p className={styles.noteLabel}>Evidence score · {note.score}/100 · Pass mark 60</p>
      <p className={styles.caveat}>One strong path is required. Scores are not added together. AI assesses submitted evidence, not job fit. GitHub and LeetCode links are looked up; they describe an account, not proof of whose it is.</p>
      {Object.entries(EVIDENCE_PATHS).map(([id, label]) => {
        const item = note.criteria[id];
        return <details key={id} className={styles.evidencePath}>
          <summary><span>{label}</span><strong>{item.score}/100</strong><span className={styles.pill} data-tone={item.eligible ? "strong" : "unclear"}>
            {item.eligible ? "Meets gate" : item.pendingBadge ? "You did not confirm the profile" : "Not established"}
          </span><ChevronRight className={styles.evidenceChevron} size={15} aria-hidden="true" /></summary>
          <p>{item.reason}</p>
          {id !== "employer" && item.check && item.check !== "unchecked" && <p className={styles.caveat}><strong>{CHECK_LABELS[item.check]}</strong></p>}
          {!!note.checkFacts?.[id]?.length && <ul>{note.checkFacts[id].map((text) => <li key={text}>{text}</li>)}</ul>}
          {!!item.evidence.length && <ul>{item.evidence.map((text) => <li key={text}>{text}</li>)}</ul>}
          {!!item.links.length && <ul>{item.links.map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>}
        </details>;
      })}
      <details className={styles.evidencePath}>
        <summary><span>Official LinkedIn badge · {note.linkedinBadge?.confirmed ? "Confirmed by owner" : "Not confirmed"}</span><ChevronRight className={styles.evidenceChevron} size={15} aria-hidden="true" /></summary>
        <p className={styles.caveat}>A request with strong engineering experience on the résumé reaches you without waiting for this check. Open the profile before you refer; recording “not verified” takes the pass away. Premium, a LinkedIn login, a profile link or the applicant&apos;s claim does not count. A badge alone does not prove their employment history.</p>
        {note.linkedinBadge && <p className={styles.caveat}>{note.linkedinBadge.note} · {when(note.linkedinBadge.checkedAt)}</p>}
        {profile ? <>
          <a className={styles.action} href={profile} target="_blank" rel="noopener noreferrer">Open LinkedIn profile</a>
          <label className={styles.noteLabel} htmlFor={`badge-${request.id}`}>Badge type and what you checked</label>
          <textarea id={`badge-${request.id}`} className={styles.ownerNote} value={reviewNote} minLength={10} maxLength={600} onChange={(event) => setReviewNote(event.target.value)} />
          <div className={styles.buttons}>
            <button type="button" className={styles.action} disabled={busy || reviewNote.trim().length < 10} onClick={() => save(true)}>Confirm official badge</button>
            <button type="button" className={styles.action} disabled={busy || reviewNote.trim().length < 10} onClick={() => save(false)}>Badge not verified</button>
          </div>
        </> : <p className={styles.caveat}>No LinkedIn member profile was supplied in the form or the résumé. The path is judged on the résumé alone.</p>}
      </details>
    </div>
  );
}

function Detail({ request, busy, onStatus, onNote, onDelete, onResume, onRescreen, onBadge }) {
  const note = request.screening || {};
  const roles = storedRoles(request);
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
                {ai && currentScreening(note) && note.criteria && <EvidenceScore request={request} busy={busy} onBadge={onBadge} />}
                {ai && !currentScreening(note) && <p className={styles.caveat}>This note used the previous job-fit policy. Screen again to apply the three evidence paths and the 60-point gate.</p>}
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
        {request.why_role && <div className={styles.block}><h4 className={styles.blockTitle}>{roles.length > 1 ? "Why these roles" : "Why this role"}</h4><p className={styles.plain}>{request.why_role}</p></div>}
      </div>
      <div>
        {roles.map((role, index) => <div className={styles.block} key={index}>
          <h4 className={styles.blockTitle}>Role {index + 1}{index === 0 ? " · First choice" : ""}</h4>
          <dl className={styles.facts}>
            <dt>Title</dt><dd>{role.roleTitle}</dd>
            <dt>Posting</dt><dd><a href={role.jobUrl} target="_blank" rel="noopener noreferrer">{role.jobId ? `Job ${role.jobId}` : "Open the posting"}</a></dd>
            {role.location && <><dt>Location</dt><dd>{role.location}</dd></>}
          </dl>
          {role.requirements && <p className={styles.plain}>{role.requirements}</p>}
        </div>)}
        <div className={styles.block}>
          <h4 className={styles.blockTitle}>Details</h4>
          <dl className={styles.facts}>
            {request.company && <><dt>Company</dt><dd>{request.company}</dd></>}
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
          <p className={styles.caveat}>
            {OUTCOME[request.outcome] ? `${OUTCOME[request.outcome]}. ` : ""}
            {note.auto?.declined && request.status === "declined" ? `Scored under ${note.auto.below}, so it was declined without waiting for you; choose another status to overrule that. ` : ""}
            {request.outcome === "passed" ? (request.outcome_mail_at ? `Confirmation to the applicant and the note to you were sent ${when(request.outcome_mail_at)}. ` : "The two emails have not been sent (no no-reply mailbox, or still queued). ") : ""}
            The applicant sees the status on their page, never the score or these notes.
          </p>
          {request.status_token && <div className={styles.buttons}><a className={styles.action} href={`/talk/status#${request.status_token}`} target="_blank" rel="noopener noreferrer">See what the applicant sees</a></div>}
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
    return sort === "score"
      ? [...rows].sort((a, b) => screeningRank(b.screening) - screeningRank(a.screening) || b.created_at.localeCompare(a.created_at))
      : [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [requests, tab, sort]);

  async function change(id, body) {
    setBusy(id); setError("");
    try {
      const updated = await api.update(id, body);
      setRequests((current) => current.map((item) => (item.id === id ? { ...item, ...updated } : item)));
      return true;
    } catch (err) { setError(err.message || "The request could not be updated."); return false; }
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
    // The link is fetched first, so opening a new window here would be blocked as a pop-up (always on
    // phones). The link answers with a download, so following it in this tab leaves the page where it is.
    try {
      const { url } = await api.resume(id);
      const link = document.createElement("a");
      link.href = url; link.rel = "noopener"; link.style.display = "none";
      document.body.appendChild(link); link.click(); link.remove();
    }
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
            <option value="score">Highest evidence score</option>
          </select>
        </label>
      </div>
      <div className={styles.list}>
        {loading && !requests.length && <p className={styles.empty}><RefreshCw size={14} aria-hidden="true" /> Loading requests…</p>}
        {!loading && !shown.length && <p className={styles.empty}>{tab === "new" ? `No new requests. They appear here when someone asks for a referral${offer?.company ? ` at ${offer.company}` : ""} on /talk.` : "Nothing in this list."}</p>}
        {shown.map((request) => (
          <div key={request.id} className={styles.item}>
            <button type="button" className={styles.rowButton} aria-expanded={open === request.id} onClick={() => setOpen(open === request.id ? "" : request.id)}>
              <span className={styles.who}><strong>{request.name}</strong><span>{request.role_title}{request.additional_roles?.length ? ` + ${request.additional_roles.length} more` : ""}</span></span>
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
                onBadge={(confirmed, reviewNote) => change(request.id, { action: "linkedin_badge", confirmed, reviewNote, expectedUpdatedAt: request.updated_at })}
                onDelete={() => remove(request.id)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
