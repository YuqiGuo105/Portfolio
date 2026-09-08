// Shared by browser tracking and ingestion, including locale-prefixed routes.
const PRIVATE_ROUTE = /^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*\/)?(?:admin|auth|oauth|api)(?:\/|$)/i;

export function isPrivateAnalyticsPage(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const path = decodeURIComponent(new URL(value, 'https://www.yuqi.site').pathname);
    return PRIVATE_ROUTE.test(path.replace(/\/{2,}/g, '/'));
  } catch {
    return false;
  }
}

export function isPrivateAnalyticsEvent(body = {}, referer = '') {
  // A public destination does not make an event from the admin console public.
  return [body?.page, body?.pageUrl, referer].some(isPrivateAnalyticsPage);
}
