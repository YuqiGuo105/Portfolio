import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, CircleCheck, FileText, LoaderCircle } from "lucide-react";
import ContactVerification from "../ContactVerification";
import { INTRO_MAX, INTRO_MIN, LIMITS, MAX_REFERRAL_ROLES, RELATIONSHIPS, RESUME_MAX_BYTES } from "../../lib/referral/config.mjs";
import { firstPersonWords, hasPlaceholder, httpsUrl, introTemplate, introVoice, parseReferralRoles } from "../../lib/referral/fields.mjs";
import { expandPostingLinks, postingLinks, requestRoles, ROLE_FIELDS } from "../../lib/referral/roles.mjs";
import { STATUS_KEY } from "./ReferralStatus";
import styles from "./Talk.module.css";

const STEPS = [
  { id: "role", label: "The roles" },
  { id: "you", label: "About you" },
  { id: "intro", label: "Introduction" },
  { id: "review", label: "Review and send" },
];
const EMPTY_ROLE = { roleTitle: "", jobUrl: "", jobId: "", location: "", requirements: "" };
const EMPTY = {
  ...EMPTY_ROLE, additionalRoles: [],
  name: "", email: "", profileUrl: "", currentTitle: "", years: "", relationship: "", relationshipNote: "",
  intro: "", whyRole: "",
};
// Which step holds each field, so a server-side complaint can take the applicant to the right place.
const FIELD_STEP = {
  roleTitle: 0, jobUrl: 0, jobId: 0, location: 0, requirements: 0, additionalRoles: 0,
  name: 1, email: 1, profileUrl: 1, currentTitle: 1, years: 1, relationship: 1, relationshipNote: 1, resume: 1,
  intro: 2, whyRole: 2, consent: 3,
};
const DRAFT_KEY = "talk:referral:v1";
const REQUEST_KEY = "talk:referral:key:v1";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const megabytes = (bytes) => (bytes / 1048576).toFixed(1);

function validate(step, data, resume) {
  const errors = {};
  if (step === 0) {
    if (!data.roleTitle.trim()) errors.roleTitle = "Enter the role title as it appears on the posting.";
    const links = postingLinks(data.jobUrl);
    if (!links.length) errors.jobUrl = "Paste the link to the posting.";
    else if (links.length > MAX_REFERRAL_ROLES) errors.jobUrl = "Enter no more than three posting links, separated by commas.";
    else if (links.some(link => !httpsUrl(link, LIMITS.jobUrl))) errors.jobUrl = "Use the full https:// link to the posting.";
    if (!Object.keys(errors).length) try { parseReferralRoles(expandPostingLinks(data)); } catch (error) {
      const field = error.field?.startsWith("additionalRoles") ? "jobUrl" : error.field || "jobUrl";
      errors[field] = error.code === "duplicate_role" ? "This opening is already included. Choose another posting or remove this role."
        : error.code === "invalid_roles" ? "Choose between one and three openings."
        : field.endsWith("jobUrl") ? "Use the full https:// link to the posting."
        : field.endsWith("roleTitle") ? "Enter the role title as it appears on the posting."
        : "Please check this field and its length.";
    }
  }
  if (step === 1) {
    if (!data.name.trim()) errors.name = "Enter your full name.";
    if (!EMAIL.test(data.email.trim())) errors.email = "Enter an email address you can be reached at.";
    if (data.profileUrl.trim() && !httpsUrl(data.profileUrl, LIMITS.profileUrl)) errors.profileUrl = "Use a full https:// link, or leave this empty.";
    if (data.years !== "" && !/^\d{1,2}$/.test(String(data.years).trim())) errors.years = "Enter a whole number of years, or leave this empty.";
    if (!resume) errors.resume = "Attach your résumé as a PDF.";
    if (!data.relationship) errors.relationship = "Choose the option that fits best.";
  }
  if (step === 2) {
    const intro = data.intro.trim();
    if (intro.length < INTRO_MIN) errors.intro = `Write at least ${INTRO_MIN} characters: two or three sentences is enough.`;
    else if (hasPlaceholder(intro)) errors.intro = "Replace the parts in [brackets] with your own details.";
    else if (introVoice(intro) === "first_person") errors.intro = "Rewrite this about yourself by name: “Alex is…”, not “I am…”.";
  }
  return errors;
}

