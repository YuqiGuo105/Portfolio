import dynamic from "next/dynamic";
import Link from "next/link";
import ContactForm from "../src/components/ContactForm";
import TestimonialSlider from "../src/components/TestimonialSlider";
import Layout from "../src/layout/Layout";
import SeoHead from "../src/components/SeoHead";
import {useEffect, useState} from "react";
import {supabase} from "../src/supabase/supabaseClient";
import { useRouter } from "next/router";
import AuthDialog from "../src/components/AuthDialog";
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
  const [blogs, setBlogs] = useState([]);
  const [error, setError] = useState(null);
  const [yearsOfExperience, setYearsOfExperience] = useState(1);
  const [experiences, setExperiences] = useState([]);
  const [companiesCount, setCompaniesCount] = useState(0);
  const [lifeBlogs, setLifeBlogs] = useState([]);
  const [loggedIn, setLoggedIn]     = useState(false);
  const [showAuth, setShowAuth]     = useState(false);
  const [authNext, setAuthNext]     = useState("/");
  const router = useRouter();

  // Check auth state once and subscribe to changes
  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted) setLoggedIn(!!session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session);
    });
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

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

  const handleLoginClick = (e, nextUrl) => {
    e.preventDefault();
    setAuthNext(nextUrl);
    setShowAuth(true);
  };

  if (error) return <div>Error loading blogs: {error}</div>;
  if (!blogs.length) return <div>Loading...</div>;

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
    <>
      <SeoHead title="Yuqi Guo Portfolio" />
      <Layout>
      <section className="section section-started">
        <div className="container">
          {/* Hero Started */}
          <div className="hero-started">
            <div
              className="slide"
            >
              <img
                src="/assets/images/profile_guyuqi.jpg"
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
              About Me
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
                  <div className="title">
                    Companies <br/>
                    Worked
                  </div>
                </div>
                <div
                  className="numbers-item"
                >
                  <div className="icon">
                    <i aria-hidden="true" className="far fa-check-circle"/>
                  </div>
                  <div className="num">2</div>
                  <div className="title">
                    Total <br/>
                    Degrees
                  </div>
                </div>
                <div
                  className="numbers-item"
                >
                  <div className="icon">
                    <i aria-hidden="true" className="far fa-smile"/>
                  </div>
                  <div className="num">{yearsOfExperience}</div>
                  <div className="title">
                    Year of <br/>
                    Experience
                  </div>
                </div>
              </div>
            </div>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              {/* Section Profile */}
              <div className="profile-box">
                <div
                  className="text"
                >
                  <p>
                    Hello, my name is Yuqi Guo, and I am currently a Software Development Engineer in the Global Banking
                    and Markets division at <strong>Goldman Sachs</strong>,
                    focusing on the Margins team. My role involves designing and developing robust backend systems to
                    ensure accurate and efficient margin calculations,
                    leveraging technologies like Spring Boot, REST APIs, and microservices.
                  </p>

                  <p>
                    I hold a Master's degree in Computer Science from Syracuse University and a Bachelor's degree in
                    Information and Computing Science from the University of Liverpool.
                    With a strong foundation in backend development, <strong>microservice architecture</strong>,
                    and <strong>system design</strong>, I have experience deploying scalable solutions using tools
                    like <em>Docker</em>, <em>Kubernetes</em>, and <em>AWS</em>.
                  </p>

                  <p>
                    My professional journey includes projects such as building microservices for scalable platforms,
                    optimizing system performance, and maintaining secure, high-availability systems.
                    I am passionate about solving complex problems, improving system efficiencies, and contributing to
                    high-impact financial systems.
                  </p>

                  <a
                    href="#contact-section"
                    className="btn"
                  >
                    <span>Contact Me</span>
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
              My Background
            </h2>
          </div>
          <div className="row row-custom">
            <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3"></div>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              {/* History */}
              <div className="history-left">
                <div className="history-items">
                  <div
                    className="p-title"
                  >
                    EDUCATION
                  </div>
                  <div
                    className="history-item"
                  >
                    <div className="date">2022 - 2024</div>
                    Syracuse University
                    <div className="name">Syracuse University</div>
                    <div className="subname">Master Of Science, Computer Science</div>
                    {/*<div className="subname"><br></br>*/}
                    {/*  <strong>Relevant Courses: </strong> Blockchain, Object-Oriented Design,*/}
                    {/*  Structure Programming and Formal Method, Data Mining*/}
                    {/*</div>*/}
                  </div>
                  <div
                    className="history-item"
                  >
                    <div className="date">2017 - 2022</div>
                    <div className="name">University of Liverpool</div>
                    <div className="subname">Bachelors of Science, Computer Science</div>
                  </div>

                  <div
                    className="history-item"
                  >
                    <div className="subname"><br></br>
                      <strong>Relevant Courses: </strong> Data Structure, Algorithm, Operating
                      System, Database, Computer Network, Human-Centric Interaction, Software
                      Engineering, Mobile Computing, Computer Graphics, Machine Learning
                    </div>
                  </div>
                </div>
              </div>

              {/* Experience Section */}
              <div className="history-right">
                <div className="history-items">
                  <div className="p-title">EXPERIENCE</div>

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
                <span>Download CV</span>
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
            <h2
              className="m-title"
            >
              My Projects
            </h2>
          </div>

          <div
            className="text"
          >
            <h4>
              A Collection of my sample projects I’ve developed.
              Feeling great while sharing here!
            </h4>
          </div>

          {/* Works */}
          <ProjectIsotop/>
        </div>
      </section>

      <section id="Blog-section" className="section section-parallax section-parallax-5">
        <div className="container space-y-16">
          {/* My Technical Blogs */}
          <div className="m-titles">
            <h2 className="m-title">My Technical Blogs</h2>
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
                            Read more
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
                <span>View Blogs</span>
              </a>
            </Link>
          </div>

          {/* Gap Between Sections */}
          <section className="section section-parallax section-parallax-5">
            <div className="container"></div>
          </section>

          {/* My Life */}
          <div className="m-titles">
            <h2 className="m-title">My Vibrant Life</h2>
          </div>

          <div className="row row-custom">
            <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3"/>
            <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
              <div className="text">
                <p>
                  Study Hard. Work Smart. Build the Future!
                </p>
              </div>
            </div>
          </div>

          <div className="blog-items grid gap-16 lg:grid-cols-3">
            {lifeBlogs.slice(0, 2).map(blog => {
              const {
                id,
                title,
                image_url,
                category,
                published_at,
                description,
                require_login,
              } = blog;

              const href = `/life-blog/${id}`;

              const needsLogin = require_login && !loggedIn;

              return (
                <div key={id} className="archive-item">
                  <div className="image">
                    {needsLogin ? (
                      <a href="#" onClick={(e) => handleLoginClick(e, href)}>
                        <img src={image_url} alt={title} />
                      </a>
                    ) : (
                      <Link href={href} legacyBehavior>
                        <a>
                          <img src={image_url} alt={title} />
                        </a>
                      </Link>
                    )}
                  </div>

                  <div className="desc">
                    <div className="category">
                      {category}
                      <br/>
                      <span>{published_at}</span>
                    </div>

                    <h3 className="title">
                      {needsLogin ? (
                        <a href="#" onClick={(e) => handleLoginClick(e, href)}>
                          {title} (login required)
                        </a>
                      ) : (
                        <Link href={href} legacyBehavior>
                          <a>{title}</a>
                        </Link>
                      )}
                    </h3>

                    <div className="text">
                      <p>{description}</p>

                      <div className="readmore">
                        {needsLogin ? (
                          <a
                            href="#"
                            className="lnk"
                            onClick={(e) => handleLoginClick(e, href)}
                          >
                            Log in to read
                          </a>
                        ) : (
                          <Link href={href} legacyBehavior>
                            <a className="lnk">Read more</a>
                          </Link>
                        )}
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
                <span>View Blog</span>
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
    {showAuth && (
      <AuthDialog next={authNext} onClose={() => setShowAuth(false)} />
    )}
    </>
  );
};
export default Index;
