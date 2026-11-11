import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Call only after the admin guard, once per request (not once per export page).
export function createVisitorActorHeaders(auth, format) {
  const exporting = format === 'csv' || format === 'json';
  return {
    'X-Admin-Actor': typeof auth?.userId === 'string' && UUID.test(auth.userId)
      ? auth.userId.toLowerCase() : 'verified-admin',
    'X-Admin-Action': exporting ? 'visitor_export' : 'visitor_read',
    'X-Admin-Request-Id': randomUUID(),
    ...(exporting ? { 'X-Admin-Export-Format': format } : {}),
  };
}
