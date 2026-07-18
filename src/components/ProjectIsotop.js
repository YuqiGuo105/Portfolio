import Isotope from "isotope-layout";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import ProjectSystemCover, { supportsSystemCover } from "./projects/ProjectSystemCover";
import { supabase } from "../supabase/supabaseClient";

const FILTERS = [
  { key: "all", label: "All", icon: "fa-border-all" },
  { key: "Full-Stack", label: "Full Stack", icon: "fa-layer-group" },
  { key: "Backend", label: "Backend", icon: "fa-server" },
  { key: "Web-Infra", label: "Web Infra", icon: "fa-cloud" },
];

const ProjectIsotop = ({ featuredOnly = false, showViewAll = true }) => {
  const isotope = useRef();
  const [filterKey, setFilterKey] = useState("all");
  const [projects, setProjects] = useState([]);
  const [projectSystems, setProjectSystems] = useState({});

  useEffect(() => {
    const fetchProjects = async () => {
      let query = supabase
        .from("Projects")
        .select("*")
        .eq("publication_status", "PUBLISHED")
        .order("num", { ascending: false });
      if (featuredOnly) query = query.eq("featured", true);

      const { data, error } = await query;
      if (error) {
        console.error(error);
        return;
      }

      const nextProjects = data || [];
      setProjects(nextProjects);
      if (nextProjects.length === 0) {
        setProjectSystems({});
        return;
      }

      const { data: systems, error: systemsError } = await supabase
        .from("project_subsystems")
        .select("id,project_id,title,eyebrow,maturity,sort_order,diagram_config")
        .in("project_id", nextProjects.map((project) => project.id))
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (systemsError) {
        console.error(systemsError);
        setProjectSystems({});
        return;
      }

      setProjectSystems((systems || []).reduce((byProject, system) => {
        if (!byProject[system.project_id]) byProject[system.project_id] = system;
        return byProject;
      }, {}));
    };
    fetchProjects();
  }, [featuredOnly]);

  useEffect(() => {
    if (!projects.length) return undefined;
    if (isotope.current) {
      isotope.current.destroy();
      isotope.current = null;
    }
    const timer = setTimeout(() => {
      isotope.current = new Isotope(".proj-grid", {
        itemSelector: ".proj-col",
        layoutMode: "fitRows",
        percentPosition: true,
      });
    }, 120);
    return () => {
      clearTimeout(timer);
      if (isotope.current) {
        isotope.current.destroy();
        isotope.current = null;
      }
    };
  }, [projects]);

  useEffect(() => {
    if (isotope.current) {
      isotope.current.arrange({ filter: filterKey === "all" ? "*" : `.${filterKey}` });
    }
  }, [filterKey]);

  return (
    <Fragment>
      <div className="proj-filters">
        {FILTERS.map(({ key, label, icon }) => (
          <button
            type="button"
            key={key}
            className={`proj-filter-btn${filterKey === key ? " active" : ""}`}
            onClick={() => setFilterKey(key)}
            aria-pressed={filterKey === key}
          >
            <i className={`fas ${icon}`} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="proj-grid row">
        {projects.map((project) => {
          const categoryClasses = project.category
            ? project.category.split(",").map((category) => category.trim().replace(/\s+/g, "-")).join(" ")
            : "";
          const techList = project.technology
            ? project.technology.split(",").map((technology) => technology.trim()).filter(Boolean)
            : [];
          const categories = project.category
            ? project.category.split(",").map((category) => category.trim())
            : [];
          const projectSystem = projectSystems[project.id];
          const hasSystemCover = supportsSystemCover(project.cover_variant, projectSystem)
            || (project.cover_variant !== "IMAGE" && !project.image_url);
          const columnClass = featuredOnly ? "col-lg-6" : "col-lg-4";

          return (
            <div
              key={project.id}
              className={`proj-col col-xs-12 col-sm-6 col-md-6 ${columnClass} ${categoryClasses}`}
            >
              <Link href={`/work-single/${project.id}`} passHref>
                <a className="proj-card">
                  <div className="proj-card-image">
                    {hasSystemCover ? (
                      <ProjectSystemCover variant={project.cover_variant} system={projectSystem} />
                    ) : (
                      <img src={project.image_url} alt={project.title} />
                    )}
                    <div className="proj-card-overlay">
                      <span className="proj-card-cta">
                        <i className="fas fa-arrow-right" aria-hidden="true" />
                        View Project
                      </span>
                    </div>
                    {categories.length > 0 && (
                      <div className="proj-card-badges">
                        {categories.map((category) => (
                          <span key={category} className="proj-badge">{category}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="proj-card-body">
                    <h3 className="proj-card-title">{project.title}</h3>
                    {techList.length > 0 && (
                      <div className="proj-tech-list">
                        {techList.slice(0, 4).map((technology) => (
                          <span key={technology} className="proj-tech-tag">{technology}</span>
                        ))}
                        {techList.length > 4 && (
                          <span className="proj-tech-tag proj-tech-more">+{techList.length - 4}</span>
                        )}
                      </div>
                    )}
                    <div className="proj-card-footer">
                      {project.year && <span className="proj-year">{project.year}</span>}
                      <span className="proj-arrow">
                        <i className="fas fa-external-link-alt" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                </a>
              </Link>
            </div>
          );
        })}
      </div>

      {showViewAll && (
        <div className="proj-view-all-wrap">
          <Link href="/works-list" passHref>
            <a className="proj-view-all-btn">
              <span>View All Projects</span>
              <i className="fas fa-chevron-right" aria-hidden="true" />
            </a>
          </Link>
        </div>
      )}
    </Fragment>
  );
};

export default ProjectIsotop;
