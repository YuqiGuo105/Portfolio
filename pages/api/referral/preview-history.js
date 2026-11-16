// Local preview only (`npm run dev:talk`): a work history kept in memory, so recording a job change
// can be tried on /admin/experience-preview. Answers 404 anywhere else and never reaches the real one.
import { referralRuntime } from '../../../src/lib/referral/runtime.mjs';
import { localHost, talkPreviewEnabled } from '../../../src/lib/talkPreview.mjs';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
const line = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export default async function handler(req, res) {
  if (!talkPreviewEnabled() || !localHost(req)) return res.status(404).json({ error: 'not_found' });
  const runtime = referralRuntime();
  const { history, indexed } = runtime;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const row = req.query.id ? history.find(item => String(item.id) === String(req.query.id)) : null;
    if (req.query.id) return row ? res.status(200).json({ title: row.name, description: row.subname, date: row.date, content: row.text || '' }) : res.status(404).json({ error: 'not_found' });
    const items = [...history].sort((a, b) => Number(b.id) - Number(a.id)).map(item => ({ sourceId: String(item.id), title: item.name, summary: item.subname, period: item.date }));
    return res.status(200).json({ items, indexed });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const { action, id, data = {}, notifySubscribers } = req.body || {};
  if (action === 'save') {
    let row = id ? history.find(item => String(item.id) === String(id)) : null;
    if (id && !row) return res.status(404).json({ message: 'That role no longer exists.' });
    if (!row) { row = { id: Math.max(0, ...history.map(item => Number(item.id))) + 1, name: '', subname: '', date: '', text: '' }; history.push(row); }
    if ('title' in data) row.name = line(data.title, 160);
    if ('summary' in data) row.subname = line(data.summary, 140);
    if ('date' in data) row.date = line(data.date, 60);
    if ('content' in data) row.text = String(data.content ?? '').slice(0, 4000);
    return res.status(200).json({ sourceId: String(row.id) });
  }
  if (action === 'publish') {
    const row = history.find(item => String(item.id) === String(id));
    if (!row) return res.status(404).json({ message: 'That role no longer exists.' });
    // What the real platform does on publish, recorded so the preview page can show it.
    indexed.unshift({ at: new Date().toISOString(), role: `${row.name} (${row.date})`, notified: notifySubscribers === true });
    indexed.length = Math.min(indexed.length, 20);
    return res.status(200).json({ ok: true });
  }
  if (action === 'refresh') {
    runtime.availability.clear();
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ message: 'Use save, publish or refresh.' });
}
