import Layout from "../src/layout/Layout";
import SeoHead from "../src/components/SeoHead";
import ProjectIsotop from "../src/components/ProjectIsotop";
import {
  LIST_REVALIDATE_SECONDS,
  loadProjectCards,
  orEmpty,
  publicServerClient,
} from "../src/lib/publicContent.mjs";

// The archive is in the first HTML (see src/lib/publicContent.mjs); the browser refreshes it after load.
export async function getStaticProps() {
  const { projects, systems } = await orEmpty(
    () => loadProjectCards(publicServerClient()),
    { projects: [], systems: {} },
    "projects"
  );
  return { props: { projects, systems }, revalidate: LIST_REVALIDATE_SECONDS };
}

const WorksList = ({ projects = [], systems = {} }) => {
  return (
    <Layout>
      <SeoHead
        title="Projects — Distributed Systems & AI Platforms"
        description="Project archive by Yuqi Guo: event-driven microservices, AI agent and RAG platforms, MCP integrations, analytics pipelines and open-source reliability work."
        url="/works-list"
      />
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
              <ProjectIsotop showViewAll={false} initialProjects={projects} initialSystems={systems} />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
};
WorksList.hasCustomSeo = true;

export default WorksList;
