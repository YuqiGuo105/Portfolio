import { rankedSearch } from '../../src/lib/rankedSearch.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q: rawQuery, source, limit, offset } = req.query;
  const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter: q' });
  }

  try {
    const results = await rankedSearch({
      q,
      source: source ? String(source) : undefined,
      limit: typeof limit !== 'undefined' ? Number(limit) : undefined,
      offset: typeof offset !== 'undefined' ? Number(offset) : undefined,
    });

    res.status(200).json(results);
  } catch (error) {
    const invalid = error instanceof RangeError;
    console.error('[search] request failed', error.name);
    res.status(invalid ? 400 : 503).json({ error: invalid ? error.message : 'Search temporarily unavailable. Please try again.' });
  }
}