function Field({ id, label, optional, hint, error, counter, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}{optional && <span className={styles.optional}>optional</span>}
        {counter && <span className={styles.counter}>{counter}</span>}
      </label>
      {hint && <span className={styles.hint} id={`${id}-hint`}>{hint}</span>}
      {children}
      {error && <p className={styles.error} id={`${id}-error`} role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{error}</span></p>}
    </div>
  );
}

// `company` is the employer the referral is for: the current one in the work history, passed down
// from the page. It is sent with the request so the server can refuse a form opened before a job change.
export default function ReferralWizard({ company }) {
  const [data, setData] = useState(EMPTY);
  const [resume, setResume] = useState(null);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [errors, setErrors] = useState({});
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState("");
  const [verificationReset, setVerificationReset] = useState(0);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  // "", "saving", "uploading" or "finishing": which part of sending is under way.
  const [phase, setPhase] = useState("");
  const heading = useRef(null);
  const pendingFocus = useRef(null);
  const moved = useRef(false);
  const inFlight = useRef(false);
  // One key per request, generated once and kept for this tab: sending it again never creates a second request.
  const requestKey = useRef("");
  // What the server answered when it accepted the form, kept so a failed upload can be retried on its own.
  const ticket = useRef(null);

  // Text answers survive a reload in this tab; the résumé has to be attached again.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      if (saved && typeof saved === "object") setData((current) => ({ ...current,
        ...Object.fromEntries(Object.entries(saved).filter(([key, value]) => key in EMPTY && key !== "additionalRoles" && typeof value === "string")),
        jobUrl: typeof saved.jobUrl === "string" ? [...new Set([saved.jobUrl, ...(Array.isArray(saved.additionalRoles) && postingLinks(saved.jobUrl).length <= 1
          ? saved.additionalRoles.map(role => typeof role?.jobUrl === "string" ? role.jobUrl : "").filter(Boolean) : [])])].join(", ") : "",
        additionalRoles: Array.isArray(saved.additionalRoles) ? saved.additionalRoles.slice(0, MAX_REFERRAL_ROLES - 1)
          .filter(role => role && typeof role === "object" && !Array.isArray(role))
          .map(role => Object.fromEntries(ROLE_FIELDS.map(key => [key, typeof role[key] === "string" ? role[key].slice(0, LIMITS[key]) : ""]))) : [],
      }));
    } catch { /* Storage is optional. */ }
  }, []);
  useEffect(() => {
    let key = "";
    try { key = sessionStorage.getItem(REQUEST_KEY) || ""; } catch { /* Storage is optional. */ }
    if (!/^[0-9a-f-]{36}$/.test(key)) key = crypto.randomUUID();
    requestKey.current = key;
    try { sessionStorage.setItem(REQUEST_KEY, key); } catch { /* optional */ }
  }, []);
  useEffect(() => {
    if (done) return undefined;
    const timer = setTimeout(() => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch { /* optional */ } }, 400);
    return () => clearTimeout(timer);
  }, [data, done]);

  useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [step, done]);

  // Wait for validation errors and step changes to render before moving keyboard focus.
  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [data, errors, step]);

  // Changing an answer after the server accepted the form starts a new request, so what is sent
  // is always what is on screen. The half-finished one is discarded by the server after a day.
  const forgetTicket = () => {
    if (!ticket.current) return;
    ticket.current = null; requestKey.current = crypto.randomUUID();
    try { sessionStorage.setItem(REQUEST_KEY, requestKey.current); } catch { /* optional */ }
  };
  const set = (key) => (event) => {
    const value = event.target.value;
    forgetTicket();
    setData((current) => ({ ...current, [key]: value, ...(key === "jobUrl" ? { additionalRoles: [] } : {}) }));
    if (errors[key]) setErrors(({ [key]: _removed, ...rest }) => rest);
  };
  const input = (key, extra = {}) => ({
    id: `referral-${key}`, name: key, value: data[key], onChange: set(key), className: styles.input,
    "aria-invalid": errors[key] ? "true" : undefined,
    "aria-describedby": [extra.hint && `referral-${key}-hint`, errors[key] && `referral-${key}-error`].filter(Boolean).join(" ") || undefined,
  });

  const go = (target) => { moved.current = true; setNotice(""); setStep(target); setReached((current) => Math.max(current, target)); };
  const focusFirst = (found) => {
    const first = Object.keys(found)[0];
    pendingFocus.current = first === "relationship" ? "referral-relationship-0"
      : first.startsWith("additionalRoles") ? "referral-jobUrl" : `referral-${first}`;
  };
  const next = () => {
    const found = validate(step, data, resume);
    setErrors(found);
    if (Object.keys(found).length) { focusFirst(found); return; }
    go(step + 1);
  };

  async function pickFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fail = (message) => { setResume(null); setErrors((current) => ({ ...current, resume: message })); };
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return fail("The résumé must be a PDF file. Export it as PDF and attach it again.");
    if (file.size > RESUME_MAX_BYTES) return fail(`That file is ${megabytes(file.size)} MB. The limit is 2 MB: export a smaller PDF and attach it again.`);
    try {
      const start = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file.slice(0, 5));
      });
      if (String.fromCharCode(...start) !== "%PDF-") return fail("That file is not a PDF. Export your résumé as PDF and attach it again.");
      forgetTicket();
      setResume({ name: file.name, size: file.size, file });
      setErrors(({ resume: _removed, ...rest }) => rest);
    } catch { fail("The file could not be read. Attach it again."); }
    return undefined;
  }

  const useTemplate = () => {
    setData((current) => ({ ...current, intro: introTemplate({ name: current.name, roleTitle: current.roleTitle, company }) }));
    setErrors(({ intro: _removed, ...rest }) => rest);
    requestAnimationFrame(() => document.getElementById("referral-intro")?.focus());
  };

  // Sending has three small steps, each safe to repeat: save the answers, upload the résumé
  // straight to storage, then confirm. A failure keeps everything and "Send request" resumes
  // from the step that failed.
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    setNotice("");
    for (const index of [0, 1, 2]) {
      const found = validate(index, data, resume);
      if (Object.keys(found).length) { setErrors(found); go(index); focusFirst(found); return; }
    }
    if (!consent) { setErrors({ consent: "Please confirm how your details will be used." }); document.getElementById("referral-consent")?.focus(); return; }
    if (!ticket.current && !token) { setNotice("Please complete the verification before sending."); return; }
    inFlight.current = true; setSending(true);
    const json = { "Content-Type": "application/json" };
    const save = async () => {
      setPhase("saving");
      const response = await fetch("/api/referral", {
        method: "POST", headers: json,
        body: JSON.stringify({ ...expandPostingLinks(data), years: data.years === "" ? "" : Number(data.years), consent: true, website, turnstileToken: token, company,
          idempotencyKey: requestKey.current, resume: { name: resume.name, size: resume.size, type: "application/pdf" } }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(result.error || "Your request could not be sent. Please try again."), { field: result.field });
      ticket.current = { reference: result.reference, upload: result.upload || null, uploaded: !result.upload };
    };
    try {
      if (!ticket.current) await save();
      if (!ticket.current.uploaded) {
        setPhase("uploading");
        const put = () => fetch(ticket.current.upload.url, { method: "PUT", headers: { "Content-Type": "application/pdf", "x-upsert": "false" }, body: resume.file });
        let uploaded = await put();
        // An upload link that has expired is replaced once; "already exists" means an earlier try got through.
        if (!uploaded.ok && uploaded.status !== 409) { await save(); if (!ticket.current.uploaded) uploaded = await put(); }
        if (!ticket.current.uploaded && !uploaded.ok && uploaded.status !== 409) throw new Error("The résumé could not be uploaded. Press “Send request” to try again; your answers are saved.");
        ticket.current.uploaded = true;
      }
      setPhase("finishing");
      const finished = await fetch("/api/referral/complete", { method: "POST", headers: json, body: JSON.stringify({ idempotencyKey: requestKey.current }) });
      const result = await finished.json().catch(() => ({}));
      if (!finished.ok) {
        if (result.code === "upload_missing") ticket.current.uploaded = false;
        throw new Error(result.error || "Your request could not be confirmed. Press “Send request” to try again.");
      }
      try { sessionStorage.removeItem(DRAFT_KEY); sessionStorage.removeItem(REQUEST_KEY); } catch { /* optional */ }
      moved.current = true;
      // Kept on this device so the status page opens here without the link.
      try { if (result.statusToken) localStorage.setItem(STATUS_KEY, result.statusToken); } catch { /* optional */ }
      setDone({ reference: result.reference || ticket.current.reference, email: data.email.trim(), statusToken: result.statusToken || "" });
    } catch (error) {
      const fieldStep = error.field?.startsWith("additionalRoles.") ? 0 : FIELD_STEP[error.field];
      if (error.field && fieldStep < 3) {
        if (error.field === "resume") setResume(null);
        setErrors({ [error.field.startsWith("additionalRoles") ? "jobUrl" : error.field]: error.message });
        go(fieldStep); focusFirst({ [error.field]: true });
      } else setNotice(error instanceof TypeError ? "The connection dropped. Press “Send request” to try again; everything you entered is still here." : error.message);
    } finally {
      inFlight.current = false; setSending(false); setPhase("");
      setToken(""); setVerificationReset((value) => value + 1);
    }
  }

  if (done) {
    const statusLink = done.statusToken ? `${window.location.origin}/talk/status#${done.statusToken}` : "";
    return (
      <div className={styles.hub}><div className={styles.done} role="status">
        <h3 className={styles.panelTitle} ref={heading} tabIndex={-1}><CircleCheck size={22} aria-hidden="true" />Request received</h3>
        <p>Your reference is <span className={styles.reference}>{done.reference}</span>. It is being screened now, usually within a minute.</p>
        {statusLink && <>
          <p>Follow it on your status page. Save this link: it is the only way to open the page from another device.</p>
          <span className={styles.statusLink} data-status-link>{statusLink}</span>
          <div className={styles.explainActions}>
            <a className={styles.primary} href={statusLink}>Open my status page<ArrowRight size={17} aria-hidden="true" /></a>
            <button type="button" className={styles.secondary} onClick={async () => { try { await navigator.clipboard.writeText(statusLink); setCopied(true); } catch { /* The link is selectable. */ } }}>
              {copied ? "Link copied" : "Copy the link"}
            </button>
          </div>
        </>}
        <p>The outcome of screening is emailed to {done.email}. If your request passes, I am asked to submit your referral. A referral is not guaranteed. One request per person is considered.</p>
      </div></div>
    );
  }

  const voice = data.intro.trim() ? introVoice(data.intro) : null;
  const firstPerson = [...new Set(firstPersonWords(data.intro))].slice(0, 5);
  const relationshipLabel = RELATIONSHIPS.find((item) => item.id === data.relationship)?.label || "";
  const roles = requestRoles(expandPostingLinks(data));

  return (
    <form className={styles.hub} onSubmit={submit} noValidate aria-busy={sending} data-referral-form>
      <ol className={styles.steps} aria-label="Referral request steps">
        {STEPS.map((item, index) => {
          const state = index === step ? "current" : index < step ? "done" : "todo";
          return (
            <li key={item.id}>
              <button type="button" className={styles.step} data-state={state} disabled={index > reached || index === step}
                aria-current={index === step ? "step" : undefined} onClick={() => go(index)}>
                <span className={styles.stepNumber}>{state === "done" ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
                <span className={styles.stepLabel}>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === 0 && (
        <section aria-labelledby="referral-step-title">
          <h3 className={styles.stepHeading} id="referral-step-title" ref={heading} tabIndex={-1}>Which roles at {company}?</h3>
          <p className={styles.lead}>You can request a referral for up to three openings. Start with your first choice.</p>
          <p className={styles.voiceNote}>What I look for, at least one of: strong open-source engineering, strong LeetCode contest results, or substantial experience at a major technology or financial company. Requests are screened automatically against this, and each person can ask once.</p>
          <Field id="referral-roleTitle" label="Role title" hint="Your first-choice opening." error={errors.roleTitle}>
            <input type="text" {...input("roleTitle", { hint: true })} maxLength={LIMITS.roleTitle} placeholder="Software Engineer, Payments" autoComplete="off" />
          </Field>
          <Field id="referral-jobUrl" label="Links to the postings" hint="Up to 3 links from the company’s careers site, separated by commas. Put your first choice first." error={errors.jobUrl}>
            <textarea {...input("jobUrl", { hint: true })} className={styles.textarea} maxLength={(LIMITS.jobUrl + 2) * MAX_REFERRAL_ROLES}
              rows={3} style={{ minHeight: 100 }} placeholder="https://higher.gs.com/roles/123, https://higher.gs.com/roles/456" autoComplete="off" spellCheck={false} />
          </Field>
          <div className={styles.row}>
            <Field id="referral-jobId" label="Job or requisition ID" optional hint="First choice." error={errors.jobId}>
              <input type="text" {...input("jobId", { hint: true })} maxLength={LIMITS.jobId} autoComplete="off" />
            </Field>
            <Field id="referral-location" label="Location" optional hint="First choice." error={errors.location}>
              <input type="text" {...input("location", { hint: true })} maxLength={LIMITS.location} placeholder="New York, NY" autoComplete="off" />
            </Field>
          </div>
          <Field id="referral-requirements" label="Key requirements from the posting" optional error={errors.requirements}
            hint="Paste the three to six lines that matter most for your first choice."
            counter={data.requirements.length > LIMITS.requirements - 200 ? `${data.requirements.length}/${LIMITS.requirements}` : null}>
            <textarea {...input("requirements", { hint: true })} className={styles.textarea} maxLength={LIMITS.requirements} rows={4} />
          </Field>
        </section>
      )}

      {step === 1 && (
        <section aria-labelledby="referral-step-title">
          <h3 className={styles.stepHeading} id="referral-step-title" ref={heading} tabIndex={-1}>About you</h3>
          <p className={styles.lead}>Enough for me to recognise you and to reach you.</p>
          <div className={styles.row}>
            <Field id="referral-name" label="Full name" error={errors.name}>
              <input type="text" {...input("name")} maxLength={LIMITS.name} autoComplete="name" />
            </Field>
            <Field id="referral-email" label="Email" error={errors.email}>
              <input type="email" {...input("email")} maxLength={LIMITS.email} autoComplete="email" />
            </Field>
          </div>
          <div className={styles.row}>
            <Field id="referral-currentTitle" label="Current title and company" optional>
              <input type="text" {...input("currentTitle")} maxLength={LIMITS.currentTitle} placeholder="Software Engineer II at Northwind" autoComplete="organization-title" />
            </Field>
            <Field id="referral-years" label="Years of professional experience" optional error={errors.years}>
              <input type="text" inputMode="numeric" {...input("years")} maxLength={2} autoComplete="off" />
            </Field>
          </div>
          <Field id="referral-profileUrl" label="LinkedIn or portfolio link" optional error={errors.profileUrl}>
            <input type="url" inputMode="url" {...input("profileUrl")} maxLength={LIMITS.profileUrl} placeholder="https://" autoComplete="url" />
          </Field>
          <Field id="referral-resume" label="Résumé" hint="PDF, 2 MB or smaller. It is stored privately for up to 30 days and deleted sooner if the request is closed." error={errors.resume}>
            <div className={styles.file} data-invalid={errors.resume ? "true" : undefined}>
              <input className={styles.fileInput} type="file" id="referral-resume" accept="application/pdf,.pdf" onChange={pickFile}
                aria-describedby={`referral-resume-hint${errors.resume ? " referral-resume-error" : ""}`} />
              <label htmlFor="referral-resume" className={styles.secondary}>{resume ? "Choose another PDF" : "Choose PDF"}</label>
              {resume
                ? <span className={styles.fileName}><FileText size={17} aria-hidden="true" /><span>{resume.name}</span><small className={styles.small}>{megabytes(resume.size)} MB</small></span>
                : <span className={styles.small}>No file chosen</span>}
            </div>
          </Field>
          <fieldset className={styles.field} aria-describedby={errors.relationship ? "referral-relationship-error" : undefined}>
            <legend className={styles.label}>How do we know each other?</legend>
            <span className={styles.hint}>It is fine if we have not met.</span>
            <div className={styles.choices}>
              {RELATIONSHIPS.map((item, index) => (
                <label key={item.id} className={styles.choice}>
                  <input type="radio" name="relationship" id={`referral-relationship-${index}`} value={item.id} checked={data.relationship === item.id} onChange={set("relationship")} />
                  {item.label}
                </label>
              ))}
            </div>
            {errors.relationship && <p className={styles.error} id="referral-relationship-error" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{errors.relationship}</span></p>}
          </fieldset>
          {data.relationship && data.relationship !== "not_yet" && (
            <Field id="referral-relationshipNote" label="Where or when?" optional>
              <input type="text" {...input("relationshipNote")} maxLength={LIMITS.relationshipNote} placeholder="Same team in 2023, or the Kafka meetup in March" autoComplete="off" />
            </Field>
          )}
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="referral-step-title">
          <h3 className={styles.stepHeading} id="referral-step-title" ref={heading} tabIndex={-1}>Introduce yourself, in third person</h3>
          <p className={styles.lead}>A referral form asks me to describe you, so this paragraph is written about you, not by you.</p>
          <p className={styles.voiceNote}>Write <q>{(data.name.trim().split(/\s+/)[0]) || "Alex"} is a backend engineer who…</q> rather than <q>I am a backend engineer who…</q></p>
          <Field id="referral-intro" label="Introduction" error={errors.intro} counter={`${data.intro.trim().length}/${INTRO_MAX}`}
            hint="Write it yourself or paste one you already have. I pass it on exactly as you wrote it.">
            <textarea {...input("intro", { hint: true })} className={styles.textarea} maxLength={INTRO_MAX} rows={9} />
            {voice === "third_person" && data.intro.trim().length >= INTRO_MIN && !errors.intro && !hasPlaceholder(data.intro) && <p className={styles.voice} data-voice={voice}><CircleCheck size={15} aria-hidden="true" /><span>Reads as third person.</span></p>}
            {voice === "mixed" && <p className={styles.voice} data-voice={voice}><CircleAlert size={15} aria-hidden="true" /><span>Still has first-person wording ({firstPerson.join(", ")}). Change it to your name unless it is a quote.</span></p>}
            {voice === "first_person" && !errors.intro && <p className={styles.voice} data-voice={voice}><CircleAlert size={15} aria-hidden="true" /><span>This reads as first person ({firstPerson.join(", ")}). Rewrite it with your name.</span></p>}
          </Field>
          {!data.intro.trim() && (
            <div className={styles.helperActions}>
              <button type="button" className={styles.textButton} onClick={useTemplate}>Start from a fill-in template</button>
            </div>
          )}
          <Field id="referral-whyRole" label={roles.length > 1 ? "Why these roles?" : "Why this role?"} optional
            counter={data.whyRole.length > LIMITS.whyRole - 150 ? `${data.whyRole.length}/${LIMITS.whyRole}` : null}>
            <textarea {...input("whyRole")} className={styles.textarea} maxLength={LIMITS.whyRole} rows={3} style={{ minHeight: 88 }} />
          </Field>
        </section>
      )}

      {step === 3 && (
        <section aria-labelledby="referral-step-title">
          <h3 className={styles.stepHeading} id="referral-step-title" ref={heading} tabIndex={-1}>Check it, then send</h3>
          <p className={styles.lead}>This is what I will receive.</p>
          <div className={styles.review}>
            {roles.map((role, index) => <div className={styles.reviewGroup} key={index}>
              <h4>Role {index + 1}{index === 0 ? " · First choice" : ""}</h4>
              <dl>
                <div><dt>Role</dt><dd>{role.roleTitle} at {company}</dd></div>
                <div><dt>Posting</dt><dd>{role.jobUrl}</dd></div>
                {(role.jobId || role.location) && <div><dt>ID and location</dt><dd>{[role.jobId, role.location].filter(Boolean).join(" · ")}</dd></div>}
                {role.requirements && <div><dt>Requirements you pasted</dt><dd>{role.requirements}</dd></div>}
              </dl>
              <button type="button" className={styles.textButton} onClick={() => go(0)}>Edit<span className={styles.srOnly}> role {index + 1}</span></button>
            </div>)}
            <div className={styles.reviewGroup}>
              <h4>About you</h4>
              <dl>
                <div><dt>Name and email</dt><dd>{data.name} · {data.email}</dd></div>
                {(data.currentTitle || data.years !== "") && <div><dt>Now</dt><dd>{[data.currentTitle, data.years !== "" && `${data.years} years of experience`].filter(Boolean).join(" · ")}</dd></div>}
                {data.profileUrl && <div><dt>Profile</dt><dd>{data.profileUrl}</dd></div>}
                <div><dt>Résumé</dt><dd>{resume ? `${resume.name} (${megabytes(resume.size)} MB)` : "Not attached"}</dd></div>
                <div><dt>How we know each other</dt><dd>{[relationshipLabel, data.relationship !== "not_yet" && data.relationshipNote].filter(Boolean).join(" · ")}</dd></div>
              </dl>
              <button type="button" className={styles.textButton} onClick={() => go(1)}>Edit<span className={styles.srOnly}> about you</span></button>
            </div>
            <div className={styles.reviewGroup}>
              <h4>Introduction</h4>
              <dl>
                <div><dt>In third person</dt><dd>{data.intro}</dd></div>
                {data.whyRole && <div><dt>{roles.length > 1 ? "Why these roles" : "Why this role"}</dt><dd>{data.whyRole}</dd></div>}
              </dl>
              <button type="button" className={styles.textButton} onClick={() => go(2)}>Edit<span className={styles.srOnly}> the introduction</span></button>
            </div>
          </div>
          <label className={styles.consent} htmlFor="referral-consent">
            <input type="checkbox" id="referral-consent" checked={consent} aria-invalid={errors.consent ? "true" : undefined}
              onChange={(event) => { setConsent(event.target.checked); if (errors.consent) setErrors({}); }} />
            <span>
              I agree that Yuqi receives these details and my résumé, and that an AI model (Google Gemini) may read them to screen the request.
              GitHub and LeetCode links in them are checked against those services’ public data. A request under the screening bar is declined automatically;
              I can follow the outcome on my status page, and only Yuqi sees the score and the notes. The site keeps the request for up to 180 days and the résumé file for up to 30 days, or until the request is closed. <Link href="/privacy"><a target="_blank" rel="noopener">Privacy</a></Link>
            </span>
          </label>
          {errors.consent && <p className={styles.error} role="alert" style={{ margin: "-10px 0 16px" }}><CircleAlert size={14} aria-hidden="true" /><span>{errors.consent}</span></p>}
          <div aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
            <label>Leave this field empty<input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
          </div>
        </section>
      )}

      <div className={`${styles.actions} ${step === 0 ? styles.actionsEnd : ""}`} data-referral-actions>
        {step > 0 && step < 3 && <button type="button" className={styles.secondary} onClick={() => go(step - 1)}><ArrowLeft size={17} aria-hidden="true" />Back</button>}
        {step === 3 && <ContactVerification active resetKey={verificationReset} onToken={setToken} action="referral_submit" />}
        {step < 3
          // Distinct keys: if React reused one DOM button, the click on "Continue" would finish as a submit.
          ? <button key="continue" type="button" className={styles.primary} onClick={next}>Continue<ArrowRight size={17} aria-hidden="true" /></button>
          : <button key="send" type="submit" className={styles.primary} disabled={sending}>
              {sending ? "Sending…" : "Send request"}
              {sending ? <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" /> : <ArrowUpRight size={17} aria-hidden="true" />}
            </button>}
      </div>
      {step === 3 && sending && <p className={styles.notice} role="status">{{ saving: "Saving your answers…", uploading: "Uploading your résumé…", finishing: "Almost done…" }[phase] || "Sending…"}</p>}
      {notice && <p className={styles.notice} role="alert">{notice}</p>}
    </form>
  );
}
