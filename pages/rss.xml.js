// pages/rss.xml.js
// -----------------------------------------------------------------------------
// RSS 2.0 feed for the technical and life blogs. Rendered on request (like
// /sitemap.xml) and cached on the CDN, so new posts appear without a redeploy.
// A Supabase outage degrades to an empty but valid feed instead of a 500.
// -----------------------------------------------------------------------------

import { supabaseServer } from '../src/supabase/supabaseServer';
import { SITE_URL } from '../src/components/SeoHead';

const FEED_LIMIT = 50;

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rfc822(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
}

export function buildRssFeed(items, now = new Date()) {
  const entries = items.map((item) => {
    const parts = [
      `      <title>${xmlEscape(item.title)}</title>`,
      `      <link>${xmlEscape(item.link)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(item.link)}</guid>`,
    ];
    if (item.pubDate) parts.push(`      <pubDate>${item.pubDate}</pubDate>`);
    if (item.category) parts.push(`      <category>${xmlEscape(item.category)}</category>`);
    if (item.description) parts.push(`      <description>${xmlEscape(item.description)}</description>`);
    return `    <item>\n${parts.join('\n')}\n    </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Yuqi Guo — Engineering &amp; Life Notes</title>
    <link>${SITE_URL}/blogs</link>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Write-ups on distributed systems, backend platforms, system design and AI infrastructure by Yuqi Guo.</description>
    <language>en-us</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
${entries.join('\n')}
  </channel>
</rss>
`;
}

export async function getServerSideProps({ res }) {
  let items = [];
  try {
    const [blogsRes, lifeRes] = await Promise.all([
      supabaseServer
        .from('Blogs')
        .select('id,title,description,category,date')
        .order('date', { ascending: false })
        .limit(FEED_LIMIT),
      supabaseServer
        .from('life_blogs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(FEED_LIMIT),
    ]);
    const technical = (!blogsRes.error && Array.isArray(blogsRes.data) ? blogsRes.data : []).map((row) => ({
      title: row.title,
      link: `${SITE_URL}/blog-single/${row.id}`,
      description: row.description,
      category: row.category,
      sortKey: new Date(row.date || 0).getTime() || 0,
      pubDate: rfc822(row.date),
    }));
    const life = (!lifeRes.error && Array.isArray(lifeRes.data) ? lifeRes.data : []).map((row) => ({
      title: row.title,
      link: `${SITE_URL}/life-blog/${row.id}`,
      description: row.description,
      category: row.category || 'Life',
      sortKey: new Date(row.published_at || row.created_at || 0).getTime() || 0,
      pubDate: rfc822(row.published_at || row.created_at),
    }));
    items = [...technical, ...life]
      .filter((item) => item.title)
      .sort((left, right) => right.sortKey - left.sortKey)
      .slice(0, FEED_LIMIT);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[rss] supabase enumeration failed:', error && error.message);
  }

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.write(buildRssFeed(items));
  res.end();
  return { props: {} };
}

// Never rendered — getServerSideProps writes the response directly.
export default function RssFeed() {
  return null;
}
