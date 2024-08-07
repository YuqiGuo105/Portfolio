import dynamic from "next/dynamic";
import Link from "next/link";
import ContactForm from "../src/components/ContactForm";
import TestimonialSlider from "../src/components/TestimonialSlider";
import Layout from "../src/layout/Layout";
import {useEffect, useState} from "react";
import {supabase} from "../src/supabase/supabaseClient";

const ProjectIsotop = dynamic(() => import("../src/components/ProjectIsotop"), {
  ssr: false,
});
const Index = () => {
  const [blogs, setBlogs] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchBlogs = async () => {
      const {data, error} = await supabase
        .from('Blogs') // Adjust this to your actual table name
        .select('*'); // Fetches all columns, adjust if needed

      if (error) setError(error.message);
      else setBlogs(data);
    };

    fetchBlogs();
  }, []); // The empty array ensures this effect runs only once after the initial render

  if (error) return <div>Error loading blogs: {error}</div>;
  if (!blogs.length) return <div>Loading...</div>;

  return (
    <Layout>
      <section className="section section-started">
        <div className="container">
          {/* Hero Started */}
          <div className="hero-started">
            <div
              className="slide"
            >
              <img src="assets/images/testimonial-2.jpg" alt=""/>
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
                <p>
                  I am a CS Master in Syracuse University, with specializations in <strong>Full-Stack
                  Development </strong>, <strong>Backend Programming </strong>, and <strong> Mobile
                  Application Development </strong>.
                </p>
                <div className="social-links">
                  <a target="_blank" rel="noreferrer"
                     href="https://www.linkedin.com/in/yuqi-g-ab3380146">
                    <i aria-hidden="true" className="fab fa-linkedin"/>
                  </a>
                  <a target="_blank" rel="noreferrer" href="https://github.com/YuqiGuo105">
                    <i aria-hidden="true" className="fab fa-github"/>
                  </a>
                  <a target="_blank" rel="noreferrer" href="https://www.instagram.com/yuqi_guo17/">
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
                  Experience <strong>1 Years</strong>
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
                  <div className="num">3</div>
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
                  <div className="num">1</div>
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
                    My name is Yuqi Guo, and I am an innovative programmer currently pursuing a
                    Master's degree in
                    Computer Science at Syracuse University, with an expected graduation date of May
                    2024.
                  </p>
                  <p>
                    I am actively seeking full-time Software Development Engineer (SDE) positions
                    for the Fall of 2024,
                    focusing on new graduate opportunities. My academic journey exposed me to a
                    plethora of subjects including Data Structures, Algorithms,
                    Operating Systems, Machine Learning, and more.
                  </p>

                  <p>
                    Technically, I'm proficient in a range of languages including Java, Python, and
                    HTML5. I've garnered
                    experience with numerous frameworks and platforms like TensorFlow, Spring Boot,
                    React, and AWS
                    services such as ECS, EC2, and S3. Additionally, my toolkit consists of Postman,
                    Docker &
                    Kubernetes, GitHub, and JWT Authentication/Authorization mechanisms. I have a
                    keen interest in Java
                    Web development and Android Programming.
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
                    <div className="subname"><br></br>
                      <strong>Relevant Courses: </strong> Blockchain, Object-Oriented Design,
                      Structure Programming and Formal Method, Data Mining
                    </div>
                  </div>
                  <div
                    className="history-item"
                  >
                    <div className="date">2017 - 2022</div>
                    <div className="name">University of Liverpool</div>
                    <div className="subname">Bachelors of Science, Computer Science</div>
                    <div className="subname"><br></br>
                      <strong>Relevant Courses: </strong> Data Structure, Algorithm, Operating
                      System, Database, Computer Network, Human-Centric Interaction, Software
                      Engineering, Mobile Computing, Computer Graphics, Machine Learning
                    </div>
                  </div>
                </div>
              </div>
              <div className="history-right">
                <div className="history-items">
                  <div
                    className="p-title"
                  >
                    EXPERIENCE
                  </div>
                  <div
                    className="history-item"
                  >
                    <div className="date">Aug 2023 - Dec 2023</div>
                    <div className="name">CuraStone Corp</div>
                    <div className="subname">Backend Developer Intern</div>
                    <div className="text">
                      <p>
                        Developed a Spring Boot application for converting PDFs into interactive
                        flashcards, using AWS ECS and DynamoDB. Implemented JWT/Cognito for
                        security, robust testing with Mockito and JUnit, and automated service
                        monitoring, achieving 99.9% uptime.
                      </p>
                    </div>
                  </div>
                  <div
                    className="history-item"
                  >
                    <div className="date">Sep 2021 - Feb 2022</div>
                    <div className="name">Weina Technology Company</div>
                    <div className="subname">Backend Developer Intern</div>
                    <div className="text">
                      <p>
                        Developed Python Flask backend services for scalable performance; led
                        Kubernetes deployments with load balancing and auto-scaling; utilized
                        Redis for node management, enhancing data synchronization and
                        resilience.
                      </p>
                    </div>
                  </div>
                  <div
                    className="history-item"
                  >
                    <div className="date">Jun 2020 - Aug 2020</div>
                    <div className="name">Tree Technology Co., Ltd.</div>
                    <div className="subname">Software Development Engineer Intern</div>
                    <div className="text">
                      <p>
                        Developed an image annotation platform, improving user efficiency by
                        25%; led backend Java development and integrated MyBatis and Vue.js,
                        enhancing processing speed and user experience.
                      </p>
                    </div>
                  </div>
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

      <section className="section section-parallax section-parallax-5" id="Blog-section">
        <div className="container">
          {/* Section Heading */}
          <div className="m-titles">
            <h2
              className="m-title"
            >
              My Technical Blogs
            </h2>
          </div>

          <div className="blog-items">
            {blogs.slice(0, 1).map((blog) => (
              <div key={blog.id} className="archive-item">
                <div className="image">
                  <Link href={`/blog-single/${blog.id}`}>
                    <a>
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
                    <Link href={`/blog-single/${blog.id}`}>
                      <a>{blog.title}</a>
                    </Link>
                  </h3>
                  <div className="text">
                    <p>{blog.description}</p>
                    <div className="readmore">
                      <Link href={`/blog-single/${blog.id}`}>
                        <a className="lnk">Read more</a>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <style jsx>{`
            .title {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              max-width: 100%;
            }
          `}</style>

          <div className="blog-more-link">
            <Link href="/blog">
              <a
                className="btn"
              >
                <span>View Blogs</span>
              </a>
            </Link>
          </div>

        </div>
      </section>

      <ContactForm/>
    </Layout>
  );
};
export default Index;
