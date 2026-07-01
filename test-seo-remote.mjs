/**
 * Remote SEO E2E test — hits the deployed production site and asserts the
 * SSR conversions actually shipped.
 *
 * Run:  BASE=https://www.yuqi.site node test-seo-remote.mjs
 * Or:   node test-seo-remote.mjs    (defaults to www.yuqi.site)
 *
 * Tests:
 *   /              → has Person + WebSite JSON-LD in initial HTML
 *   /blog          → renders (list page, still CSR is OK — sanity check)
 *   /blog-single/<id>  → title / content in initial HTML + Article JSON-LD + canonical
 *   /work-single/<id>  → title in initial HTML + CreativeWork JSON-LD
 *   /blog-single/<garbage-id>  → HTTP 404
 *   /work-single/<garbage-id>  → HTTP 404
 *   /analytics     → contains `noindex` in <meta name="robots">
 *   /sitemap.xml   → valid XML with <urlset>, /blog-single/ and /work-single/ entries
 *   /robots.txt    → contains sitemap reference (best-effort)
 */

const BASE = (process.env.BASE || 'https://www.yuqi.site').replace(/\/$/, '');

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ PASS: ${name}`);
  passed++;
}
function fail(name, detail = '') {
  console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  failed++;
  failures.push({ name, detail });
}
function assert(name, condition, detail = '') {
  condition ? pass(name) : fail(name, detail);
}

async function getRaw(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      // Realistic UA so any bot filter on the tracking endpoint does not
      // interfere with a plain page fetch.
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...headers,
    },
    redirect: 'follow',
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

function extractJsonLd(html) {
  // Grab every <script type="application/ld+json"> ... </script> block.
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch (_) {
      // If the whole array was inlined as a single JSON array-string it
      // parses fine above; a genuine JSON parse error is worth surfacing.
      out.push({ __parseError: true, raw });
    }
  }
  return out;
}

function findMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  return m ? m[1] : null;
}
function findLink(html, rel) {
  const re = new RegExp(
    `<link[^>]+rel=["']${rel}["'][^>]*href=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  return m ? m[1] : null;
}
function findTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1] : null;
}

// ─── 1. Discover a live blog and project id via the sitemap ──────────────
console.log(`\n=== Discovery via ${BASE}/sitemap.xml ===`);

let sampleBlogId = null;
let sampleProjectId = null;
let sitemapText = '';

{
  const { status, headers, text } = await getRaw('/sitemap.xml');
  sitemapText = text;
  assert('sitemap.xml → 200', status === 200, `got ${status}`);
  const ct = headers.get('content-type') || '';
  assert(
    'sitemap.xml content-type is XML',
    /application\/xml|text\/xml/i.test(ct),
    `got '${ct}'`,
  );
  assert(
    'sitemap.xml contains <urlset>',
    /<urlset[^>]*>/.test(text),
    'no <urlset> element',
  );
  const blogUrls = [...text.matchAll(/<loc>[^<]*\/blog-single\/(\d+)<\/loc>/g)].map((m) => m[1]);
  const workUrls = [...text.matchAll(/<loc>[^<]*\/work-single\/(\d+)<\/loc>/g)].map((m) => m[1]);
  assert(`sitemap has blog entries (found ${blogUrls.length})`, blogUrls.length > 0);
  assert(`sitemap has project entries (found ${workUrls.length})`, workUrls.length > 0);
  sampleBlogId = blogUrls[0];
  sampleProjectId = workUrls[0];
  assert(
    'sitemap includes homepage',
    /<loc>[^<]*\/<\/loc>/.test(text) || text.includes(`<loc>${BASE}/</loc>`),
  );
}

// ─── 2. Homepage JSON-LD ────────────────────────────────────────────────
console.log('\n=== / (homepage) ===');
{
  const { status, text } = await getRaw('/');
  assert('/ → 200', status === 200, `got ${status}`);
  const ld = extractJsonLd(text);
  const types = ld.map((o) => o && o['@type']).filter(Boolean);
  assert(
    'homepage JSON-LD has Person',
    types.includes('Person'),
    `types=${JSON.stringify(types)}`,
  );
  assert(
    'homepage JSON-LD has WebSite',
    types.includes('WebSite'),
    `types=${JSON.stringify(types)}`,
  );
  const site = ld.find((o) => o && o['@type'] === 'WebSite');
  assert(
    'WebSite JSON-LD has SearchAction potentialAction',
    !!site && site.potentialAction && site.potentialAction['@type'] === 'SearchAction',
  );
  const canonical = findLink(text, 'canonical');
  assert('homepage has <link rel="canonical">', !!canonical, `got '${canonical}'`);
}

