// Local preview only (`npm run dev:talk`): stands in for the storage service, so the browser has
// somewhere to PUT the résumé and the review page has somewhere to download it from. The files
// live in memory. Answers 404 anywhere else.
import { referralRuntime } from '../../../src/lib/referral/runtime.mjs';
import { localHost, talkPreviewEnabled } from '../../../src/lib/talkPreview.mjs';
import { RESUME_MAX_BYTES } from '../../../src/lib/referral/config.mjs';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!talkPreviewEnabled() || !localHost(req)) return res.status(404).json({ error: 'not_found' });
  const { storage } = referralRuntime();
  if (req.method === 'GET') {
    const bytes = await storage.download(String(req.query.file || ''));
    if (!bytes) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${String(req.query.name || 'resume.pdf').replace(/[^\w. -]/g, '_')}"`);
    return res.status(200).send(bytes);
  }
  if (req.method !== 'PUT') { res.setHeader('Allow', 'GET, PUT'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > RESUME_MAX_BYTES) return res.status(413).json({ message: 'The file is larger than 2 MB.' });
    chunks.push(chunk);
  }
  const result = storage.put(String(req.query.token || ''), Buffer.concat(chunks), req.headers['content-type']);
  return res.status(result.status).json(result.error ? { message: result.error } : { ok: true });
}
