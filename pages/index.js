import dynamic from "next/dynamic";
import Link from "next/link";
import ContactForm from "../src/components/ContactForm";
import TestimonialSlider from "../src/components/TestimonialSlider";
import Layout from "../src/layout/Layout";
import SeoHead from "../src/components/SeoHead";
import {useEffect, useState, useRef} from "react";
import {supabase} from "../src/supabase/supabaseClient";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import Modal from "react-modal";

const GITHUB_URL = process.env.REACT_APP_GITHUB_URL || "https://github.com/YuqiGuo105";
const LEETCODE_URL = process.env.REACT_APP_LEETCODE_URL || "https://leetcode.com/u/Yuqi_Guo/";
const INSTAGRAM_URL = process.env.REACT_APP_INSTAGRAM_URL || "https://www.instagram.com/yuqi_guo17/";

Modal.setAppElement('#__next');

// sha256("1234") — used so the password never appears in plaintext in the bundle.
const PASSWORD_HASH = "03ac674216f3e15c761ee1a5e255f067953623c8f9664f0ad69d1c2a2aab7fe";

const hashPassword = async (value) => {
  if (typeof window === "undefined") {
    const { createHash } = await import("crypto");
    return createHash("sha256").update(value).digest("hex");
  }

  if (!window.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable");
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
};
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


const Index = ({ requirePassword }) => {
  const [blogs, setBlogs] = useState([]);
  const [error, setError] = useState(null);
  const [yearsOfExperience, setYearsOfExperience] = useState(1);
  const [experiences, setExperiences] = useState([]);
  const [companiesCount, setCompaniesCount] = useState(0);
  const [lifeBlogs, setLifeBlogs] = useState([]);
  const [loggedIn, setLoggedIn]     = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const timerRef = useRef(null);
  const progressBarRef = useRef(null);
  const [stories, setStories] = useState([]);
  const [isAuthenticated, setIsAuthenticated] = useState(!requirePassword);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
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

    bootstrap();
    if (!isProfileModalOpen || !isPlaying || stories.length === 0) return;

    timerRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          // 当前故事结束，切换到下一个
          setCurrentStoryIndex(prevIndex => {
            if (prevIndex >= stories.length - 1) {
              clearInterval(timerRef.current);
              setIsProfileModalOpen(false);
              return 0;
            }
            return prevIndex + 1;
          });
          return 0;
        }
        return prev + 1;
      });
    }, 50);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };

  }, [isProfileModalOpen, isPlaying, currentStoryIndex, stories.length]);


  useEffect(() => {
    const fetchStories = async () => {
      try {
        const endpoint = process.env.NEXT_PUBLIC_STORIES_ENDPOINT;
        const owner    = encodeURIComponent(process.env.NEXT_PUBLIC_STORIES_OWNER);
        if (!endpoint || !process.env.NEXT_PUBLIC_STORIES_OWNER) {
          console.warn("Stories endpoint/owner env vars missing – skipping stories fetch.");
          setStories([]);
          setIsPlaying(false);
          return;
        }
        const res      = await fetch(`${endpoint}/records/owner/${owner}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data || data.length === 0) {
          setStories([]);
          setIsPlaying(false);
          return;
        }

        // Normalise → {id, url, createdAt, description}
        const formatted = data.map((item, idx) => ({
          id: item.id ?? idx,
          url: item.url,
          description: item.description ?? "",
          createdAt: (item.createdAt?.seconds ?? 0) * 1000,
        }));

        // Newest first (optional)
        formatted.sort((a, b) => b.createdAt - a.createdAt);

        setStories(formatted);
      } catch (err) {
        console.error("❌ Failed to fetch stories:", err);
        setStories([]);
        setIsPlaying(false);
      }
    };

    fetchStories();
  }, []);

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

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    try {
      const hashedInput = await hashPassword(passwordInput.trim());
      if (hashedInput === PASSWORD_HASH) {
        setIsAuthenticated(true);
        setPasswordError("");
        setPasswordInput("");
        return;
      }
      setPasswordError("Incorrect password. Please try again.");
    } catch (err) {
      console.error("Failed to verify password", err);
      setPasswordError("Something went wrong. Please retry.");
    }
  };

  if (requirePassword && !isAuthenticated) {
    return (
      <>
        <SeoHead title="Yuqi Guo Portfolio" />
        <Layout>
          <div
            style={{
              minHeight: "70vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <form
              onSubmit={handlePasswordSubmit}
              style={{
                maxWidth: "360px",
                width: "100%",
                background: "#ffffff",
                borderRadius: "16px",
                boxShadow: "0 20px 45px rgba(15, 23, 42, 0.1)",
                padding: "32px",
              }}
            >
              <h2 style={{ marginBottom: "16px", fontSize: "1.5rem", fontWeight: 600 }}>
                Enter password
              </h2>
              <p style={{ marginBottom: "24px", color: "#475569" }}>
                This page is protected. Please provide the password to continue.
              </p>
              <label
                htmlFor="homepage-password"
                style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}
              >
                Password
              </label>
              <input
                id="homepage-password"
                type="password"
                value={passwordInput}
                onChange={(event) => {
                  setPasswordInput(event.target.value);
                  if (passwordError) setPasswordError("");
                }}
                autoFocus
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  border: "1px solid #cbd5f5",
                  marginBottom: "16px",
                }}
              />
              {passwordError && (
                <p style={{ color: "#ef4444", marginBottom: "16px" }}>{passwordError}</p>
              )}
              <button
                type="submit"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  border: "none",
                  backgroundColor: "#111827",
                  color: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Continue
              </button>
            </form>
          </div>
        </Layout>
      </>
    );
  }

  if (error) return <div>Error loading blogs: {error}</div>;
  if (!blogs.length) return <div>Loading...</div>;

  const settings = {
    infinite: true,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
  };
  const openStoryModal = () => {
    if (!stories.length) return;

    setCurrentStoryIndex(0);
    setProgress(0);
    setIsPlaying(true);
    setIsProfileModalOpen(true);
  };

  // 手动切换故事
  const goToStory = (index) => {
    setCurrentStoryIndex(index);
    setProgress(0); // 只重置当前故事的进度
  };

  // 暂停/播放控制
  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  // 处理点击进度条
  const handleProgressClick = (e) => {
    if (!progressBarRef.current) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const clickPosition = (e.clientX - rect.left) / rect.width;
    const newIndex = Math.floor(clickPosition * stories.length);

    if (newIndex >= 0 && newIndex < stories.length) {
      goToStory(newIndex);
    }
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
      <Modal
        isOpen={isProfileModalOpen}
        onRequestClose={() => {
          setIsProfileModalOpen(false)
          setCurrentStoryIndex(0);
          setProgress(0);
        }}
        contentLabel="Instagram Stories"
        style={{
          overlay: {
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backdropFilter: 'blur(5px)',
          },
          content: {
            position: 'relative',
            inset: 'auto',
            width: '100%',
            maxWidth: '500px',
            height: '90vh',
            maxHeight: '800px',
            padding: 0,
            border: 'none',
            background: 'none',
            overflow: 'hidden',
            borderRadius: '16px',
          }
        }}
      >
        <div className="story-container" style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          background: 'black',
        }}>
          {/* 进度条 */}
          <div
            ref={progressBarRef}
            style={{
              display: 'flex',
              position: 'absolute',
              top: '16px',
              left: '16px',
              right: '16px',
              height: '3px',
              zIndex: 10,
              gap: '4px',
              cursor: 'pointer',
            }}
            onClick={handleProgressClick}
          >
            {stories.map((_, index) => {
              // 计算当前分段的宽度：
              // - 已播放的故事：100%
              // - 当前故事：progress%
              // - 未播放的故事：0%
              const width =
                index < currentStoryIndex ? 100 :
                index === currentStoryIndex ? progress : 0;

              return (
                <div
                  key={index}
                  style={{
                    flex: 1,
                    height: '100%',
                    background: 'rgba(255, 255, 255, 0.3)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${width}%`,
                      height: '100%',
                      background: 'white',
                      transition: index === currentStoryIndex ? 'width 0.05s linear' : 'none',
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={() => {
              setIsProfileModalOpen(false)
              setCurrentStoryIndex(0);
              setProgress(0);
            }}
            style={{
              position: 'absolute',
              top: '24px',
              right: '24px',
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '28px',
              cursor: 'pointer',
              zIndex: 10,
              padding: 0,
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.3)',
            }}
          >
            ×
          </button>

          {/* 播放/暂停按钮 */}

          {/* 当前故事索引显示 */}
          <div style={{
            position: 'absolute',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'white',
            background: 'rgba(0, 0, 0, 0.3)',
            padding: '4px 12px',
            borderRadius: '12px',
            zIndex: 10,
            fontSize: '0.9rem',
          }}>
            {currentStoryIndex + 1} / {stories.length}
          </div>

          {/* 故事图片 */}
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}>
            {stories[currentStoryIndex] && (
              <img
                src={stories[currentStoryIndex].url}
                alt={`Story ${currentStoryIndex + 1}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
                onClick={() => goToStory((currentStoryIndex + 1) % stories.length)}
              />
            )}
          </div>

          {/* 底部用户信息 */}
          <div style={{
            position: 'absolute',
            bottom: '30px',
            left: 0,
            right: 0,
            textAlign: 'center',
            padding: '0 20px',
          }}>
            <div style={{
              color: 'white',
              fontSize: '1.5rem',
              fontWeight: '600',
              marginBottom: '8px',
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            }}>
              {stories[currentStoryIndex]?.description}
            </div>
            <div style={{
              color: '#ddd',
              fontSize: '1rem',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            }}>
              {stories[currentStoryIndex]
                ? new Date(stories[currentStoryIndex].createdAt).toLocaleDateString()
                : 'Today'}
            </div>
          </div>

          {/* 导航箭头 */}
          {currentStoryIndex > 0 && (
            <button
              onClick={() => goToStory(currentStoryIndex - 1)}
              style={{
                position: 'absolute',
                left: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'white',
                fontSize: '28px',
                cursor: 'pointer',
                zIndex: 10,
                padding: 0,
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.3)',
              }}
            >
              ←
            </button>
          )}

          {currentStoryIndex < stories.length - 1 && (
            <button
              onClick={() => goToStory(currentStoryIndex + 1)}
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'white',
                fontSize: '28px',
                cursor: 'pointer',
                zIndex: 10,
                padding: 0,
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.3)',
              }}
            >
              →
            </button>
          )}
        </div>
      </Modal>
      <section className="section section-started">
        <div className="container">
          {/* Hero Started */}
          <div className="hero-started">
            <div className="slide" style={{
              display: 'inline-block',
              cursor: 'pointer',
            }}
                 onClick={openStoryModal}
            >
              <div style={{
                display: 'inline-block',
                position: 'relative',
                width: '90%',
                height: '100%',
                transition: 'transform 0.3s ease',
              }}>
                {/* 渐变圆环 */}
                {stories.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-10px',
                      left: '-10px',
                      right: '-10px',
                      bottom: '-10px',
                      borderRadius: '380px',
                      background:
                        'linear-gradient(5deg, #ff6b6b, #ff8e8e, #4ecdc4, #8deee0, #ffe66d, #ffef9f, #1a535c, #2b7a78, #ff6b6b)',
                      zIndex: 0,
                      animation: 'verticalGradient 8s linear infinite',
                      backgroundSize: '100% 400%',
                    }}
                  />
                )}

                <img
                  src="/assets/images/profile_guyuqi.jpg"
                  alt="avatar"
                  style={{
                    width: '100%',
                    borderRadius: '380px',
                    position: 'relative',
                    zIndex: 1,
                    border: '5px solid white',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* 隐藏原有circle元素但保留在DOM中 */}
              <span className="circle circle-1" style={{ display: 'none' }}></span>
              <span className="circle circle-2" style={{ display: 'none' }}></span>
              <span className="circle circle-3" style={{ display: 'none' }}></span>
              <span className="circle circle-4" style={{ display: 'none' }}></span>
              <span className="circle circle-5" style={{ display: 'none' }}></span>
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
                    href={GITHUB_URL}
                    onClick={() => recordClick("social-link", GITHUB_URL)}
                  >
                    <i aria-hidden="true" className="fab fa-github"/>
                  </a>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={LEETCODE_URL}
                    onClick={() => recordClick("social-link", LEETCODE_URL)}
                  >
                    <i aria-hidden="true" className="leetcode-icon-bottom custom-leetcode-icon"/>
                  </a>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={INSTAGRAM_URL}
                    onClick={() => recordClick("social-link", INSTAGRAM_URL)}
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
                          {require_login && " (login required)"}
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
                            {require_login ? "Log in to read" : "Read more"}
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
    </>
  );
};

export async function getServerSideProps() {
  const passwordFromEnv = process.env.PASSWORD ?? "";
  let requirePassword = false;

  if (passwordFromEnv) {
    const hashedEnvPassword = await hashPassword(passwordFromEnv);
    requirePassword = hashedEnvPassword === PASSWORD_HASH;
  }

  return {
    props: { requirePassword },
  };
}

export default Index;
