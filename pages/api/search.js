import { searchItems } from '../../src/lib/searchItems';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q: rawQuery, source, limit, offset } = req.query;
  const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter: q' });
  }

  try {
    const results = await searchItems({
      q,
      source: source ? String(source) : undefined,
      limit: typeof limit !== 'undefined' ? Number(limit) : undefined,
      offset: typeof offset !== 'undefined' ? Number(offset) : undefined,
    });

    res.status(200).json(results);
  } catch (error) {
    console.error('[search] api error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
