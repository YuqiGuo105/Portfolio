// pages/sitemap.xml.js
// -----------------------------------------------------------------------------
// Dynamic sitemap. Enumerates every /blog-single/<id> and /work-single/<id>
// alongside the static top-level pages. Google gets a fresh, complete list of
// URLs on every crawl instead of the old three-URL static file that hid the
// entire post archive from the index.
//
// Delete /public/sitemap.xml so Next.js resolves /sitemap.xml through this
// dynamic route instead of the static asset (public/ takes precedence).
// -----------------------------------------------------------------------------

import { supabaseServer } from '../src/supabase/supabaseServer';
import { SITE_URL } from '../src/components/SeoHead';

// Static top-level routes that are always indexable. Keep tuples so we can
// attach per-URL <priority> / <changefreq> hints below.
const STATIC_ROUTES = [
  { path: '/',            priority: '1.0', changefreq: 'weekly'  },
  { path: '/blog',        priority: '0.8', changefreq: 'daily'   },
  { path: '/works',       priority: '0.8', changefreq: 'weekly'  },
  { path: '/blogs',       priority: '0.6', changefreq: 'weekly'  },
  { path: '/works-list',  priority: '0.6', changefreq: 'weekly'  },
  { path: '/cv',          priority: '0.5', changefreq: 'monthly' },
];

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildSitemap(entries) {
  const urlBlocks = entries.map((e) => {
    const parts = [`    <loc>${xmlEscape(e.loc)}</loc>`];
    if (e.lastmod)   parts.push(`    <lastmod>${xmlEscape(e.lastmod)}</lastmod>`);
    if (e.changefreq) parts.push(`    <changefreq>${xmlEscape(e.changefreq)}</changefreq>`);
    if (e.priority)  parts.push(`    <priority>${xmlEscape(e.priority)}</priority>`);
    return `  <url>\n${parts.join('\n')}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlBlocks.join('\n')}\n</urlset>\n`;
}

export async function getServerSideProps({ res }) {
  // Pull ids + updated timestamps in parallel. Missing tables or auth
  // errors should NOT 500 the sitemap — we fall back to just the static
  // routes so Google can still crawl the top of the site.
  let blogRows = [];
  let projectRows = [];
  try {
    const [blogsRes, projectsRes] = await Promise.all([
      supabaseServer
        .from('Blogs')
        .select('id,updated_at,created_at')
        .order('id', { ascending: false })
        .limit(5000),
      supabaseServer
        .from('Projects')
        .select('id,updated_at,created_at')
        .order('id', { ascending: false })
        .limit(5000),
    ]);
    if (!blogsRes.error && Array.isArray(blogsRes.data))       blogRows    = blogsRes.data;
    if (!projectsRes.error && Array.isArray(projectsRes.data)) projectRows = projectsRes.data;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sitemap] supabase enumeration failed:', err && err.message);
  }

  const entries = [];

  for (const r of STATIC_ROUTES) {
    entries.push({
      loc: `${SITE_URL}${r.path}`,
      changefreq: r.changefreq,
      priority: r.priority,
    });
  }

  for (const row of blogRows) {
    entries.push({
      loc: `${SITE_URL}/blog-single/${row.id}`,
      lastmod: toIsoDate(row.updated_at || row.created_at),
      changefreq: 'weekly',
      priority: '0.7',
    });
  }

  for (const row of projectRows) {
    entries.push({
      loc: `${SITE_URL}/work-single/${row.id}`,
      lastmod: toIsoDate(row.updated_at || row.created_at),
      changefreq: 'monthly',
      priority: '0.7',
    });
  }

  const xml = buildSitemap(entries);

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // Cache aggressively on the CDN: sitemap changes only when posts are
  // published, and stale-while-revalidate keeps latency low.
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=600, stale-while-revalidate=86400'
  );
  res.write(xml);
  res.end();

  return { props: {} };
}

// Never actually rendered — getServerSideProps writes the response directly.
export default function Sitemap() {
  return null;
}