// ─── 3. Blog single SSR ─────────────────────────────────────────────────
console.log(`\n=== /blog-single/${sampleBlogId} ===`);
if (sampleBlogId) {
  const { status, text, headers } = await getRaw(`/blog-single/${sampleBlogId}`);
  assert(`/blog-single/${sampleBlogId} → 200`, status === 200, `got ${status}`);
  // SSR proof: the CSR shell would have contained only "Loading..." — SSR
  // must have real markup: an <h1> with the post title, and either the
  // Article JSON-LD OR the sanitized post-content div in the raw HTML.
  const title = findTitle(text);
  assert(
    'blog HTML has non-empty <title>',
    !!title && title.trim().length > 3 && !/^loading/i.test(title),
    `title='${title}'`,
  );
  assert(
    'blog HTML contains rendered <h1 class="m-title">',
    /<h1[^>]*class=["'][^"']*m-title[^"']*["'][^>]*>[^<]+<\/h1>/i.test(text),
    'no rendered h1',
  );
  assert(
    'blog HTML does NOT show only Loading... shell',
    !(text.includes('<div>Loading...</div>') && !text.includes('m-title')),
  );
  const ld = extractJsonLd(text);
  const article = ld.find((o) => o && o['@type'] === 'Article');
  assert('blog page has Article JSON-LD', !!article, `types=${JSON.stringify(ld.map((o) => o && o['@type']))}`);
  if (article) {
    assert('Article JSON-LD has headline', typeof article.headline === 'string' && article.headline.length > 0);
    assert(
      'Article JSON-LD url matches canonical path',
      typeof article.url === 'string' && article.url.includes(`/blog-single/${sampleBlogId}`),
      `url='${article.url}'`,
    );
    assert(
      'Article JSON-LD author is Yuqi Guo',
      article.author && article.author.name === 'Yuqi Guo',
    );
  }
  const canonical = findLink(text, 'canonical');
  assert(
    'blog canonical link points to /blog-single/<id>',
    !!canonical && canonical.includes(`/blog-single/${sampleBlogId}`),
    `got '${canonical}'`,
  );
  const cc = headers.get('cache-control') || '';
  assert(
    'blog Cache-Control contains s-maxage',
    /s-maxage=\d+/.test(cc),
    `got '${cc}'`,
  );
}

// ─── 4. Work single SSR ─────────────────────────────────────────────────
console.log(`\n=== /work-single/${sampleProjectId} ===`);
if (sampleProjectId) {
  const { status, text } = await getRaw(`/work-single/${sampleProjectId}`);
  assert(`/work-single/${sampleProjectId} → 200`, status === 200, `got ${status}`);
  assert(
    'project HTML has rendered <h1 class="h-title">',
    /<h1[^>]*class=["'][^"']*h-title[^"']*["'][^>]*>[^<]+<\/h1>/i.test(text),
    'no rendered h1',
  );
  const ld = extractJsonLd(text);
  const work = ld.find((o) => o && (o['@type'] === 'CreativeWork' || o['@type'] === 'Article'));
  assert('project page has CreativeWork JSON-LD', !!work);
  if (work) {
    assert(
      'CreativeWork JSON-LD url matches canonical path',
      typeof work.url === 'string' && work.url.includes(`/work-single/${sampleProjectId}`),
      `url='${work.url}'`,
    );
  }
  const canonical = findLink(text, 'canonical');
  assert(
    'project canonical link points to /work-single/<id>',
    !!canonical && canonical.includes(`/work-single/${sampleProjectId}`),
    `got '${canonical}'`,
  );
}

// ─── 5. Missing detail pages → 404 ──────────────────────────────────────
console.log('\n=== Real 404 on missing rows ===');
{
  const { status } = await getRaw('/blog-single/999999999');
  assert('/blog-single/999999999 → 404', status === 404, `got ${status}`);
}
{
  const { status } = await getRaw('/work-single/999999999');
  assert('/work-single/999999999 → 404', status === 404, `got ${status}`);
}

// ─── 6. Analytics dashboard → noindex ──────────────────────────────────
console.log('\n=== /analytics ===');
{
  const { status, text } = await getRaw('/analytics');
  assert('/analytics → 200', status === 200, `got ${status}`);
  const robots = findMeta(text, 'robots');
  assert(
    'analytics has <meta name="robots" content="noindex,...">',
    !!robots && /noindex/i.test(robots),
    `robots='${robots}'`,
  );
}

// ─── 7. robots.txt (best effort) ────────────────────────────────────────
console.log('\n=== /robots.txt ===');
{
  const { status, text } = await getRaw('/robots.txt');
  if (status === 200) {
    pass('/robots.txt → 200');
    // Not fatal if missing — just informational.
    if (/sitemap/i.test(text)) pass('robots.txt references sitemap');
    else console.log("  ℹ️  robots.txt has no 'Sitemap:' directive (optional)");
  } else {
    console.log(`  ℹ️  /robots.txt returned ${status} (optional, not fatal)`);
  }
}

// ─── Summary ────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
process.exit(0);
