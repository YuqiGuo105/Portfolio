import Isotope from "isotope-layout";
import Link from "next/link";
import {Fragment, useCallback, useEffect, useRef, useState} from "react";
import {supabase} from '../supabase/supabaseClient';

const ProjectIsotop = () => {
  const isotope = useRef();
  const [filterKey, setFilterKey] = useState("all");
  const [projects, setProjects] = useState([]);

  // Fetch projects from Supabase
  useEffect(() => {
    const fetchProjects = async () => {
      const {data, error} = await supabase
        .from('Projects')
        .select('*')
        .order('num', {ascending: true});

      if (!error) {
        setProjects(data);
      } else {
        console.error(error);
      }
    };

    fetchProjects();
  }, []);

  // Initialize Isotope after projects are fetched
  useEffect(() => {
    if (projects.length && !isotope.current) {
      isotope.current = new Isotope(".works-items", {
        itemSelector: ".works-col",
        percentPosition: true,
        masonry: {
          columnWidth: ".works-col",
        },
      });
    }

    return () => {
      if (isotope.current) {
        isotope.current.destroy();
      }
    };
  }, [projects]);

  // Handle Isotope layout update on filter change
  useEffect(() => {
    if (isotope.current) {
      const filter = filterKey === 'all' ? '*' : `.${filterKey}`;
      isotope.current.arrange({ filter });
    }
  }, [filterKey]);


  // Handle filter change
  const handleFilterKeyChange = (key) => () => {
    setFilterKey(key);
  };

  // Determine active button class
  const activeBtn = (value) => (value === filterKey ? "active" : "");

  return (
    <Fragment>
      <div className="works-box">
        <div className="filter-links">
          {/* Updated to include dynamic categories if needed */}
          <a className={`c-pointer ${activeBtn("all")}`} onClick={handleFilterKeyChange("all")}>All</a>
          <a className={`c-pointer ${activeBtn("Full-Stack")}`} onClick={handleFilterKeyChange("Full-Stack")}>Full
            Stack</a>
          <a className={`c-pointer ${activeBtn("Backend")}`} onClick={handleFilterKeyChange("Backend")}>Backend</a>
          <a className={`c-pointer ${activeBtn("Mobile-Application")}`}
             onClick={handleFilterKeyChange("Mobile-Application")}>Mobile Application</a>
        </div>
        <div className="works-items works-list-items row">
          {projects.map(project => (
            <div key={project.id}
                 className={`works-col col-xs-12 col-sm-12 col-md-12 col-lg-12 ${project.category}`}>
              <div className="works-item">
                <Link href={`/work-single/${project.id}`}>
                  <a>
                                        <span className="image">
                                            <span className="img">
                                                <img src={project.image_url} alt={project.title}/>
                                                <span className="overlay"/>
                                            </span>
                                        </span>
                    <span className="desc">
                                            <span className="name">
                                                {project.title}
                                            </span>
                                            <span className="category">
                                                {project.category}
                                            </span>
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
