export function createAdminDocsHandler({ requireAdmin, fetchImpl = fetch, getStylesheet, env = process.env }) {
  return async function adminDocsHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Vary', 'Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    if (!await requireAdmin(req, res)) return;
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer \S+$/i.test(authorization)) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    let target;
    try {
      target = new URL(env.WRITER_API_URL || env.NEXT_PUBLIC_WRITER_API_URL);
      const local = env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
      if ((target.protocol !== 'https:' && !(local && target.protocol === 'http:'))
          || target.username || target.password) throw new Error('Invalid service origin');
      target = new URL('/v3/api-docs', target);
    } catch {
      return res.status(503).json({ error: 'docs_unavailable', message: 'API documentation is not configured.' });
    }
    try {
      // Fixed destination only. Never proxy a browser-provided URL or an API operation.
      const upstream = await fetchImpl(target.href, {
        method: 'GET', headers: { Authorization: authorization, Accept: 'application/json' },
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok) {
        const status = [401, 403].includes(upstream.status) ? upstream.status : 502;
        return res.status(status).json({ error: 'docs_unavailable', message: 'Unable to load protected API documentation.' });
      }
      const spec = await upstream.json();
      if (!spec?.openapi || !spec.info || !spec.paths) throw new Error('Invalid OpenAPI document');
      return res.status(200).json({ spec, stylesheet: await getStylesheet() });
    } catch {
      return res.status(502).json({ error: 'docs_unavailable', message: 'Unable to load protected API documentation.' });
    }
  };
}
