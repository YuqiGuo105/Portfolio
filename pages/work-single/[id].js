import Layout from "../../src/layout/Layout";
import Link from "next/link";
import { useEffect } from 'react';
import SeoHead, { absoluteUrl } from "../../src/components/SeoHead";
import { supabaseServer } from '../../src/supabase/supabaseServer';
// isomorphic-dompurify pulls in jsdom + native optional deps that Vercel's
// serverless Node runtime cannot resolve; loading it throws at request time
// and served 500s for every /work-single/[id] view. sanitize-html is a
// pure-JS sanitizer that works identically in local Node and Vercel.
import { sanitize } from '../../src/lib/sanitizeHtml';

/**
 * Server-rendered project detail. Same rationale as blog-single: without
 * SSR, Googlebot sees only `<div>Loading...</div>` on the first byte and
 * never indexes any of the project copy. Fetching in getServerSideProps
 * (plus a short CDN cache) pushes the real markup into the initial HTML.
 */
export async function getServerSideProps({ params, res }) {
  const { id } = params;

  // Column set must match the actual Projects table schema:
  //   id, title, content, published_at, updated_at, image_url, URL,
  //   category, year, technology, num
  // (No `description`, no `image`, no `created_at`.) Selecting non-existent
  // columns returns HTTP 400 from PostgREST and previously caused this page
  // to 500 in production.
  const [{ data: project, error: projectErr }, { data: nextRows }] = await Promise.all([
    supabaseServer
      .from('Projects')
      .select('id,title,year,technology,URL,content,image_url,updated_at,published_at')
      .eq('id', id)
      .single(),
    supabaseServer
      .from('Projects')
      .select('id,title')
      .gt('id', id)
      .order('id', { ascending: true })
      .limit(1),
  ]);

  if (projectErr || !project) {
    return { notFound: true };
  }

  const sanitizedContent = sanitize(project.content);

  if (res) {
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=600'
    );
  }

  return {
    props: {
      project: {
        id: project.id,
        title: project.title || '',
        year: project.year || '',
        technology: project.technology || '',
        URL: project.URL || '',
        content: sanitizedContent,
        // Projects table has no `description` column; the render code derives
        // meta description from content when this is empty.
        description: '',
        image: project.image_url || null,
        updatedAt: project.updated_at || null,
        createdAt: project.published_at || null,
      },
      nextProject: (nextRows && nextRows[0])
        ? { id: nextRows[0].id, title: nextRows[0].title || '' }
        : null,
    },
  };
}

const WorkSingle = ({ project, nextProject }) => {
  // Track page view via the dedicated tracking endpoint.
  useEffect(() => {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localTime: new Date().toISOString() }),
    }).catch(() => {});
  }, []);

  const metaDescription = (project.description
    || (project.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  ).slice(0, 200);

  const canonical = absoluteUrl(`/work-single/${project.id}`);

  // CreativeWork is the closest schema.org match for a portfolio project
  // page (Google renders it as a rich result with title + author + date).
  const projectLd = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.title,
    description: metaDescription,
    author: { '@type': 'Person', name: 'Yuqi Guo' },
    url: canonical,
    dateModified: project.updatedAt || project.createdAt || undefined,
    keywords: project.technology || undefined,
    ...(project.URL ? { sameAs: [project.URL] } : {}),
  };

  return (
    <>
      <SeoHead
        title={project.title}
        description={metaDescription}
        url={canonical}
        type="article"
        image={project.image || undefined}
        jsonLd={projectLd}
      />
      <Layout extraWrapClass={"project-single"}>
      {/* Section Started Heading */}
      <section className="section section-inner started-heading">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
              {/* titles */}
              <div className="h-titles">
                <h1
                  className="h-title"
                >
                  {project.title}
                </h1>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Details */}
      <section className="section section-inner details">
        <div className="container">
          <div className="row row-custom">
            <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3"></div>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              <div className="m-details">
                <div className="details-label">
                  <span>Year</span>
                  <strong>{project.year}</strong>
                </div>
                <div className="details-label">
                  <span>Technology</span>
                  <strong>{project.technology}</strong>
                </div>
                <div className="details-label">
                  <span>Link</span>
                  <strong>
                    <Link href={project.URL || '#'}>
                      <a
                        target="_blank"
                        rel="noopener noreferrer"
                        
                      >
                        Source Code
                      </a>
                    </Link>
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Cover Image — only rendered when the project has an absolute image URL */}
      {project.image && project.image.startsWith('http') && (
        <section className="m-image-large">
          <div className="image">
            <div
              className="img js-parallax"
              style={{ backgroundImage: `url(${project.image})` }}
            />
          </div>
        </section>
      )}

      {/* Description */}
      <section className="section section-bg">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
              <div
                className="p-title"
              >
                Project
              </div>
              <div
                className="text"
                dangerouslySetInnerHTML={{__html: project.content}}
              >

              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Next project navigation */}
      {nextProject && (
          <section className="m-page-navigation">
            <div className="container">
              <div className="row">
                <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                  <div className="h-titles h-navs">
                    <Link href={`/work-single/${nextProject.id}`}>
                      <a>
                        <span className="nav-arrow">Next Project</span>
                        <span className="h-title">{nextProject.title}</span>
                      </a>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
      )}
    </Layout>
    </>
  );
};
export default WorkSingle;
