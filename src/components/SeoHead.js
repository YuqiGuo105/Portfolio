import Head from 'next/head';
import { useRouter } from 'next/router';

// Canonical site origin. Overridable so a preview deploy can emit its own
// preview-origin canonical instead of accidentally telling Google the
// canonical is prod (which would then de-index the preview from search).
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yuqi.site'
).replace(/\/$/, '');

/**
 * Build an absolute URL from a path or full URL. Pages that already know
 * their full URL (SSR pages) should pass it directly; other pages can rely
 * on the auto-fallback that uses the current router path.
 */
export function absoluteUrl(pathOrUrl) {
  if (!pathOrUrl) return SITE_URL;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const p = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${SITE_URL}${p}`;
}

/**
 * Site-wide <head> block. Each page should pass its own `title`,
 * `description`, and — critically — its own `url` so Google sees a
 * per-page canonical instead of every page pointing at the homepage.
 *
 * Props:
 * - `url`        Full canonical URL. Falls back to `SITE_URL + router.asPath`
 *                (with the query string stripped) when omitted.
 * - `noindex`    Emit `robots: noindex, nofollow`. Use for admin pages,
 *                the analytics dashboard, and anything we do not want in
 *                the Google index.
 * - `type`       Open Graph type. `article` for blog posts, `website` for
 *                everything else (default).
 * - `jsonLd`     Structured-data object (or array of objects). Serialized
 *                verbatim into a `<script type="application/ld+json">`.
 *                Use it to describe Article, Person, WebSite, etc.
 */
const SeoHead = ({
  title,
  description = "Portfolio and blog of Yuqi Guo (郭育奇) featuring project showcases and tech articles.",
  keywords = "Yuqi Guo, 郭育奇, portfolio, blog, projects, software engineer",
  image = "/assets/images/profile_guyuqi.jpg",
  url,
  noindex = false,
  type = 'website',
  jsonLd,
}) => {
  const router = useRouter();

  const siteTitle = "Yuqi Guo's Blog";
  const metaTitle = title ? `${title} | ${siteTitle}` : siteTitle;

  // Prefer the caller-supplied canonical; otherwise derive one from the
  // current path so every page has a self-referencing canonical instead
  // of the old hardcoded homepage URL.
  const routerPath = (router && router.asPath ? router.asPath : '/').split('?')[0].split('#')[0];
  const metaUrl = absoluteUrl(url || routerPath);
  const metaImage = image && /^https?:\/\//i.test(image) ? image : `${SITE_URL}${image || ''}`;

  const robots = noindex ? 'noindex, nofollow' : 'index, follow';

  // JSON-LD may be a single object or an array of objects — normalize.
  const jsonLdBlocks = jsonLd
    ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd])
    : [];

  return (
    <Head>
      <title>{metaTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <meta name="robots" content={robots} />
      <meta name="googlebot" content={robots} />
      <meta name="author" content="Yuqi Guo (郭育奇)" />
      <link rel="canonical" href={metaUrl} />
      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={metaUrl} />
      <meta property="og:title" content={metaTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={metaImage} />
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={metaUrl} />
      <meta name="twitter:title" content={metaTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={metaImage} />
      {/* JSON-LD structured data. Google reads this to build rich results
          (article cards, sitelinks, author bylines, etc.). Rendered as
          raw HTML because next/head refuses to render children into
          <script> otherwise. */}
      {jsonLdBlocks.map((block, i) => (
        <script
          key={`ld-${i}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
    </Head>
  );
};

export default SeoHead;
