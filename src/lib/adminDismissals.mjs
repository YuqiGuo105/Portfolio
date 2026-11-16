// Clearing a notification in the admin bell removes it for good, on every device. The bell's
// items are views of other things (a referral request, a failed job, an alert), so what is
// stored is the key of each cleared notification; the thing it pointed to is left alone.
const KEY = /^[a-z]+:[A-Za-z0-9_.:\-]{1,180}$/;
const missingTable = error => ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);
export const validKeys = value => (Array.isArray(value) ? [...new Set(value.filter(key => typeof key === 'string' && KEY.test(key)))].slice(0, 500) : []);

export function supabaseDismissalStore(client) {
  const table = () => client.from('admin_notification_dismissals');
  return {
    // null: the table does not exist yet (the migration has not been run).
    async list() {
      const { data, error } = await table().select('key').order('dismissed_at', { ascending: false }).limit(5000);
      if (error) { if (missingTable(error)) return null; throw new Error('Dismissals unavailable'); }
      return (data || []).map(row => row.key);
    },
    async add(keys) {
      const { error } = await table().upsert(keys.map(key => ({ key })), { onConflict: 'key', ignoreDuplicates: true });
      if (error) { if (missingTable(error)) return null; throw new Error('Dismissals unavailable'); }
      return keys.length;
    },
  };
}

export function memoryDismissalStore(seed = []) {
  const keys = new Set(seed);
  return { async list() { return [...keys]; }, async add(added) { added.forEach(key => keys.add(key)); return added.length; } };
}

// GET → { enabled, keys }.  POST { keys: [...] } → { enabled, cleared }.
export function createDismissalHandler({ authorize, store }) {
  return async function dismissalHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    const user = await authorize(req, res);
    if (!user) return undefined;
    try {
      if (req.method === 'GET') {
        const keys = await store.list();
        return res.status(200).json(keys === null ? { enabled: false, keys: [] } : { enabled: true, keys });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
      const keys = validKeys(req.body?.keys);
      if (!keys.length) return res.status(400).json({ error: 'invalid_request', message: 'Send the keys of the notifications to clear.' });
      const cleared = await store.add(keys);
      return res.status(200).json(cleared === null ? { enabled: false, cleared: 0 } : { enabled: true, cleared });
    } catch (error) {
      console.error('[admin-notifications] clearing failed', error?.message || error);
      return res.status(503).json({ error: 'unavailable', message: 'Notifications could not be cleared just now.' });
    }
  };
}
