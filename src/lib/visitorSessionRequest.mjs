export function validateSessionRequest(body) {
  const fail = () => { throw new Error('Invalid session request.'); };
  if (!body || Array.isArray(body) || Object.keys(body).some(k => !['sessionId', 'window', 'page'].includes(k))) fail();
  if (typeof body.sessionId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,256}$/.test(body.sessionId)) fail();
  const window = body.window;
  if (!window || Object.keys(window).some(k => !['from', 'to'].includes(k))) fail();
  const times = ['from', 'to'].map(k => {
    if (typeof window[k] !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(window[k])) fail();
    return Date.parse(window[k]);
  });
  if (!times.every(Number.isFinite) || times[1] <= times[0] || times[1] - times[0] > 31 * 86400000) fail();
  const page = body.page || { number: 0, size: 25 };
  if (Object.keys(page).some(k => !['number', 'size'].includes(k)) || !Number.isInteger(page.number) || page.number < 0 || page.number > 10000 || !Number.isInteger(page.size) || page.size < 1 || page.size > 50) fail();
  return { sessionId: body.sessionId, window: { from: new Date(times[0]).toISOString(), to: new Date(times[1]).toISOString() }, page: { number: page.number, size: page.size } };
}
