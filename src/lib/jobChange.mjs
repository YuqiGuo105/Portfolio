// A job change as two edits to the work history: the current role gets an end month, and the new
// role is added as the open-ended one. Everything that names the employer follows the work history
// (src/lib/currentRole.mjs), so this is the only thing to do when changing jobs.
import { currentRole, periodStart, sameCompany } from './currentRole.mjs';

const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? ((?:19|20)\d{2})$/i;
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// "march 2027" → "Mar 2027", the way the existing rows are written.
const month = value => { const [, name, year] = clean(value, 20).match(MONTH); return `${name[0].toUpperCase()}${name.slice(1, 3).toLowerCase()} ${year}`; };
const EXAMPLE = 'Write the month and year, for example Mar 2027.';

// rows: the work history as [{ id, name, subname, date }]. Returns { errors } or { end, start }.
export function planJobChange(rows, input = {}) {
  const current = currentRole(rows);
  const lastMonth = clean(input.lastMonth, 20), company = clean(input.company, 160), title = clean(input.title, 140), started = clean(input.started, 20);
  const about = String(input.about ?? '').trim().slice(0, 4000);
  const starting = Boolean(company || title || started || about);
  const errors = {};
  if (current) {
    if (!MONTH.test(lastMonth)) errors.lastMonth = EXAMPLE;
    else if (periodStart(lastMonth).order < periodStart(current.since).order) errors.lastMonth = `That is before the role began (${current.since}).`;
  } else if (!starting) errors.company = 'There is no current role to end. Add the new one.';
  if (starting) {
    if (!company) errors.company = 'Name the company.';
    else if (current && sameCompany(company, current.company)) errors.company = `${current.company} is already the current employer. To change its title or dates, edit that role in the list.`;
    if (!title) errors.title = 'Give the job title.';
    if (!MONTH.test(started)) errors.started = EXAMPLE;
    else if (current && MONTH.test(lastMonth) && periodStart(started).order < periodStart(lastMonth).order) errors.started = 'The new role starts before the last one ends. Check the two months.';
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors: null,
    end: current ? { id: current.id, company: current.company, date: [current.since, month(lastMonth)].filter(Boolean).join(' - ') } : null,
    // Field names as the content API takes them: title = company, summary = job title, content = notes.
    start: starting ? { title: company, summary: title, content: about, date: `${month(started)} - Current` } : null,
  };
}

// Carries the plan out through the content API, one step at a time, and reports each step.
//   api.save(id | null, data, key) → { sourceId }    write a row without publishing
//   api.publish(id, { changeNote, notifySubscribers })   index it for search and the assistant
//   api.refresh()                                     regenerate the pages that name the employer
// Publishing is what updates the assistant's knowledge. Subscribers are told about the new role
// only when `announce` is true, and never about the old role ending.
export async function runJobChange(plan, api, { announce = false, key = '' } = {}) {
  const steps = [];
  const step = async (label, work, { optional = false } = {}) => {
    try { const value = await work(); steps.push({ label, ok: true }); return value; }
    catch (error) { steps.push({ label, ok: false, optional, error: error?.message || 'It did not go through.' }); if (!optional) throw error; return null; }
  };
  try {
    if (plan.end) {
      await step(`${plan.end.company} now ends: ${plan.end.date}`, () => api.save(plan.end.id, { date: plan.end.date }));
      await step(`${plan.end.company}: search and the assistant updated`, () => api.publish(plan.end.id, { changeNote: 'Role ended', notifySubscribers: false }));
    }
    if (plan.start) {
      const created = await step(`${plan.start.title} added: ${plan.start.date}`, () => api.save(null, plan.start, key));
      await step(`${plan.start.title}: search and the assistant updated${announce ? ', subscribers told' : ''}`,
        () => api.publish(created.sourceId, { changeNote: 'New role', notifySubscribers: Boolean(announce) }));
    }
    // The pages refresh by themselves within five minutes, so a failure here is not a failed change.
    await step('Home page and referral page regenerated', () => api.refresh(), { optional: true });
    return { ok: true, steps };
  } catch { return { ok: false, steps }; }
}
