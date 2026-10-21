// Opt-in paid-test guard. Never loaded by the application or normal dev server.
const fetchOriginal = globalThis.fetch;
let issued = false;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return fetchOriginal(input, options);
  if (url.origin === 'https://www.yuqi.site' && url.pathname === '/mcp') return fetchOriginal(input, options);
  if (url.href !== 'https://generativelanguage.googleapis.com/v1beta/auth_tokens' || issued) throw new Error('Outside single-call test scope');
  issued = true;
  const body = JSON.parse(options.body);
  if (body.uses !== 1 || Date.parse(body.expireTime) - Date.now() > 60000
    || body.bidiGenerateContentSetup.model !== 'models/gemini-3.8-live'
    || body.bidiGenerateContentSetup.generationConfig.maxOutputTokens !== 256) throw new Error('Unexpected paid-test constraints');
  const result = await fetchOriginal(input, options);
  if (!result.ok) {
    const error = await result.clone().json().catch(() => ({}));
    const message = String(error.error?.message || '').replaceAll(process.env.GEMINI_LIVE_API_KEY, '[redacted]').slice(0, 600);
    console.error(JSON.stringify({ googleTokenStatus: result.status, message }));
  }
  return result;
};
