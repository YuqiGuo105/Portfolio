import dynamic from "next/dynamic";
import Layout from "../src/layout/Layout";

const ProjectIsotop = dynamic(() => import("../src/components/ProjectIsotop"), {
  ssr: false,
});
const WorksList = () => {
  return (
    <Layout>
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
                  All Projects
                </h1>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Section Works */}
      <section className="section section-inner m-archive">
        <div className="container">
          <div className="row row-custom">
            <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3"></div>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              {/* Description */}
              <div
                className="text"
              >
                <h6>
                  The complete project archive, including current flagship work
                  and earlier systems that shaped the platform.
                </h6>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
              {/* Works */}
              <ProjectIsotop showViewAll={false} />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
};
export default WorksList;
