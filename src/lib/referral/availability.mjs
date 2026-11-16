// Can someone ask for a referral right now, and at which company?
//
// The company is the current employer in the work history (src/lib/currentRole.mjs), so a job
// change moves the referral form with it. Requests are not accepted when there is no current
// employer, when the owner has switched them off on /admin/referrals, or with REFERRALS_PAUSED=1.
// REFERRAL_COMPANY pins a company by hand and is meant for exceptions only.
const pinned = env => String(env.REFERRAL_COMPANY || '').replace(/\s+/g, ' ').trim().slice(0, 160);

export function createReferralAvailability({ roles, store, env = process.env, ttlMs = 30000, now = Date.now } = {}) {
  let cached = null, readAt = 0;
  return {
    // { company, accepting, reason, role, known }. reason: null | 'paused' | 'no_employer' | 'unknown'
    async get() {
      if (cached && now() - readAt < ttlMs) return cached;
      const [{ role, employers, known }, open] = await Promise.all([
        roles.get(),
        store.accepting().catch(() => true),
      ]);
      const company = pinned(env) || role?.company || null;
      const paused = env.REFERRALS_PAUSED === '1' || !open;
      const reason = paused ? 'paused' : company ? null : known ? 'no_employer' : 'unknown';
      cached = { company, accepting: !reason, reason, role: role || null, employers: employers || [], known: Boolean(known || pinned(env)), switchedOn: open };
      readAt = now();
      return cached;
    },
    clear() { readAt = -Infinity; roles.clear?.(); },
  };
}

// What a public page needs, small enough to ship in its static props.
export const publicAvailability = state => ({ company: state?.accepting ? state.company : null, reason: state?.accepting ? null : state?.reason === 'unknown' ? 'unknown' : state?.reason || 'paused' });
