import { createClient } from '@supabase/supabase-js';
import { requireAdminUser } from '../../../src/lib/agentServiceProxy';
import { previewEnabled, searchKnowledge, getKnowledgeBatch } from '../../../src/lib/server/knowledgePreview.mjs';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (!previewEnabled() || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || ''))
    return res.status(404).json({ message: 'Not found' });
  if (req.method !== 'POST') return res.status(405).json({ message: 'Read-only preview' });
  const action = req.body?.action;
  if (!['session', 'search', 'batch-get'].includes(action))
    return res.status(405).json({ message: 'Writes are disabled in the live preview' });
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  if (action === 'session') return res.json({ email: auth.email, role: 'ADMIN', permissions: ['admin.read', 'operations.manage'] });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ message: 'Knowledge connection is not configured' });
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  });
  try {
    const result = action === 'search' ? await searchKnowledge(client, req.body)
      : await getKnowledgeBatch(client, req.body.ids);
    return res.json(result);
  } catch (error) {
    const invalid = /^(Invalid knowledge|Choose 1-25)/.test(error.message);
    return res.status(invalid ? 400 : 502).json({ message: invalid ? error.message : 'Could not load the live knowledge base. Please retry.' });
  }
}
