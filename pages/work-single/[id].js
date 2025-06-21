import Layout from "../../src/layout/Layout";
import Link from "next/link";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../src/supabase/supabaseClient';
import DOMPurify from 'dompurify';
import { useTranslation } from '../../src/context/TranslationContext';

const WorkSingle = () => {
  const { t } = useTranslation();
  const [project, setProject] = useState(null);
  const [nextProject, setNextProject] = useState(null);
  const router = useRouter();
  const { id } = router.query;

  // Helper to log click events for analytics
  const recordClick = async (clickEvent, targetUrl) => {
    const localTime = new Date().toISOString();
    const pageUrl   = targetUrl || window.location.href;
    try {
      await fetch('/api/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clickEvent, targetUrl: pageUrl, localTime })
      });
    } catch (err) {
      console.error("Error logging click event:", err);
    }
  };

  useEffect(() => {
    recordClick('page-load');
  }, []);

  useEffect(() => {
    const fetchProject = async () => {
      if (!id) return; // Don't proceed if ID is not yet available

      const { data, error } = await supabase
          .from('Projects')
          .select('*')
          .eq('id', id)
          .single();

      if (error) {
        console.error('Error fetching project:', error);
        return;
      }

      // Sanitize the HTML content
      data.content = DOMPurify.sanitize(data.content);

      setProject(data);
    };

    fetchProject();
  }, [id]);

  useEffect(() => {
    const fetchNextProject = async () => {
      const { data, error } = await supabase
          .from('Projects')
          .select('*')
          .gt('id', id) // Assuming IDs are sequential and numeric
          .order('id', { ascending: true })
          .limit(1);

      if (error) {
        console.error('Error fetching next project:', error);
        return;
      }

      setNextProject(data[0]); // Assuming the next project is the first in the returned array
    };

    if (id) fetchNextProject();
  }, [id, project]);

  if (!project) return <div>{t('loading')}</div>;

  return (
    <Layout extraWrapClass={"project-single"}>
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
                  {project.title}
                </h1>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Details */}
      <section className="section section-inner details">
        <div className="container">
          <div className="row row-custom">
            <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3"></div>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              <div className="m-details">
                <div className="details-label">
                  <span>{t('year')}</span>
                  <strong>{project.year}</strong>
                </div>
                <div className="details-label">
                  <span>{t('technology')}</span>
                  <strong>{project.technology}</strong>
                </div>
                <div className="details-label">
                  <span>{t('link')}</span>
                  <strong>
                    <Link href={project.URL}>
                      <a
                        target="_blank"
                        rel="noopener noreferrer"
                        
                      >
                        {t('source_code')}
                      </a>
                    </Link>
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Description */}
      <section className="section section-bg">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
              <div className="p-title">{t('project')}</div>
              <div
                className="text"
                dangerouslySetInnerHTML={{__html: project.content}}
              >

              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Next project navigation */}
      {nextProject && (
          <section className="m-page-navigation">
            <div className="container">
              <div className="row">
                <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                  <div className="h-titles h-navs">
                    <Link href={`/work-single/${nextProject.id}`}>
                      <a>
                        <span className="nav-arrow">{t('next_project')}</span>
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
  );
};
export default WorkSingle;
