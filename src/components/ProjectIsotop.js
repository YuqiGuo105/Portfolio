import Isotope from "isotope-layout";
import Link from "next/link";
import {Fragment, useCallback, useEffect, useRef, useState} from "react";
import {supabase} from '../supabase/supabaseClient';

const ProjectIsotop = () => {
  const isotope = useRef();
  const [filterKey, setFilterKey] = useState("all");
  const [projects, setProjects] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState([]);

  // Fetch projects from Supabase
  useEffect(() => {
    const fetchProjects = async () => {
      const {data, error} = await supabase
        .from('Projects')
        .select('*');

      if (!error) {
        setProjects(data);
        setFilteredProjects(data);
      } else {
        console.error(error);
      }
    };

    fetchProjects();
  }, []);

  // Initialize Isotope
  useEffect(() => {
    setTimeout(() => {
      isotope.current = new Isotope(".works-items", {
        itemSelector: ".works-col",
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

    // Destroy Isotope instance on unmount
    return () => isotope.current && isotope.current.destroy();
  }, []);

  useEffect(() => {
    console.log('Current filterKey:', filterKey); // Debugging log

    if (filterKey === 'all') {
      setFilteredProjects(projects);
    } else {
      const filtered = projects.filter(project =>
        project.category?.toLowerCase() === filterKey.toLowerCase()
      );

      console.log('Filtered projects:', filtered); // See what's being filtered
      setFilteredProjects(filtered);
    }
  }, [filterKey, projects]);


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
          {filteredProjects.map(project => (
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
