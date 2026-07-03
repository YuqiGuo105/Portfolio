import dynamic from "next/dynamic";
import Link from "next/link";
import ContactForm from "../src/components/ContactForm";
import TestimonialSlider from "../src/components/TestimonialSlider";
import Layout from "../src/layout/Layout";
import SeoHead, { SITE_URL, absoluteUrl } from "../src/components/SeoHead";
import DashboardPanels from "../src/components/DashboardPanels";
import {useEffect, useState, useRef} from "react";
import {supabase} from "../src/supabase/supabaseClient";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import Modal from "react-modal";
import { useRouter } from 'next/router';
import LogInDialog from "../src/components/LogInDialog";
import SiteTour from "../src/components/SiteTour";

const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL;
const LEETCODE_URL = process.env.NEXT_PUBLIC_LEETCODE_URL;
const INSTAGRAM_URL = process.env.NEXT_PUBLIC_INSTAGRAM_URL;

Modal.setAppElement('#__next');
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
      },
    },
    {
      breakpoint: 600,
      settings: {
        slidesToShow: 1,
        slidesToScroll: 1,
      },
    },
  ],
};


const Index = () => {
  const [blogs, setBlogs] = useState([]);
  const [error, setError] = useState(null);
  const [yearsOfExperience, setYearsOfExperience] = useState(1);
  const [experiences, setExperiences] = useState([]);
  const [companiesCount, setCompaniesCount] = useState(0);
  const [lifeBlogs, setLifeBlogs] = useState([]);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const timerRef = useRef(null);
  const progressBarRef = useRef(null);
  const [stories, setStories] = useState([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [showLogin, setShowLogin] = useState(false);
  const [pendingNext, setPendingNext] = useState(null);
  const [githubCommits, setGithubCommits] = useState("600+");
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [isLightSkin, setIsLightSkin] = useState(false);

  // Detect light/dark skin from body class
  useEffect(() => {
    const check = () => setIsLightSkin(document.body.classList.contains("light-skin"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // --- Simple toast (no library) ---
  const [toast, setToast] = useState({
    visible: false,
    closing: false,
    message: "",
  });
  const toastTimerRef = useRef(null);
  const toastCloseTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (toastCloseTimerRef.current) clearTimeout(toastCloseTimerRef.current);
    };
  }, []);

  const showToast = (message, duration = 2200) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastCloseTimerRef.current) clearTimeout(toastCloseTimerRef.current);

    setToast({ visible: true, closing: false, message });

    toastTimerRef.current = setTimeout(() => {
      setToast((t) => ({ ...t, closing: true }));
    }, duration);

    toastCloseTimerRef.current = setTimeout(() => {
      setToast({ visible: false, closing: false, message: "" });
    }, duration + 220);
  };

  const sanitizeNextPath = (value) => {
    if (typeof value !== 'string') return '/';
    return value.startsWith('/') ? value : '/';
  };

  useEffect(() => {
    const bootstrap = async () => {
      /* years of experience */
      const startYear = Number(
        process.env.NEXT_PUBLIC_START_YEAR ?? new Date().getFullYear()
      );
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
        .select(
          "id, title, image_url, category, published_at, description, require_login"
        )
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
      setCompaniesCount(new Set(exp.map((e) => e.name)).size);
    };

    bootstrap();

    /* GitHub commit count */
    const fetchGithubCommits = async () => {
      try {
        const res = await fetch(
          "https://api.github.com/search/commits?q=author:YuqiGuo105&per_page=1",
          { headers: { Accept: "application/vnd.github.cloak-preview+json" } }
        );
        if (!res.ok) return;
        const json = await res.json();
        if (json.total_count && json.total_count > 0) {
          const count = json.total_count;
          // Round down to nearest 100 and show as e.g. "600+"
          const rounded = Math.floor(count / 100) * 100;
          setGithubCommits(count >= 1000 ? `${(count / 1000).toFixed(1)}k+` : `${rounded}+`);
        }
      } catch (_) {
        /* keep fallback */
      }
    };
    fetchGithubCommits();
    if (!isProfileModalOpen || !isPlaying || stories.length === 0) return;

    timerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setCurrentStoryIndex((prevIndex) => {
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
        const owner = encodeURIComponent(process.env.NEXT_PUBLIC_STORIES_OWNER);
        if (!endpoint || !process.env.NEXT_PUBLIC_STORIES_OWNER) {
          console.warn(
            "Stories endpoint/owner env vars missing – skipping stories fetch."
          );
          setStories([]);
          setIsPlaying(false);
          return;
        }
        const res = await fetch(`${endpoint}/records/owner/${owner}`);
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
        const response = await fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ localTime }),
        });

        // Check if the response is not OK (e.g. status !== 200)
        if (!response.ok) {
          console.error("Visitor tracking failed with status:", response.status);
        }
      } catch (error) {
        console.error("Error tracking visitor:", error);
      }
    };

    trackVisitor();
  }, []);

  // Helper to record a click event
  const recordClick = async (clickEvent, targetUrl) => {
    const localTime = new Date().toISOString();
    try {
      await fetch("/api/click", {
        // Ensure this URL is correct
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clickEvent, targetUrl, localTime }),
      });
    } catch (err) {
      console.error("Error logging click event:", err);
    }
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
  const openStoryModal = () => {
    if (!stories.length) {
      setGithubModalOpen(true);
      return;
    }
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
      { breakpoint: 640, settings: { slidesToShow: 1 } },
    ],
  };

  const handleProtectedClick = (e, requireLogin, nextHref) => {
    if (!requireLogin) return; // Not login -> directly jump
    e.preventDefault(); // Requires login
    setPendingNext(nextHref); // 记录本来要去的地址
    setShowLogin(true); // 打开登录弹窗
  };

  const handleLoginConfirm = async (username, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: username,
        password,
      });

      if (error) {
        return { error: "Invalid username or password." };
      }

      const target = sanitizeNextPath(pendingNext || "/");
      setPendingNext(null);
      setShowLogin(false);
      await router.push(target);
      return { ok: true };
    } catch (err) {
      return { error: err?.message || "Unable to log in right now." };
    }
  };

  // --- NEW: Sign up button handler ---
  const handleRegisterFromLogin = () => {
    // Close dialog first, then scroll + toast (dialog animation ~200ms)
    setShowLogin(false);

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        const target = document.querySelector("#contact-section");
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        showToast("Please Connect Yuqi to register");
      }, 240);
    }
  };

  return (
    <>
      <SeoHead
        title="Yuqi Guo Portfolio"
        description="Explore the software engineering portfolio of Yuqi Guo (郭育奇), featuring backend projects, professional experience, and technical articles."
        keywords="Yuqi Guo, 郭育奇, software engineer, portfolio, backend engineer, Goldman Sachs"
        url={absoluteUrl('/')}
        jsonLd={[
          // Person schema — tells Google this site is authored by a
          // real person and connects it to external profiles for the
          // Knowledge Panel.
          {
            '@context': 'https://schema.org',
            '@type': 'Person',
            name: 'Yuqi Guo',
            alternateName: '郭育奇',
            url: SITE_URL,
            jobTitle: 'Software Engineer',
            sameAs: [
              'https://github.com/YuqiGuo105',
              'https://www.linkedin.com/in/yuqi-guo/',
            ],
          },
          // WebSite schema — enables the sitelinks search box in SERPs
          // pointing at the tag-search route on /blogs.
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            url: SITE_URL,
            name: "Yuqi Guo's Portfolio",
            potentialAction: {
              '@type': 'SearchAction',
              target: `${SITE_URL}/blogs?tag={search_term_string}`,
              'query-input': 'required name=search_term_string',
            },
          },
        ]}
      />
      <Layout>
        <Modal
          isOpen={isProfileModalOpen}
          onRequestClose={() => {
            setIsProfileModalOpen(false);
            setCurrentStoryIndex(0);
            setProgress(0);
          }}
          contentLabel="Instagram Stories"
          style={{
            overlay: {
              backgroundColor: "rgba(0, 0, 0, 0.9)",
              zIndex: 1000,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              backdropFilter: "blur(5px)",
            },
            content: {
              position: "relative",
              inset: "auto",
              width: "100%",
              maxWidth: "500px",
              height: "90vh",
              maxHeight: "800px",
              padding: 0,
              border: "none",
              background: "none",
              overflow: "hidden",
              borderRadius: "16px",
            },
          }}
        >
          <div
            className="story-container"
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              background: "black",
            }}
          >
            {/* 进度条 */}
            <div
              ref={progressBarRef}
              style={{
                display: "flex",
                position: "absolute",
                top: "16px",
                left: "16px",
                right: "16px",
                height: "3px",
                zIndex: 10,
                gap: "4px",
                cursor: "pointer",
              }}
              onClick={handleProgressClick}
            >
              {stories.map((_, index) => {
                // 计算当前分段的宽度：
                // - 已播放的故事：100%
                // - 当前故事：progress%
                // - 未播放的故事：0%
                const width =
                  index < currentStoryIndex
                    ? 100
                    : index === currentStoryIndex
                      ? progress
                      : 0;

                return (
                  <div
                    key={index}
                    style={{
                      flex: 1,
                      height: "100%",
                      background: "rgba(255, 255, 255, 0.3)",
                      borderRadius: "2px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${width}%`,
                        height: "100%",
                        background: "white",
                        transition:
                          index === currentStoryIndex
                            ? "width 0.05s linear"
                            : "none",
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={() => {
                setIsProfileModalOpen(false);
                setCurrentStoryIndex(0);
                setProgress(0);
              }}
              style={{
                position: "absolute",
                top: "24px",
                right: "24px",
                background: "none",
                border: "none",
                color: "white",
                fontSize: "28px",
                cursor: "pointer",
                zIndex: 10,
                padding: 0,
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0, 0, 0, 0.3)",
              }}
            >
              ×
            </button>

            {/* 当前故事索引显示 */}
            <div
              style={{
                position: "absolute",
                top: "24px",
                left: "50%",
                transform: "translateX(-50%)",
                color: "white",
                background: "rgba(0, 0, 0, 0.3)",
                padding: "4px 12px",
                borderRadius: "12px",
                zIndex: 10,
                fontSize: "0.9rem",
              }}
            >
              {currentStoryIndex + 1} / {stories.length}
            </div>

            {/* 故事图片 */}
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {stories[currentStoryIndex] && (
                <img
                  src={stories[currentStoryIndex].url}
                  alt={`Story ${currentStoryIndex + 1}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                  onClick={() => goToStory((currentStoryIndex + 1) % stories.length)}
                />
              )}
            </div>

            {/* 底部用户信息 */}
            <div
              style={{
                position: "absolute",
                bottom: "30px",
                left: 0,
                right: 0,
                textAlign: "center",
                padding: "0 20px",
              }}
            >
              <div
                style={{
                  color: "white",
                  fontSize: "1.5rem",
                  fontWeight: "600",
                  marginBottom: "8px",
                  textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                }}
              >
                {stories[currentStoryIndex]?.description}
              </div>
              <div
                style={{
                  color: "#ddd",
                  fontSize: "1rem",
                  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                }}
              >
                {stories[currentStoryIndex]
                  ? new Date(stories[currentStoryIndex].createdAt).toLocaleDateString()
                  : "Today"}
              </div>
            </div>

            {/* 导航箭头 */}
            {currentStoryIndex > 0 && (
              <button
                onClick={() => goToStory(currentStoryIndex - 1)}
                style={{
                  position: "absolute",
                  left: "16px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "white",
                  fontSize: "28px",
                  cursor: "pointer",
                  zIndex: 10,
                  padding: 0,
                  width: "50px",
                  height: "50px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0, 0, 0, 0.3)",
                }}
              >
                ←
              </button>
            )}

            {currentStoryIndex < stories.length - 1 && (
              <button
                onClick={() => goToStory(currentStoryIndex + 1)}
                style={{
                  position: "absolute",
                  right: "16px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "white",
                  fontSize: "28px",
                  cursor: "pointer",
                  zIndex: 10,
                  padding: 0,
                  width: "50px",
                  height: "50px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,  0, 0, 0.3)",
                }}
              >
                →
              </button>
            )}
          </div>
        </Modal>

        {/* ── GitHub Activity Modal ── */}
        <Modal
          isOpen={githubModalOpen}
          onRequestClose={() => setGithubModalOpen(false)}
          contentLabel="GitHub Activity"
          style={{
            overlay: {
              backgroundColor: "rgba(0,0,0,0.75)",
              zIndex: 1000,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              backdropFilter: "blur(6px)",
            },
            content: {
              position: "relative",
              inset: "auto",
              width: "96%",
              maxWidth: "900px",
              maxHeight: "88vh",
              padding: 0,
              border: "none",
              background: "none",
              overflow: "hidden",
              borderRadius: "18px",
            },
          }}
        >
          <div style={{
            background: isLightSkin ? "#ffffff" : "#0d1117",
            borderRadius: "18px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: isLightSkin ? "0 8px 40px rgba(0,0,0,0.14)" : "0 8px 40px rgba(0,0,0,0.6)",
          }}>
            {/* Header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "18px 24px",
              borderBottom: isLightSkin ? "1px solid rgba(0,0,0,0.1)" : "1px solid rgba(255,255,255,0.1)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <img
                  src="/assets/images/profile_guyuqi.jpg"
                  alt="YuqiGuo105"
                  style={{ width: 36, height: 36, minWidth: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                />
                <div>
                  <div style={{ color: isLightSkin ? "#1c2528" : "#e6edf3", fontWeight: 700, fontSize: "15px" }}>YuqiGuo105</div>
                  <div style={{ color: isLightSkin ? "#6b7280" : "#7d8590", fontSize: "12px" }}>GitHub Activity</div>
                </div>
              </div>
              <button
                onClick={() => setGithubModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: isLightSkin ? "#6b7280" : "#7d8590",
                  fontSize: "22px",
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "4px 8px",
                  borderRadius: "6px",
                }}
              >×</button>
            </div>

            {/* Contribution graph */}
            <div style={{ padding: "20px 24px", overflowY: "auto", background: isLightSkin ? "#f7f5f2" : "transparent" }}>
              <div style={{ color: isLightSkin ? "#6b7280" : "#7d8590", fontSize: "13px", marginBottom: "12px" }}>
                {githubCommits} contributions in the last year
              </div>
              <img
                src={`https://ghchart.rshah.org/ff8059/YuqiGuo105`}
                alt="GitHub Contribution Chart"
                style={{ width: "100%", borderRadius: "8px", display: "block", background: isLightSkin ? "#fff" : "transparent", padding: isLightSkin ? "8px" : 0 }}
                onError={(e) => { e.target.style.display = "none"; }}
              />
              <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ color: isLightSkin ? "#1c2528" : "#e6edf3", fontWeight: 600, fontSize: "14px" }}>Recent Activity</div>
                {[
                  { repo: "YuqiGuo105/Portfolio", label: "6 commits", icon: "fa-code-branch" },
                  { repo: "kubernetes-client/java", label: "1 commit + PR", icon: "fa-code-pull-request" },
                  { repo: "YuqiGuo105/ai-agent-platform", label: "active", icon: "fa-robot" },
                ].map((item) => (
                  <a
                    key={item.repo}
                    href={`https://github.com/${item.repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      background: isLightSkin ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)",
                      borderRadius: "8px",
                      border: isLightSkin ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.08)",
                      textDecoration: "none",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,128,89,0.10)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = isLightSkin ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)"}
                  >
                    <i className={`fas ${item.icon}`} style={{ color: "#ff8059", fontSize: "13px", width: 16 }} />
                    <span style={{ color: isLightSkin ? "#1c2528" : "#e6edf3", fontSize: "13px", flex: 1 }}>{item.repo}</span>
                    <span style={{ color: isLightSkin ? "#6b7280" : "#7d8590", fontSize: "12px" }}>{item.label}</span>
                    <i className="fas fa-external-link-alt" style={{ color: isLightSkin ? "#9ca3af" : "#7d8590", fontSize: "10px" }} />
                  </a>
                ))}
              </div>
              <div style={{ marginTop: "18px", textAlign: "center" }}>
                <a
                  href="https://github.com/YuqiGuo105"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 24px",
                    background: "linear-gradient(135deg,#ff8059,#ff4d24)",
                    borderRadius: "50px",
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  <i className="fab fa-github" />
                  View Full GitHub Profile
                </a>
              </div>
            </div>
          </div>
        </Modal>

        <section className="section section-started">
          <div className="container">
            {/* Hero Started */}
            <div className="hero-started">
              <div
                className="slide"
                style={{
                  display: "block",
                  textAlign: "center",
                  cursor: "pointer",
                }}
                onClick={openStoryModal}
              >
                <div
                  style={{
                    display: "inline-block",
                    position: "relative",
                    width: "90%",
                    height: "100%",
                    transition: "transform 0.3s ease",
                  }}
                >
                  {/* 渐变圆环 — always visible */}
                  <div
                      style={{
                        position: "absolute",
                        top: "-10px",
                        left: "-10px",
                        right: "-10px",
                        bottom: "-10px",
                        borderRadius: "380px",
                        background:
                          "linear-gradient(5deg, #ff6b6b, #ff8e8e, #4ecdc4, #8deee0, #ffe66d, #ffef9f, #1a535c, #2b7a78, #ff6b6b)",
                        zIndex: 0,
                        animation: "verticalGradient 8s linear infinite",
                        backgroundSize: "100% 400%",
                      }}
                    />

                  <img
                    src="/assets/images/profile.png"
                    alt="avatar"
                    style={{
                      width: "100%",
                      borderRadius: "380px",
                      position: "relative",
                      zIndex: 1,
                      border: "5px solid white",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* 隐藏原有circle元素但保留在DOM中 */}
                <span className="circle circle-1" style={{ display: "none" }}></span>
                <span className="circle circle-2" style={{ display: "none" }}></span>
                <span className="circle circle-3" style={{ display: "none" }}></span>
                <span className="circle circle-4" style={{ display: "none" }}></span>
                <span className="circle circle-5" style={{ display: "none" }}></span>
              </div>
              <div className="content">
                <div className="titles">
                  <div className="subtitle">Full-Stack, Backend, Mobile Application Developer</div>
                  <h2 className="title">Yuqi Guo</h2>
                </div>
                <div className="description">
                  <p>
                    {" "}
                    I am a Software Engineer at <strong>Goldman Sachs</strong>, specializing in{" "}
                    <strong>Microservices</strong> and <strong>Distributed Systems</strong>.
                  </p>

                  <div className="social-links">
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={GITHUB_URL}
                      onClick={() => recordClick("social-link", GITHUB_URL)}
                    >
                      <i aria-hidden="true" className="fab fa-github" />
                    </a>
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={LEETCODE_URL}
                      onClick={() => recordClick("social-link", LEETCODE_URL)}
                    >
                      <i
                        aria-hidden="true"
                        className="leetcode-icon-bottom custom-leetcode-icon"
                      />
                    </a>
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={INSTAGRAM_URL}
                      onClick={() => recordClick("social-link", INSTAGRAM_URL)}
                    >
                      <i aria-hidden="true" className="fab fa-instagram" />
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
                    Commits on github <strong> {githubCommits}</strong>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
        <section
          className="section section-bg section-parallax section-parallax-1"
          id="about-section"
        >
          <div className="container">
            {/* Section Heading */}
            <div className="m-titles">
              <h2 className="m-title" id="tour-about">About Me</h2>
            </div>
            <div className="row row-custom">
              <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3 align-right">
                {/* Section numbers */}
                <div className="numbers-items">
                  <div className="numbers-item">
                    <div className="icon">
                      <i aria-hidden="true" className="far fa-gem" />
                    </div>
                    <div className="num">{companiesCount}</div>
                    <div className="title">
                      Companies <br />
                      Worked
                    </div>
                  </div>
                  <div className="numbers-item">
                    <div className="icon">
                      <i aria-hidden="true" className="far fa-check-circle" />
                    </div>
                    <div className="num">2</div>
                    <div className="title">
                      Total <br />
                      Degrees
                    </div>
                  </div>
                  <div className="numbers-item">
                    <div className="icon">
                      <i aria-hidden="true" className="far fa-smile" />
                    </div>
                    <div className="num">{yearsOfExperience}</div>
                    <div className="title">
                      Year of <br />
                      Experience
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
                {/* Section Profile */}
                <div className="profile-box">
                  <div className="text">
                    <p>
                      Hello, my name is Yuqi Guo, and I am currently a Software
                      Development Engineer in the Global Banking and Markets
                      division at <strong>Goldman Sachs</strong>, focusing on the
                      Margins team. My role involves designing and developing
                      robust backend systems to ensure accurate and efficient
                      margin calculations, leveraging technologies like Spring
                      Boot, REST APIs, and microservices.
                    </p>

                    <p>
                      I hold a Master's degree in Computer Science from Syracuse
                      University and a Bachelor's degree in Information and
                      Computing Science from the University of Liverpool. With a
                      strong foundation in backend development,{" "}
                      <strong>microservice architecture</strong>, and{" "}
                      <strong>system design</strong>, I have experience deploying
                      scalable solutions using tools like <em>Docker</em>,{" "}
                      <em>Kubernetes</em>, and <em>AWS</em>.
                    </p>

                    <p>
                      My professional journey includes projects such as building
                      microservices for scalable platforms, optimizing system
                      performance, and maintaining secure, high-availability
                      systems. I am passionate about solving complex problems,
                      improving system efficiencies, and contributing to
                      high-impact financial systems.
                    </p>

                    <a href="#contact-section" className="btn">
                      <span>Contact Me</span>
                    </a>
                    <div className="signature"></div>
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
              <h2 className="m-title" id="tour-background">My Background</h2>
            </div>
            <div className="row row-custom">
              <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3"></div>
              <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
                {/* History */}
                <div className="history-left">
                  <div className="history-items">
                    <div className="p-title">EDUCATION</div>
                    <div className="history-item">
                      <div className="date">2022 - 2024</div>
                      <div className="name">Syracuse University</div>
                      <div className="subname">
                        Master Of Science, Computer Science
                      </div>
                    </div>
                    <div className="history-item">
                      <div className="date">2017 - 2022</div>
                      <div className="name">University of Liverpool</div>
                      <div className="subname">
                        Bachelors of Science, Computer Science
                      </div>
                    </div>

                    <div className="history-item">
                      <div className="subname">
                        <br />
                        <strong>Relevant Courses: </strong> Data Structure,
                        Algorithm, Operating System, Database, Computer Network,
                        Human-Centric Interaction, Software Engineering, Mobile
                        Computing, Computer Graphics, Machine Learning
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
                          {experience.text.split("\n").map((para, index) => (
                            <p key={index}>{para}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="clear" />
                {/* Button CV */}
                <Link href="/cv">
                  <a className="btn">
                    <span>View CV</span>
                  </a>
                </Link>
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
              <h2 className="m-title" id="tour-projects">My Projects</h2>
            </div>

            <div className="text">
              <h4>
                A Collection of my sample projects I’ve developed. Feeling great while sharing here!
              </h4>
            </div>

            {/* Works */}
            <ProjectIsotop />
          </div>
        </section>

        <section id="Blog-section" className="section section-parallax section-parallax-5">
          <div className="container space-y-16">
            {/* My Technical Blogs */}
            <div className="m-titles">
              <h2 className="m-title" id="tour-techblogs">My Technical Blogs</h2>
            </div>

            <div className="blog-items">
              <Slider {...settings}>
                {blogs.map((blog) => (
                  <div key={blog.id} className="archive-item">
                    <div className="image">
                      <Link href={`/blog-single/${blog.id}`} legacyBehavior>
                        <a onClick={() => recordClick("blog-item", `/blog-single/${blog.id}`)}>
                          <img src={blog.image_url} alt={blog.title} />
                        </a>
                      </Link>
                    </div>

                    <div className="desc">
                      <div className="category">
                        {blog.category}
                        <br />
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
                            <a className="lnk">Read more</a>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </Slider>
            </div>

            <div className="blog-more-link">
              <Link href="/blogs?type=technical" legacyBehavior>
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
              <h2 className="m-title" id="tour-life">My Vibrant Life</h2>
            </div>

            <div className="row row-custom">
              <div className="col-xs-12 col-sm-12 col-md-3 col-lg-3" />
              <div className="col-xs-12 col-sm-12 col-md-9 col-lg-9 vertical-line">
                <div className="text">
                  <p>Study Hard. Work Smart. Build the Future!</p>
                </div>
              </div>
            </div>

            <div className="blog-items grid gap-16 lg:grid-cols-3">
              {lifeBlogs.slice(0, 3).map((blog) => {
                const {
                  id,
                  title,
                  image_url,
                  category,
                  published_at,
                  description,
                  require_login,
                } = blog;

                const nextHref = `/life-blog/${id}`;

                return (
                  <div key={id} className="archive-item">
                    <div className="image">
                      <Link href={nextHref} legacyBehavior>
                        <a onClick={(e) => handleProtectedClick(e, require_login, nextHref)}>
                          <img src={image_url} alt={title} />
                        </a>
                      </Link>
                    </div>

                    <div className="desc">
                      <div className="category">
                        {category}
                        <br />
                        <span>{published_at}</span>
                      </div>

                      <h3 className="title">
                        <Link href={nextHref} legacyBehavior>
                          <a onClick={(e) => handleProtectedClick(e, require_login, nextHref)}>
                            {title}
                            {require_login && " (login required)"}
                          </a>
                        </Link>
                      </h3>

                      <div className="text">
                        <p>{description}</p>

                        <div className="readmore">
                          <Link href={nextHref} legacyBehavior>
                            <a
                              className="lnk"
                              onClick={(e) => handleProtectedClick(e, require_login, nextHref)}
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
              <Link href="/blogs?type=life" legacyBehavior>
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
          
          {/* Border styling for blogs */}
          <style jsx global>{`
            /* ── Blog card base ── */
            #Blog-section .blog-items .archive-item,
            #Blog-section .blog-items.grid .archive-item {
              border: 1px solid rgba(0, 0, 0, 0.09);
              border-radius: 14px;
              overflow: hidden;
              background: #fff;
              box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
              transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
              position: relative;
            }

            /* Accent top bar on hover */
            #Blog-section .blog-items .archive-item::before,
            #Blog-section .blog-items.grid .archive-item::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              height: 3px;
              background: linear-gradient(90deg, #ff8059, #ff4d24);
              opacity: 0;
              transition: opacity 0.3s ease;
              z-index: 1;
            }

            #Blog-section .blog-items .archive-item:hover,
            #Blog-section .blog-items.grid .archive-item:hover {
              transform: translateY(-5px);
              box-shadow: 0 12px 36px rgba(0, 0, 0, 0.12);
              border-color: rgba(255, 128, 89, 0.35);
            }

            #Blog-section .blog-items .archive-item:hover::before,
            #Blog-section .blog-items.grid .archive-item:hover::before {
              opacity: 1;
            }

            /* Dark mode */
            body.dark-skin #Blog-section .blog-items .archive-item,
            body.dark-skin #Blog-section .blog-items.grid .archive-item {
              background: rgba(22, 28, 38, 0.92);
              border-color: rgba(255, 255, 255, 0.08);
              box-shadow: 0 2px 14px rgba(0, 0, 0, 0.28);
            }

            body.dark-skin #Blog-section .blog-items .archive-item:hover,
            body.dark-skin #Blog-section .blog-items.grid .archive-item:hover {
              box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
              border-color: rgba(255, 128, 89, 0.3);
            }
          `}</style>
        </section>

        <LogInDialog
          open={showLogin}
          title="Log In Required"
          onClose={() => setShowLogin(false)}
          onConfirm={handleLoginConfirm}
          onRegister={handleRegisterFromLogin}
        >
          You need to log in to read this post.
        </LogInDialog>

        {/* Toast UI */}
        {toast.visible && (
          <>
            <div
              className="simple-toast"
              data-closing={toast.closing ? "true" : "false"}
              role="status"
              aria-live="polite"
            >
              {toast.message}
            </div>
            <style jsx>{`
              .simple-toast {
                position: fixed;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                z-index: 5000;

                padding: 12px 16px;
                border-radius: 999px;
                background: rgba(15, 23, 42, 0.92);
                color: #f8fafc;
                font-size: 14px;
                letter-spacing: 0.01em;
                box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);

                opacity: 1;
                transition: opacity 200ms ease, transform 200ms ease;
              }

              .simple-toast[data-closing="true"] {
                opacity: 0;
                transform: translate(-50%, -50%) translateY(6px);
              }
            `}</style>
          </>
        )}

        <DashboardPanels />
          <ContactForm />
        <SiteTour />
      </Layout>
    </>
  );
};
export default Index;
