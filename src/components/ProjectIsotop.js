import Isotope from "isotope-layout";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { supabase } from '../supabase/supabaseClient';

const ProjectIsotop = () => {
  // State for projects and filter
  const [projects, setProjects] = useState([]);
  const [filterKey, setFilterKey] = useState("*");

  const isotope = useRef();

  useEffect(() => {
    setTimeout(() => {
      isotope.current = new Isotope(".works-items", {
        itemSelector: ".works-col",
        //    layoutMode: "fitRows",
        percentPosition: true,
        masonry: {
          columnWidth: ".works-col",
        },
        animationOptions: {
          duration: 750,
          easing: "linear",
          queue: false,
        },
      });
    }, 1000);
    //     return () => isotope.current.destroy();
  }, []);

  // Fetch projects from Supabase
  useEffect(() => {
    const fetchProjects = async () => {
      const { data, error } = await supabase
          .from('Projects')
          .select('*');

      if (!error) {
        setProjects(data);
      } else {
        console.error(error);
      }
    };

    fetchProjects();
  }, []);

  // Filter projects by category
  const filteredProjects = filterKey === "*"
      ? projects
      : projects.filter(project => project.category === filterKey);

  // Handle filter change
  const handleFilterKeyChange = (key) => () => {
    setFilterKey(key);
    isotope.current.arrange({ filter: key === "*" ? "*" : `.${key}` });
  };

  const activeBtn = (value) => (value === filterKey ? "active" : "");

  return (
    <Fragment>
      <div className="works-box">
        <div
            className="filter-links"
        >
          <a
              className={`c-pointer ${activeBtn("*")}`}
              onClick={handleFilterKeyChange("*")}
              data-href=".works-col"
          >
            All
          </a>
          <a
              className={`c-pointer ${activeBtn("sorting-ui-ux-design")}`}
              onClick={handleFilterKeyChange("sorting-ui-ux-design")}
              data-href=".sorting-ui-ux-design"
          >
            Backend
          </a>
          <a
              className={`c-pointer ${activeBtn("sorting-photo")}`}
              onClick={handleFilterKeyChange("sorting-photo")}
              data-href=".sorting-photo"
          >
            Mobile Application
          </a>
          <a
              className={`c-pointer ${activeBtn("sorting-development")}`}
              onClick={handleFilterKeyChange("sorting-development")}
              data-href=".sorting-development"
          >
            Full Stack
          </a>
        </div>
        <div className="works-items works-list-items row">
          {filteredProjects.map((project, index) => (
              <div key={index} className={`works-col col-xs-12 col-sm-12 col-md-12 col-lg-12 ${project.category}`}>
                <div className="works-item">
                  <Link href={`/work-single/${project.id}`}>
                    <a>
                  <span className="image">
                    <img src={project.image_url} alt={project.name} />
                  </span>
                      <span className="desc">
                    <span className="name">{project.title}</span>
                    <span className="category">{project.category}</span>
                  </span>
                    </a>
                  </Link>
                </div>
              </div>
          ))}
        </div>
      </div>
    </Fragment>
  );
};
export default ProjectIsotop;
