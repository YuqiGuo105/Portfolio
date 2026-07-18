import { useEffect } from "react";
import Link from "next/link";
import Layout from "../../src/layout/Layout";
import ProjectExperience from "../../src/components/projects/ProjectExperience";
import SeoHead, { absoluteUrl } from "../../src/components/SeoHead";
import { sanitize } from "../../src/lib/sanitizeHtml";
import { supabaseServer } from "../../src/supabase/supabaseServer";

const PROJECT_FIELDS = [
  "id",
  "title",
  "year",
  "technology",
  "URL",
  "content",
  "summary",
  "image_url",
  "updated_at",
  "published_at",
  "publication_status",
  "cover_variant",
  "experience_variant",
  "num",
].join(",");

function sanitizeWithMermaid(html) {
  if (!html) return "";

  const blocks = [];
  const marked = html.replace(/<div\s+class="mermaid">[\s\S]*?<\/div>/g, (match) => {
    const inner = match.replace(/^<div[^>]*>/, "").replace(/<\/div>$/, "");
    blocks.push(inner);
    return `<div class="mermaid" id="mermaid-block-${blocks.length - 1}"></div>`;
  });

  return sanitize(marked).replace(
    /<div[^>]+id="mermaid-block-(\d+)"[^>]*>[\s\S]*?<\/div>/g,
    (_, index) => {
      const code = blocks[Number.parseInt(index, 10)] || "";
      const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return `<div class="mermaid">${escaped}</div>`;
    }
  );
}

export async function getServerSideProps({ params, res }) {
  const { id } = params;
  const [projectResult, navigationResult, subsystemResult] = await Promise.all([
    supabaseServer
      .from("Projects")
      .select(PROJECT_FIELDS)
      .eq("id", id)
      .eq("publication_status", "PUBLISHED")
      .maybeSingle(),
    supabaseServer
      .from("Projects")
      .select("id,title,num,published_at")
      .eq("publication_status", "PUBLISHED")
      .order("num", { ascending: false })
      .order("published_at", { ascending: false }),
    supabaseServer
      .from("project_subsystems")
      .select("id,project_id,linked_project_id,slug,title,eyebrow,summary,design_intent,maturity,sort_order,diagram_config,active")
      .eq("project_id", id)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (projectResult.error || !projectResult.data) {
    return { notFound: true };
  }

  if (navigationResult.error) {
    throw navigationResult.error;
  }

  if (subsystemResult.error) {
    console.error("Project subsystem query failed", {
      projectId: id,
      message: subsystemResult.error.message,
    });
  }

  const project = projectResult.data;
  const projects = navigationResult.data || [];
  const rawSubsystems = subsystemResult.data || [];
  const linkedProjectIds = [...new Set(
    rawSubsystems.map((system) => system.linked_project_id).filter(Boolean)
  )];
  let publishedLinkedProjectIds = new Set();

  if (linkedProjectIds.length > 0) {
    const linkedResult = await supabaseServer
      .from("Projects")
      .select("id")
      .in("id", linkedProjectIds)
      .eq("publication_status", "PUBLISHED");

    if (!linkedResult.error) {
      publishedLinkedProjectIds = new Set(
        (linkedResult.data || []).map((linkedProject) => linkedProject.id)
      );
    }
  }

  const currentIndex = projects.findIndex((item) => item.id === id);
  const nextProject = currentIndex >= 0 ? projects[currentIndex + 1] || null : null;
  const subsystems = rawSubsystems.map((system) => ({
    ...system,
    linked_project_id: publishedLinkedProjectIds.has(system.linked_project_id)
      ? system.linked_project_id
      : null,
  }));

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");

  return {
    props: {
      project: {
        id: project.id,
        title: project.title || "",
        year: project.year || "",
        technology: project.technology || "",
        URL: project.URL || "",
        content: sanitizeWithMermaid(project.content),
        description: project.summary || "",
        image: project.image_url || null,
        coverVariant: project.cover_variant || "IMAGE",
        experienceVariant: project.experience_variant || null,
        updatedAt: project.updated_at || null,
        createdAt: project.published_at || null,
      },
      subsystems,
      nextProject: nextProject
        ? { id: nextProject.id, title: nextProject.title || "" }
        : null,
    },
  };
}

export default function WorkSingle({ project, subsystems, nextProject }) {
  useEffect(() => {
    if (!document.querySelector("div.mermaid")) return undefined;

    const scriptId = "__mermaid_cdn";
    const render = () => {
      window.mermaid?.initialize({ startOnLoad: false, theme: "dark" });
      window.mermaid?.run?.();
    };
    const existingScript = document.getElementById(scriptId);

    if (existingScript) {
      render();
      return undefined;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
    script.onload = render;
    document.body.appendChild(script);
    return undefined;
  }, []);

  const metaDescription = (
    project.description
    || (project.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  ).slice(0, 200);
  const canonical = absoluteUrl(`/work-single/${project.id}`);
  const projectLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: project.title,
    description: metaDescription,
    author: { "@type": "Person", name: "Yuqi Guo" },
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
      <Layout extraWrapClass="project-single">
        <section className="section section-inner started-heading">
          <div className="container">
            <div className="row">
              <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                <div className="h-titles">
                  <h1 className="h-title">{project.title}</h1>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-inner details">
          <div className="container">
            <div className="row row-custom">
              <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3" />
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
                  {project.URL && (
                    <div className="details-label">
                      <span>Link</span>
                      <strong>
                        <Link href={project.URL}>
                          <a target="_blank" rel="noopener noreferrer">Source Code</a>
                        </Link>
                      </strong>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {project.coverVariant === "IMAGE" && project.image?.startsWith("http") && (
          <section className="m-image-large">
            <div className="image">
              <div
                className="img js-parallax"
                style={{ backgroundImage: `url(${project.image})` }}
              />
            </div>
          </section>
        )}

        {project.experienceVariant && subsystems.length > 0 && (
          <section className="section section-inner project-architecture-section">
            <div className="container">
              <ProjectExperience
                variant={project.experienceVariant}
                systems={subsystems}
              />
            </div>
          </section>
        )}

        <section className="section section-bg">
          <div className="container">
            <div className="row">
              <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                <div className="p-title">Project</div>
                <div
                  className="text"
                  dangerouslySetInnerHTML={{ __html: project.content }}
                />
              </div>
            </div>
          </div>
        </section>

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
}
