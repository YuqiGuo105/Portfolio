const EXCLUDED = Object.freeze({ collect: false, token: '' });

// One bounded cache per browser, never an authorization grant or persisted role.
export function createAnalyticsIdentity({ getSession, verify, now = Date.now, timeoutMs = 5000 }) {
  let revision = 0;
  let cached = null;
  let inFlight = null;

  function invalidate() {
    revision += 1;
    cached = null;
    inFlight = null;
  }

  async function resolve() {
    const startedRevision = revision;
    let timer;
    const controller = new AbortController();
    const timeout = new Promise(resolveTimeout => {
      timer = setTimeout(() => {
        controller.abort();
        resolveTimeout(EXCLUDED);
      }, timeoutMs);
    });
    const lookup = async () => {
      const { data, error } = await getSession();
      if (error || revision !== startedRevision || controller.signal.aborted) return EXCLUDED;
      const token = data?.session?.access_token || '';
      if (!token) return { collect: true, token: '' };
      if (cached?.token === token && cached.expiresAt > now()) return cached.value;
      if (inFlight?.token !== token) {
        const pending = { token, promise: verify(token, controller.signal) };
        inFlight = pending;
        pending.promise.finally(() => { if (inFlight === pending) inFlight = null; }).catch(() => {});
      }
      const result = await inFlight.promise;
      if (revision !== startedRevision || controller.signal.aborted) return EXCLUDED;
      const value = { collect: result?.collect === true, token };
      cached = { token, value, expiresAt: now() + 60_000 };
      return value;
    };
    try {
      return await Promise.race([lookup(), timeout]);
    } catch {
      return EXCLUDED;
    } finally {
      clearTimeout(timer);
    }
  }

  return { resolve, invalidate };
}
