import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, X } from "lucide-react";
import { currentRole } from "../../lib/currentRole.mjs";
import { planJobChange, runJobChange } from "../../lib/jobChange.mjs";
import { adminStyles as ui } from "./AdminUI";
import styles from "./WorkHistory.module.css";

const EMPTY = { lastMonth: "", company: "", title: "", started: "", about: "" };
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
// A content list item as a work-history row.
const toRow = (item) => ({ id: String(item.sourceId ?? item.id), name: item.title || "", subname: item.summary || "", date: item.period || item.date || item.raw?.date || "" });

function Field({ id, label, hint, error, full, children }) {
  return (
    <div className={`${styles.field} ${full ? styles.full : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <p className={styles.error} id={`${id}-error`} role="alert">{error}</p> : hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

// Edits one role in place. Saving also publishes it (without telling subscribers), which is what
// updates the search index and the assistant's knowledge for that role.
function RoleEditor({ api, row, onDone }) {
  const [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.get(row.id).then((detail) => live && setData({ title: detail.title || row.name, summary: detail.description || row.subname, date: detail.date || row.date, content: detail.content || "" }))
      .catch((err) => live && setError(err.message || "This role could not be opened."));
    return () => { live = false; };
  }, [api, row]);
  const set = (key) => (event) => setData((current) => ({ ...current, [key]: event.target.value }));
  async function save(event) {
    event.preventDefault();
    if (!data.title.trim() || !data.date.trim()) { setError("The company and the period are both needed."); return; }
    setBusy(true); setError("");
    try {
      await api.save(row.id, { title: data.title.trim(), summary: data.summary.trim(), content: data.content, date: data.date.trim() });
      await api.publish(row.id, { changeNote: "Edited in Work history", notifySubscribers: false });
      await api.refresh().catch(() => {});
      onDone(true);
    } catch (err) { setError(err.message || "The change was not saved."); } finally { setBusy(false); }
  }
  if (!data) return <div className={styles.edit}>{error ? <p className={styles.error} role="alert">{error}</p> : <p className={styles.hint}>Opening…</p>}</div>;
  return (
    <form className={styles.edit} onSubmit={save}>
      <div className={styles.grid}>
        <Field id={`role-${row.id}-company`} label="Company"><input id={`role-${row.id}-company`} value={data.title} onChange={set("title")} maxLength={160} /></Field>
        <Field id={`role-${row.id}-title`} label="Title"><input id={`role-${row.id}-title`} value={data.summary} onChange={set("summary")} maxLength={140} /></Field>
        <Field id={`role-${row.id}-date`} label="Period" hint="End it with “Current” while you work there, for example Dec 2024 - Current." full>
          <input id={`role-${row.id}-date`} value={data.date} onChange={set("date")} maxLength={60} />
        </Field>
        <Field id={`role-${row.id}-content`} label="Notes shown under the role" full><textarea id={`role-${row.id}-content`} value={data.content} onChange={set("content")} maxLength={4000} /></Field>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Save and update the assistant"}</button>
        <button type="button" className={styles.secondary} onClick={() => onDone(false)} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

// The one place to record a job change. `api` is { list, get, save, publish, refresh }.
export default function WorkHistory({ api }) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY), [errors, setErrors] = useState({}), [announce, setAnnounce] = useState(false);
  const [running, setRunning] = useState(false), [result, setResult] = useState(null), [editing, setEditing] = useState("");
  // One key per attempt at adding the new role, so pressing the button twice cannot add it twice.
  const key = useRef(newKey());

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const payload = await api.list(); setRows((payload.items || []).map(toRow)); }
    catch (err) { setError(err.message || "The work history could not be loaded."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const role = useMemo(() => currentRole(rows), [rows]);
  const preview = useMemo(() => planJobChange(rows, form), [rows, form]);
  const set = (name) => (event) => { setForm((current) => ({ ...current, [name]: event.target.value })); setErrors((current) => ({ ...current, [name]: undefined })); setResult(null); key.current = newKey(); };

  async function submit(event) {
    event.preventDefault();
    const plan = planJobChange(rows, form);
    if (plan.errors) { setErrors(plan.errors); document.getElementById(`change-${Object.keys(plan.errors)[0]}`)?.focus(); return; }
    setRunning(true); setResult(null);
    const outcome = await runJobChange(plan, api, { announce, key: key.current });
    setResult(outcome); setRunning(false);
    if (outcome.ok) { setForm(EMPTY); setAnnounce(false); key.current = newKey(); }
    await load();
  }

  return (
    <div className={styles.wrap}>
      {error && <div className={ui.errorBanner} role="alert">{error}</div>}
      <div className={styles.now} data-none={role ? "no" : "yes"}>
        {role
          ? <p>Current employer: <strong>{role.company}</strong>{role.title ? `, ${role.title}` : ""}{role.since ? `, since ${role.since}` : ""}.</p>
          : <p>{loading ? "Reading the work history…" : "No current employer: no role ends in “Current”."}</p>}
        <p>The home page introduction, the referral form on /talk, structured data, llms.txt and the assistant’s knowledge all take the employer from this list.</p>
      </div>

      <form className={styles.card} onSubmit={submit} noValidate>
        <h2>{role ? "I changed jobs" : "I started a new role"}</h2>
        <p>{role ? `This ends ${role.company} and adds the new role as the current one. Leave the new role empty if you have left and not started anywhere yet.` : "This adds the new role as the current one."}</p>
        <div className={styles.grid}>
          {role && (
            <Field id="change-lastMonth" label={`Last month at ${role.company}`} error={errors.lastMonth} hint="For example Mar 2027." full>
              <input id="change-lastMonth" value={form.lastMonth} onChange={set("lastMonth")} placeholder="Mar 2027" aria-invalid={Boolean(errors.lastMonth)} />
            </Field>
          )}
          <Field id="change-company" label="New company" error={errors.company}><input id="change-company" value={form.company} onChange={set("company")} maxLength={160} aria-invalid={Boolean(errors.company)} /></Field>
          <Field id="change-title" label="Title there" error={errors.title} hint="For example Senior Software Engineer - Full-time."><input id="change-title" value={form.title} onChange={set("title")} maxLength={140} aria-invalid={Boolean(errors.title)} /></Field>
          <Field id="change-started" label="First month there" error={errors.started} hint="For example Mar 2027."><input id="change-started" value={form.started} onChange={set("started")} placeholder="Mar 2027" aria-invalid={Boolean(errors.started)} /></Field>
          <Field id="change-about" label="Notes shown under the role (optional)" hint="Team or area. The first line is also used in the home page introduction." full>
            <textarea id="change-about" value={form.about} onChange={set("about")} maxLength={4000} />
          </Field>
          <label className={`${styles.check} ${styles.full}`}>
            <input type="checkbox" checked={announce} onChange={(event) => setAnnounce(event.target.checked)} />
            <span>Also email subscribers who follow job updates about the new role. Off by default; the old role ending is never announced.</span>
          </label>
        </div>
        {!preview.errors && (preview.end || preview.start) && (
          <ul className={styles.plan} aria-label="What will be written">
            {preview.end && <li>{preview.end.company}: {preview.end.date}</li>}
            {preview.start && <li>{preview.start.title}, {preview.start.summary}: {preview.start.date}</li>}
            <li>{preview.start ? `The referral form switches to ${preview.start.title}; open requests for ${preview.end ? preview.end.company : "earlier employers"} are kept and marked.` : "The referral form closes until a new role is added."}</li>
          </ul>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={running || loading}>{running ? "Working…" : "Record the change"}</button>
        </div>
        {result && (
          <ul className={styles.steps} aria-live="polite">
            {result.steps.map((step) => (
              <li key={step.label} data-ok={step.ok ? "yes" : step.optional ? "skip" : "no"}>
                {step.ok ? <Check size={15} aria-hidden="true" /> : step.optional ? <CircleAlert size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                <span>{step.label}{step.ok ? "" : step.optional ? " did not run; the pages update by themselves within five minutes." : `: ${step.error}`}</span>
              </li>
            ))}
            {!result.ok && <li data-ok="no"><span>The change stopped there. What is listed above as done stays done; fix the problem and record the rest again.</span></li>}
          </ul>
        )}
      </form>

      <div className={styles.card}>
        <h2>Roles</h2>
        <p>Editing a role here also updates search and the assistant’s knowledge for it.</p>
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div><strong>{row.name}</strong>{role?.id === row.id && <span className={styles.tag}>Current</span>}<br /><span>{[row.subname, row.date].filter(Boolean).join(" · ")}</span></div>
              <button type="button" className={styles.secondary} onClick={() => setEditing(editing === row.id ? "" : row.id)}>{editing === row.id ? "Close" : "Edit"}</button>
              {editing === row.id && <RoleEditor api={api} row={row} onDone={(saved) => { setEditing(""); if (saved) load(); }} />}
            </li>
          ))}
          {!loading && !rows.length && <li className={styles.row}><span>No roles yet.</span></li>}
        </ul>
      </div>
    </div>
  );
}
