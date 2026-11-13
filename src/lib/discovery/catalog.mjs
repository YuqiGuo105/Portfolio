import { Parser } from 'htmlparser2';
import { publicServerClient } from '../publicContent.mjs';
import { digest } from './provider.mjs';

export function plainText(html, max = 6000) {
  let text = '', hidden = 0;
  const parser = new Parser({
    onopentag(name) { if (['script', 'style'].includes(name)) hidden++; else if (['p', 'div', 'br', 'li', 'h1', 'h2', 'h3'].includes(name)) text += ' '; },
    onclosetag(name) { if (['script', 'style'].includes(name)) hidden = Math.max(0, hidden - 1); },
    ontext(value) { if (!hidden && text.length < max * 2) text += value; },
  }, { decodeEntities: true });
  parser.end(String(html || '').slice(0, 80000));
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function catalogItem(row, type) {
  if (!/^[a-f0-9-]{36}$/i.test(row.id || '') || !row.title) return null;
  const tags = Array.isArray(row.tags) ? row.tags.join(', ') : row.tags || row.technology || row.category || '';
  const title = plainText(row.title, 200), description = plainText(row.summary || row.description || row.content, 400);
  let image = null;
  try { const url = new URL(row.image_url); if (url.protocol === 'https:' && !url.username && !url.password) image = url.href; } catch { /* No cover. */ }
  return { id: `${type}:${row.id}`, contentId: row.id, type, title, description, tags: plainText(tags, 400), image,
    url: `/${type === 'project' ? 'work' : 'blog'}-single/${row.id}`,
    text: `${title}. ${plainText(tags, 400)}. ${plainText(row.content || description, 5000)}` };
}

export function createCatalogLoader({ client = publicServerClient(), now = Date.now } = {}) {
  let cached, until = 0, pending;
  return async () => {
    if (cached && until > now()) return cached;
    if (pending) return pending;
    pending = (async () => {
      if (!client) throw new Error('Public catalog unavailable');
      // Public anon RLS, explicit project publication status, no life blogs or internal projections.
      const [projects, blogs] = await Promise.all([
        client.from('Projects').select('id,title,summary,content,technology,category,image_url').eq('publication_status', 'PUBLISHED').limit(200).abortSignal(AbortSignal.timeout(4000)),
        client.from('Blogs').select('id,title,description,content,tags,category,image_url').limit(200).abortSignal(AbortSignal.timeout(4000)),
      ]);
      if (projects.error || blogs.error) throw new Error('Public catalog unavailable');
      const items = [...projects.data.map(row => catalogItem(row, 'project')), ...blogs.data.map(row => catalogItem(row, 'blog'))].filter(Boolean);
      cached = { items, version: digest(JSON.stringify(items)).slice(0, 20) }; until = now() + 60000;
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}

export const publicCard = ({ text, ...item }) => item;
