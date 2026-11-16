// The chat's waiting line wired to this deployment: the shared Valkey when it is configured, one
// process's memory otherwise (local preview, tests, or a deployment without the shared store).
import { contactIp } from '../contactGuard.mjs';
import { isRateLimited, valkeyClient, valkeyConfigured } from '../rateLimiter';
import { requireSupabaseUser } from '../agentServiceProxy';
import { admissionSettings, createAdmission, memoryAdmissionStore, valkeyAdmissionStore } from './admission.mjs';
import { admitChatMessage, createAdmissionHandler } from './admissionHttp.mjs';

const KEY = Symbol.for('portfolio.chat.admission.v1');
export function chatAdmissionRuntime() {
  if (globalThis[KEY]) return globalThis[KEY];
  const settings = admissionSettings(process.env);
  const admission = createAdmission({ store: valkeyConfigured() ? valkeyAdmissionStore(valkeyClient) : memoryAdmissionStore(), settings });
  const salt = process.env.CHAT_ADMISSION_SALT || process.env.CRON_SECRET || 'chat-line';
  const ipOf = req => contactIp(req);
  // Only a request that carries a sign-in can skip the line; anonymous visitors are not looked up.
  const authorize = async req => {
    if (!req.headers?.authorization) return null;
    let failed = false;
    const quiet = { status() { failed = true; return this; }, json() { return this; }, setHeader() {}, end() {} };
    const auth = await requireSupabaseUser(req, quiet, { allowAnonymous: true });
    return failed ? null : auth;
  };
  globalThis[KEY] = {
    admission, settings,
    handler: createAdmissionHandler({ admission, ipOf, isRateLimited, authorize, salt }),
    admit: (req, res, auth) => admitChatMessage(req, res, { admission, ipOf, auth, salt }),
  };
  return globalThis[KEY];
}
