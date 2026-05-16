import Isotope from "isotope-layout";
import Link from "next/link";
import {Fragment, useEffect, useRef, useState} from "react";
import {supabase} from '../supabase/supabaseClient';

const FILTERS = [
  { key: "all",        label: "All",        icon: "fa-border-all" },
  { key: "Full-Stack", label: "Full Stack",  icon: "fa-layer-group" },
  { key: "Backend",    label: "Backend",     icon: "fa-server" },
  { key: "Web-Infra",  label: "Web Infra",   icon: "fa-cloud" },
];

const ProjectIsotop = () => {
  const isotope = useRef();
  const [filterKey, setFilterKey] = useState("all");
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    const fetchProjects = async () => {
      const {data, error} = await supabase
        .from('Projects')
        .select('*')
        .order('num', {ascending: false});
      if (!error) setProjects(data);
      else console.error(error);
    };
    fetchProjects();
  }, []);

  useEffect(() => {
    if (!projects.length) return;
    if (isotope.current) { isotope.current.destroy(); isotope.current = null; }
    const timer = setTimeout(() => {
      isotope.current = new Isotope(".proj-grid", {
        itemSelector: ".proj-col",
        layoutMode: "fitRows",
        percentPosition: true,
      });
    }, 120);
    return () => {
      clearTimeout(timer);
      if (isotope.current) { isotope.current.destroy(); isotope.current = null; }
    };
  }, [projects]);

  useEffect(() => {
    if (isotope.current) {
      isotope.current.arrange({ filter: filterKey === "all" ? "*" : `.${filterKey}` });
    }
  }, [filterKey]);

  return (
    <Fragment>
      {/* ── Filter pills ── */}
      <div className="proj-filters">
        {FILTERS.map(({ key, label, icon }) => (
          <button
            key={key}
            className={`proj-filter-btn${filterKey === key ? " active" : ""}`}
            onClick={() => setFilterKey(key)}
          >
            <i className={`fas ${icon}`} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* ── Card grid ── */}
      <div className="proj-grid row">
        {projects.map((project) => {
          const categoryClasses = project.category
            ? project.category.split(',').map((c) => c.trim().replace(/\s+/g, '-')).join(' ')
            : '';
          const techList = project.technology
            ? project.technology.split(',').map((t) => t.trim()).filter(Boolean)
            : [];
          const cats = project.category
            ? project.category.split(',').map((c) => c.trim())
            : [];

          return (
            <div
              key={project.id}
              className={`proj-col col-xs-12 col-sm-6 col-md-6 col-lg-4 ${categoryClasses}`}
            >
              <Link href={`/work-single/${project.id}`} passHref>
                <a className="proj-card">
                  {/* Image area */}
                  <div className="proj-card-image">
                    <img src={project.image_url} alt={project.title} />
                    <div className="proj-card-overlay">
                      <span className="proj-card-cta">
                        <i className="fas fa-arrow-right" />
                        View Project
                      </span>
                    </div>
                    {cats.length > 0 && (
                      <div className="proj-card-badges">
                        {cats.map((cat, i) => (
                          <span key={i} className="proj-badge">{cat}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="proj-card-body">
                    <h3 className="proj-card-title">{project.title}</h3>
                    {techList.length > 0 && (
                      <div className="proj-tech-list">
                        {techList.slice(0, 4).map((tech, i) => (
                          <span key={i} className="proj-tech-tag">{tech}</span>
                        ))}
                        {techList.length > 4 && (
                          <span className="proj-tech-tag proj-tech-more">+{techList.length - 4}</span>
                        )}
                      </div>
                    )}
                    <div className="proj-card-footer">
                      {project.year && <span className="proj-year">{project.year}</span>}
                      <span className="proj-arrow">
                        <i className="fas fa-external-link-alt" />
                      </span>
                    </div>
                  </div>
                </a>
              </Link>
            </div>
          );
        })}
      </div>

      {/* ── View All button ── */}
      <div className="proj-view-all-wrap">
        <Link href="/works-list" passHref>
          <a className="proj-view-all-btn">
            <span>View All Projects</span>
            <i className="fas fa-chevron-right" />
          </a>
        </Link>
      </div>
    </Fragment>
  );
};

export default ProjectIsotop;
