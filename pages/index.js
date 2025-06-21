import dynamic from "next/dynamic";
import Link from "next/link";
import ContactForm from "../src/components/ContactForm";
import TestimonialSlider from "../src/components/TestimonialSlider";
import Layout from "../src/layout/Layout";
import {useEffect, useState} from "react";
import { useTranslation } from "../src/context/TranslationContext";
import {supabase} from "../src/supabase/supabaseClient";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
const ProjectIsotop = dynamic(() => import("../src/components/ProjectIsotop"), {
  ssr: false,
});
// Slick slider settings
const settings = {
  dots: true,            // Dots for navigation
  infinite: true,        // Infinite loop sliding
  speed: 500,            // Transition speed
  slidesToShow: 3,       // Number of slides to show at a time
  slidesToScroll: 1,     // Number of slides to scroll on click
  responsive: [
    {
      breakpoint: 1024,
      settings: {
        slidesToShow: 2,
        slidesToScroll: 1,
        infinite: true,
        dots: true,
      }
    },
    {
      breakpoint: 600,
      settings: {
        slidesToShow: 1,
        slidesToScroll: 1
      }
    }
  ]
};

const Index = () => {
  const { t } = useTranslation();
  const [blogs, setBlogs] = useState([]);
  const [error, setError] = useState(null);
  const [yearsOfExperience, setYearsOfExperience] = useState(1);
  const [experiences, setExperiences] = useState([]);
  const [companiesCount, setCompaniesCount] = useState(0);
  const [lifeBlogs, setLifeBlogs] = useState([]);
  const [loggedIn, setLoggedIn]     = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      /* years of experience */
      const startYear   = Number(process.env.NEXT_PUBLIC_START_YEAR ?? new Date().getFullYear());
      const currentYear = new Date().getFullYear();
      setYearsOfExperience(Math.max(currentYear - startYear, 1));

      /* tech blogs */
      const { data: tech, error: techErr } = await supabase
        .from("Blogs")
        .select("*")
        .order("date", { ascending: false });
      if (techErr) return setError(techErr.message);
      setBlogs(tech);

      /* life blogs */
      const { data: life, error: lifeErr } = await supabase
        .from("life_blogs")
        .select("id, title, image_url, category, published_at, description, require_login")
        .order("created_at", { ascending: true });
      if (lifeErr) return setError(lifeErr.message);
      setLifeBlogs(life);

      /* experience */
      const { data: exp, error: expErr } = await supabase
        .from("experience")
        .select("*")
        .order("date", { ascending: false });
      if (expErr) return setError(expErr.message);
      setExperiences(exp);
      setCompaniesCount(new Set(exp.map(e => e.name)).size);
    };

    bootstrap();                 // run once
  }, []);        // The empty array ensures this effect runs only once after the initial render

  // Visitor tracking (only one endpoint call is needed)
  useEffect(() => {
    const trackVisitor = async () => {
      // Capture the client's local time as an ISO string.
      const localTime = new Date().toISOString();

      try {
        const response = await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ localTime }),
        });

        // Check if the response is not OK (e.g. status !== 200)
        if (!response.ok) {
          console.error('Visitor tracking failed with status:', response.status);
        }
      } catch (error) {
        console.error('Error tracking visitor:', error);
      }
    };

    trackVisitor();
  }, []);

  // Helper to record a click event
  const recordClick = async (clickEvent, targetUrl) => {
    const localTime = new Date().toISOString();
    try {
      await fetch('/api/click', {  // Ensure this URL is correct
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clickEvent, targetUrl, localTime })
      });
    } catch (err) {
      console.error("Error logging click event:", err);
    }
  };

  if (error) return <div>{t('error_loading_blog_post')}</div>;
  if (!blogs.length) return <div>{t('loading')}</div>;

  const settings = {
    infinite: true,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
  };

  /* ─────────────────────────── Settings ──────────────────────────── */
  const sliderSettings = {
    arrows: false,
    dots: true,
    slidesToShow: 3,
    slidesToScroll: 1,
    responsive: [
      { breakpoint: 1024, settings: { slidesToShow: 2 } },
      { breakpoint: 640,  settings: { slidesToShow: 1 } },
    ],
  };

  return (
    <Layout>
      <section className="section section-started">
        <div className="container">
          {/* Hero Started */}
          <div className="hero-started">
            <div
              className="slide"
            >
              <img
                src="https://iyvhmpdfrnznxgyvvkvx.supabase.co/storage/v1/object/public/Page/avator.png"
                alt="avatar"
                style={{width: "90%"}}
              />

              <span className="circle circle-1">

              </span>
              <span className="circle circle-2">

              </span>
              <span className="circle circle-3">

              </span>
              <span className="circle circle-4">

              </span>
              <span className="circle circle-5">

              </span>
            </div>
            <div className="content">
              <div className="titles">
                <div
                  className="subtitle"
                >
                  Full-Stack, Backend, Mobile Application Developer
                </div>
                <h2
                  className="title"
                >
                  Yuqi Guo
                </h2>
              </div>
              <div
                className="description"
              >
                <p> I am a Software Engineer at <strong>Goldman Sachs</strong>, specializing
                  in <strong>Microservices</strong> and <strong>Distributed Systems</strong>.
                </p>

                <div className="social-links">
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://github.com/YuqiGuo105"
                    onClick={() => recordClick("social-link", "https://github.com/YuqiGuo105")}
                  >
                    <i aria-hidden="true" className="fab fa-github"/>
                  </a>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://leetcode.com/u/Yuqi_Guo/"
                    onClick={() => recordClick("social-link", "https://leetcode.com/u/Yuqi_Guo/")}
                  >
                    <i aria-hidden="true" className="leetcode-icon-bottom custom-leetcode-icon"/>
                  </a>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://www.instagram.com/yuqi_guo17/"
                    onClick={() => recordClick("social-link", "https://www.instagram.com/yuqi_guo17/")}
                  >
                    <i aria-hidden="true" className="fab fa-instagram"/>
                  </a>
                </div>

              </div>
            </div>
            <div className="info-list">
              <ul>
                <li>
                  Degrees <strong>M.S. and B.S. in Computer Science</strong>
                </li>
                <li>
                  Experience <strong>{yearsOfExperience} Years</strong>
                </li>
                <li>
                  Commits on github <strong> 200+</strong>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <section
        className="section section-bg section-parallax section-parallax-1"
        id="about-section">
        <div className="container">
          {/* Section Heading */}
          <div className="m-titles">
            <h2
              className="m-title"
            >
              {t('about_me')}
            </h2>
          </div>
          <div className="row row-custom">
            <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3 align-right">
              {/* Section numbers */}
              <div className="numbers-items">
                <div
                  className="numbers-item"
                >
                  <div className="icon">
                    <i aria-hidden="true" className="far fa-gem"/>
                  </div>
                  <div className="num">{companiesCount}</div>
                  <div className="title">{t('companies_worked')}</div>
                </div>
                <div
                  className="numbers-item"
                >
                  <div className="icon">
                    <i aria-hidden="true" className="far fa-check-circle"/>
                  </div>
                  <div className="num">2</div>
                  <div className="title">{t('total_degrees')}</div>
                </div>
                <div
                  className="numbers-item"
                >
                  <div className="icon">
                    <i aria-hidden="true" className="far fa-smile"/>
                  </div>
                  <div className="num">{yearsOfExperience}</div>
                  <div className="title">{t('year_of_experience')}</div>
                </div>
              </div>
            </div>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              {/* Section Profile */}
              <div className="profile-box">
                <div
                  className="text"
                >
                  <p>{t('profile_para1')}</p>

                  <p>{t('profile_para2')}</p>

                  <p>{t('profile_para3')}</p>

                  <a
                    href="#contact-section"
                    className="btn"
                  >
                    <span>{t('contact_me')}</span>
                  </a>
                  <div
                    className="signature"
                  >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section
        className="section section-parallax section-parallax-2"
        id="resume-section"
      >
        <div className="container">
          {/* Section Heading */}
          <div className="m-titles">
            <h2
              className="m-title"
            >
              {t('my_background')}
            </h2>
          </div>
          <div className="row row-custom">
            <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3"></div>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              {/* History */}
              <div className="history-left">
                <div className="history-items">
                  <div className="p-title">{t('education')}</div>
                  <div
                    className="history-item"
                  >
                    <div className="date">2022 - 2024</div>
                    {t('syracuse_university')}
                    <div className="name">{t('syracuse_university')}</div>
                    <div className="subname">{t('master_cs')}</div>
                    {/*<div className="subname"><br></br>*/}
                    {/*  <strong>Relevant Courses: </strong> Blockchain, Object-Oriented Design,*/}
                    {/*  Structure Programming and Formal Method, Data Mining*/}
                    {/*</div>*/}
                  </div>
                  <div
                    className="history-item"
                  >
                    <div className="date">2017 - 2022</div>
                    <div className="name">{t('university_of_liverpool')}</div>
                    <div className="subname">{t('bachelor_cs')}</div>
                  </div>

                  <div
                    className="history-item"
                  >
                    <div className="subname"><br></br>{t('relevant_courses')}</div>
                  </div>

                </div>
              </div>

              {/* Experience Section */}
              <div className="history-right">
                <div className="history-items">
                  <div className="p-title">{t('experience')}</div>

                  {experiences.map((experience) => (
                    <div key={experience.id} className="history-item">
                      <div className="date">{experience.date}</div>
                      <div className="name">{experience.name}</div>
                      <div className="subname">{experience.subname}</div>
                      <div className="text">
                        {experience.text.split('\n').map((para, index) => (
                          <p key={index}>{para}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="clear"/>
              {/* Button CV */}
              <a
                target="_blank"
                rel="noreferrer"
                href="https://github.com/YuqiGuo105/Resume/blob/main/Yuqi_Guo_Resume.pdf"
                className="btn"
              >
                <span>{t('download_cv')}</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        className="section section-bg section-parallax section-parallax-5"
        id="works-section"
      >
        <div className="container">
          {/* Section Heading */}
          <div className="m-titles">
            <h2 className="m-title">{t('my_projects')}</h2>
          </div>

          <div
            className="text"
          >
            <h4>{t('sample_projects_text')}</h4>
          </div>

          {/* Works */}
          <ProjectIsotop/>
        </div>
      </section>

      <section id="Blog-section" className="section section-parallax section-parallax-5">
        <div className="container space-y-16">
          {/* My Technical Blogs */}
          <div className="m-titles">
            <h2 className="m-title">{t('my_technical_blogs')}</h2>
          </div>

          <div className="blog-items">
            <Slider {...settings}>
              {blogs.map((blog) => (
                <div key={blog.id} className="archive-item">
                  <div className="image">
                    <Link href={`/blog-single/${blog.id}`} legacyBehavior>
                      <a onClick={() => recordClick("blog-item", `/blog-single/${blog.id}`)}>
                        <img src={blog.image_url} alt={blog.title}/>
                      </a>
                    </Link>
                  </div>

                  <div className="desc">
                    <div className="category">
                      {blog.category}
                      <br/>
                      <span>{blog.date}</span>
                    </div>

                    <h3 className="title">
                      <Link href={`/blog-single/${blog.id}`} legacyBehavior>
                        <a onClick={() => recordClick("blog-item", `/blog-single/${blog.id}`)}>
                          {blog.title}
                        </a>
                      </Link>
                    </h3>

                    <div className="text">
                      <p>{blog.description}</p>
                      <div className="readmore">
                        <Link href={`/blog-single/${blog.id}`} legacyBehavior>
                          <a
                            className="lnk"
                          >
                            {t('read_more')}
                          </a>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </Slider>
          </div>

          <div className="blog-more-link">
            <Link href="/blog" legacyBehavior>
              <a className="btn">
                <span>{t('view_blogs')}</span>
              </a>
            </Link>
          </div>

          {/* Gap Between Sections */}
          <section className="section section-parallax section-parallax-5">
            <div className="container"></div>
          </section>

          {/* My Life */}
          <div className="m-titles">
            <h2 className="m-title">{t('my_vibrant_life')}</h2>
          </div>

          <div className="row row-custom">
            <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3"/>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              <div className="text">
                <p>{t('study_hard_msg')}</p>
              </div>
            </div>
          </div>

          <div className="blog-items grid gap-16 lg:grid-cols-3">
            {lifeBlogs.slice(0, 3).map(blog => {
              const {
                id,
                title,
                image_url,
                category,
                published_at,
                description,
                require_login,
              } = blog;

              const href = require_login
                ? `/login?next=/life-blog/${id}`
                : `/life-blog/${id}`;

              return (
                <div key={id} className="archive-item">
                  <div className="image">
                    <Link href={href} legacyBehavior>
                      <a >
                        <img src={image_url} alt={title}/>
                      </a>
                    </Link>
                  </div>

                  <div className="desc">
                    <div className="category">
                      {category}
                      <br/>
                      <span>{published_at}</span>
                    </div>

                    <h3 className="title">
                      <Link href={href} legacyBehavior>
                        <a >
                          {title}
                          {require_login && ` ${t('login_required')}`}
                        </a>
                      </Link>
                    </h3>

                    <div className="text">
                      <p>{description}</p>

                      <div className="readmore">
                        <Link href={href} legacyBehavior>
                          <a
                            className="lnk"

                          >
                            {require_login ? t('log_in_to_read') : t('read_more')}
                          </a>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="blog-more-link">
            <Link href="#" legacyBehavior>
              <a className="btn">
                <span>{t('view_blog')}</span>
              </a>
            </Link>
          </div>

        </div>

        {/* Ellipsis trimming for over‑long titles */}
        <style jsx>{`
          .title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 100%;
          }
        `}</style>
      </section>

      <ContactForm/>
    </Layout>
  );
};
export default Index;
