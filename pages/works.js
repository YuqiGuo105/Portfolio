import Layout from "../src/layout/Layout";

import dynamic from "next/dynamic";
import { useTranslation } from "../src/context/TranslationContext";

const WorkIsotope = dynamic(() => import("../src/components/WorkIsotope"), {
  ssr: false,
});

const works = () => {
  const { t } = useTranslation();
  return (
    <Layout>
      {/* Section Started Heading */}
      <section className="section section-inner started-heading">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
              {/* titles */}
              <div className="h-titles">
                <h1 className="h-title">{t('projects_grid')}</h1>
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
                <h6>{t('work_description')}</h6>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
              {/* Works */}
              <WorkIsotope />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
};
export default works;
