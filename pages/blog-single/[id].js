import Layout from "../../src/layout/Layout";
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import SeoHead, { absoluteUrl } from "../../src/components/SeoHead";
import BlogComments from "../../src/components/BlogComments";
import { supabaseServer } from '../../src/supabase/supabaseServer';
// isomorphic-dompurify pulls in jsdom, whose optional native deps are not
// available in Vercel's Node.js serverless runtime — loading it threw at
// request time and served 500s for every blog-single view. sanitize-html
// is pure JS and works identically in local Node and on Vercel.
import { sanitize } from '../../src/lib/sanitizeHtml';

/**
 * Server-rendered blog detail. Fetching + sanitizing on the server means
 * Googlebot receives the full article HTML on the first byte instead of
 * a `<div>Loading...</div>` shell (the CSR version was invisible to the
 * crawler).
 */
export async function getServerSideProps({ params, res }) {
  const { id } = params;

  const { data, error } = await supabaseServer
    .from('Blogs')
    .select('id,title,description,content,category,date,tags,created_at,updated_at')
    .eq('id', id)
    .single();

  if (error || !data) {
    // Row missing → real 404 so Google drops the URL from the index
    // (a soft 200 with "not found" body would keep it around).
    return { notFound: true };
  }

  // Sanitize once on the server. The client component just prints the
  // already-clean HTML, keeping the sanitizer out of the hydration path.
  const sanitizedContent = sanitize(data.content);

  // Short cache on the CDN + stale-while-revalidate so a burst of hits
  // does not spam Supabase, but publishing a fresh post shows up within
  // ~1 minute anyway.
  if (res) {
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=600'
    );
  }

  return {
    props: {
      blog: {
        id: data.id,
        title: data.title || '',
        description: data.description || '',
        content: sanitizedContent,
        category: data.category || '',
        date: data.date || '',
        tags: data.tags || '',
        createdAt: data.created_at || null,
        updatedAt: data.updated_at || null,
      },
    },
  };
}

const BlogSingle = ({ blog }) => {
  const router = useRouter();

  // Trim the sanitized HTML to a plain-text excerpt for the meta
  // description when the row does not carry an explicit one.
  const metaDescription = (blog.description
    || (blog.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  ).slice(0, 200);

  const canonical = absoluteUrl(`/blog-single/${blog.id}`);

  // Article schema drives Google's article rich results (headline,
  // author byline, publish date).
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: blog.title,
    description: metaDescription,
    author: { '@type': 'Person', name: 'Yuqi Guo' },
    datePublished: blog.date || blog.createdAt || undefined,
    dateModified: blog.updatedAt || blog.date || blog.createdAt || undefined,
    mainEntityOfPage: canonical,
    url: canonical,
    articleSection: blog.category || undefined,
    keywords: blog.tags || undefined,
  };

  return (
    <>
      <SeoHead
        title={blog.title}
        description={metaDescription}
        url={canonical}
        type="article"
        jsonLd={articleLd}
      />
      <Layout extraWrapClass={"single-post"}>
      {/* Section Started Heading */}
      <section className="section section-inner started-heading">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
              {/* titles */}
              <div className="m-titles">
                <h1 className="m-title">{blog.title}</h1>
                <div className="m-category">
                  <a
                    href="#"
                    rel="category tag"
                    
                  >
                    {blog.category}
                  </a>{" "}
                  / {blog.date}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Single Post */}
      <section className="section section-inner m-archive">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-10 offset-1">

              {/* content */}
              <div className="description">
                <div
                  className="post-content"
                >

                  <div className="post-content" dangerouslySetInnerHTML={{__html: blog.content}}></div>

                  {/* Tags Section */}
                  <span className="tags-links">
                     <span>Tags:</span>
                    {blog.tags && blog.tags.split(',').map((tag, index) => (
                      <a
                        href={`/blogs?tag=${encodeURIComponent(tag.trim())}`}
                        key={index}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/blogs?tag=${encodeURIComponent(tag.trim())}`);
                        }}
                      >
                        {tag.trim()}
                      </a>
                    ))}
                    </span>

                </div>
              </div>

              {/* Comments Section */}
              <BlogComments blogId={blog.id} blogType="technical" />
            </div>

          </div>
        </div>
      </section>
    </Layout>
    </>
  );
};
export default BlogSingle;
