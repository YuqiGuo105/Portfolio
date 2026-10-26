import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import Layout from "../../src/layout/Layout";
import { readTimeMachineFigure, timeMachineSteps } from "../../src/lib/architectureEvolution.mjs";
import evolutionData from "../../docs/architecture/platform-evolution.json";
import SeoHead, { absoluteUrl } from "../../src/components/SeoHead";
import { sanitize } from "../../src/lib/sanitizeHtml";
import { supabaseServer } from "../../src/supabase/supabaseServer";

// Loaded only when the article contains a time machine figure.
const ArchitectureTimeMachine = dynamic(() => import("../../src/components/ArchitectureTimeMachine"));

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
  const [projectResult, navigationResult] = await Promise.all([
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
  ]);

  if (projectResult.error || !projectResult.data) {
    return { notFound: true };
  }

  if (navigationResult.error) {
    throw navigationResult.error;
  }

  const project = projectResult.data;
  const projects = navigationResult.data || [];
  const content = sanitizeWithMermaid(project.content);

  const currentIndex = projects.findIndex((item) => item.id === id);
  const nextProject = currentIndex >= 0 ? projects[currentIndex + 1] || null : null;

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");

  return {
    props: {
      project: {
        id: project.id,
        title: project.title || "",
        year: project.year || "",
        technology: project.technology || "",
        URL: project.URL || "",
        content,
        description: project.summary || "",
        image: project.image_url || null,
        coverVariant: project.cover_variant || "IMAGE",
        experienceVariant: project.experience_variant || null,
        updatedAt: project.updated_at || null,
        createdAt: project.published_at || null,
      },
      // The time machine data is sent only when the article embeds it.
      evolution: timeMachineSteps(content, evolutionData).length ? evolutionData : null,
      nextProject: nextProject
        ? { id: nextProject.id, title: nextProject.title || "" }
        : null,
    },
  };
}

export default function WorkSingle({ project, evolution, nextProject }) {
  const articleRef = useRef(null);
  const [timeMachines, setTimeMachines] = useState([]);

  // An article opts into the interactive time machine with <figure class="time-machine"> linking to a step of
  // /architecture#evolution. The figure (image, link, caption) stays in the article; here it is swapped for the
  // live view, headed by the figure's caption.
  useEffect(() => {
    const root = articleRef.current;
    if (!evolution || !root) return undefined;
    const mounted = [];
    root.querySelectorAll("figure.time-machine").forEach((figure, index) => {
      const embed = readTimeMachineFigure({
        href: figure.querySelector('a[href*="#evolution/"]')?.getAttribute("href"),
        lead: figure.querySelector("figcaption strong, figcaption b")?.textContent,
        caption: figure.querySelector("figcaption")?.textContent,
      }, evolution);
      if (!embed) return;
      const container = document.createElement("div");
      container.className = "time-machine-embed";
      figure.after(container);
      figure.hidden = true;
      mounted.push({ ...embed, index, figure, container });
    });
    setTimeMachines(mounted);
    return () => {
      mounted.forEach(({ figure, container }) => {
        container.remove();
        figure.hidden = false;
      });
      setTimeMachines([]);
    };
  }, [evolution, project.content]);

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

        <section className="section section-bg">
          <div className="container">
            <div className="row">
              <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                <div className="p-title">Project</div>
                <div
                  className="text"
                  ref={articleRef}
                  dangerouslySetInnerHTML={{ __html: project.content }}
                />
                {timeMachines.map((item) => createPortal(
                  <ArchitectureTimeMachine variant="embedded" data={evolution} initialId={item.step} heading={item.heading} />,
                  item.container,
                  `${project.id}-${item.index}`,
                ))}
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
