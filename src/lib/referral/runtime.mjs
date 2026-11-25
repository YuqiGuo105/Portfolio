// Wires the referral handlers to their real dependencies, or to in-memory ones for the local
// preview (`npm run dev:talk`). Preview mode exists only in a development build with
// TALK_PREVIEW=1: there is no way to reach it on a deployed site.
import { supabaseServer } from '../../supabase/supabaseServer';
import { isRateLimited } from '../rateLimiter';
import { requireAdmin } from '../adminRouteAuth';
import { createReferralAdminHandler, createReferralCompleteHandler, createReferralHandler, createReferralStatusHandler, createReferralWorkerHandler, createWorkerKick } from './handler.mjs';
import { createReferralAi } from './screening.mjs';
import { noReplyMailbox, sendNoReplyMail, sendReferralMail } from './mail.mjs';
import { memoryReferralStore, supabaseReferralStore } from './store.mjs';
import { memoryResumeStorage, supabaseResumeStorage } from './storage.mjs';
import { createReferralWorker } from './worker.mjs';
import { previewSamples, previewScreener } from './previewSamples.mjs';
import { keepPreviewMail, localHost, previewOutbox, talkPreviewEnabled } from '../talkPreview.mjs';
import { createRoleSource } from '../currentRole.mjs';
import { loadExperiences, publicServerClient } from '../publicContent.mjs';
import { createReferralAvailability } from './availability.mjs';

// The local preview has no database by default. TALK_COMPANY stands in for the work history there:
// a company name, or "none" to see the page as it is between jobs.
function previewHistory(env) {
  const name = String(env.TALK_COMPANY || 'Goldman Sachs').trim();
  const past = { id: 1, name: 'CuraStone Corp', subname: 'Backend Developer Intern', date: 'Aug 2023 - Dec 2023', text: '' };
  if (name.toLowerCase() === 'none') return [past];
  return [{ id: 2, name, subname: 'Software Engineer - Full-time', date: 'Dec 2024 - Current', text: '' }, past];
}

// Pages that state the employer or the referral company; regenerated at once when either changes.
const PAGES = ['/', '/talk'];

const KEY = Symbol.for('portfolio.referral.runtime.v3');
export function referralRuntime() {
  if (globalThis[KEY]) return globalThis[KEY];
  const preview = talkPreviewEnabled();
  const store = preview ? memoryReferralStore(previewSamples()) : supabaseReferralStore(supabaseServer);
  const storage = preview ? memoryResumeStorage() : supabaseResumeStorage(supabaseServer);
  // Without a model the preview uses a stand-in that follows a simple rule, so auto-decline, a pass
  // and its two emails can all be seen without spending anything.
  const ai = createReferralAi();
  const screener = preview && !ai.enabled() ? previewScreener() : ai;
  const client = publicServerClient();
  // In the preview the work history is a list in memory, so a job change can be tried end to end
  // on /admin/experience-preview without touching the real one.
  const history = preview ? previewHistory(process.env) : null;
  const roles = createRoleSource({ load: () => (preview ? history : loadExperiences(client)) });
  const availability = createReferralAvailability({ roles, store });
  const refresh = async res => { for (const path of PAGES) await res.revalidate(path); };
  // Preview never sends mail: what would have been sent is kept so the preview page can show it.
  const sendMail = preview
    ? async mail => keepPreviewMail({ kind: 'referral', subject: mail.subject, replyTo: mail.replyTo || '', text: mail.text, attachments: [] })
    : sendReferralMail;
  // Trying the form repeatedly is the point of the preview, so it is neither verified nor limited per
  // network there. The worker's own throttles stay on, so the preview drains its queue the way production does.
  const keep = mail => keepPreviewMail({ kind: 'referral', subject: mail.subject, replyTo: mail.replyTo || '', to: mail.to || '', text: mail.text, attachments: [] });
  const passMailer = preview ? { enabled: () => true, send: async mail => keep(mail) } : { enabled: () => Boolean(noReplyMailbox()), send: sendNoReplyMail };
  const limiter = preview ? (key, scope, options) => (['referral-kick', 'referral-ai'].includes(scope) ? isRateLimited(key, scope, options) : false) : isRateLimited;
  const verifyToken = preview ? { verifyToken: async () => {} } : {};
  const worker = createReferralWorker({ store, storage, screener, sendMail, passMailer, isRateLimited: limiter });
  const kick = createWorkerKick({ isRateLimited: limiter });
  globalThis[KEY] = {
    preview, store, storage, screener, worker, outbox: previewOutbox(), roles, availability, history, indexed: [],
    submit: createReferralHandler({ isRateLimited: limiter, store, storage, availability, ...verifyToken }),
    complete: createReferralCompleteHandler({ isRateLimited: limiter, store, storage, kick }),
    status: createReferralStatusHandler({ isRateLimited: limiter, store }),
    admin: createReferralAdminHandler({ authorize: requireAdmin, store, storage, availability, refresh, kick }),
    work: createReferralWorkerHandler({ worker }),
    // Same list and actions as the admin page, for the local preview page only.
    previewAdmin: createReferralAdminHandler({ store, storage, availability, refresh, kick, authorize: async (req, res) => {
      if (preview && localHost(req)) return { userId: 'local-preview' };
      res.status(404).json({ error: 'not_found' }); return null;
    } }),
  };
  return globalThis[KEY];
}
