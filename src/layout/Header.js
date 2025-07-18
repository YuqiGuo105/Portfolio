import Link from "next/link";
import { useEffect, useState } from "react";

const Header = () => {

  const openMenu = event => {
    event.preventDefault();
    const menu = document.querySelector(".menu-btn");
    if (menu.classList.contains("active")) {
      menu.classList.remove("active");
      menu.classList.add("no-touch");
      document.body.classList.remove("no-scroll");
      document
        .querySelector(".menu-full-overlay")
        .classList.remove("is-open");
      document
        .querySelector(".menu-full-overlay")
        .classList.remove("has-scroll");
      document
        .querySelector(".menu-full-overlay")
        .classList.remove("animate-active");
      setTimeout(function () {
        document
          .querySelector(".menu-full-overlay")
          .classList.remove("visible");
        menu.classList.remove("no-touch");
      }, 1000);
    } else {
      menu.classList.add("active", "no-touch");
      // var height = document.querySelector(window).height();
      // document.querySelector(".menu-full-overlay").css({ height: height });
      document.body.classList.add("no-scroll");
      document
        .querySelector(".menu-full-overlay")
        .classList.add("is-open", "visible");
      setTimeout(function () {
        document
          .querySelector(".menu-full-overlay")
          .classList.add("has-scroll", "animate-active");
        menu.classList.remove("no-touch");
      }, 1000);
    }
  };

  const [day, setDay] = useState(true);

  useEffect(() => {
    const mood = localStorage.getItem("ober-mood");
    if (mood) {
      setDay(mood === "day");
    } else {
      localStorage.setItem("ober-mood", "day");
    }
  }, []);

  useEffect(() => {
    if (day) {
      localStorage.setItem("ober-mood", "day");
      document.querySelector("body").classList.add("home", "page", "light-skin");
      document.querySelector("body").classList.remove("dark-skin");
    } else {
      localStorage.setItem("ober-mood", "night");
      document.querySelector("body").classList.remove("home", "page", "light-skin");
      document.querySelector("body").classList.add("dark-skin");
    }
  }, [day]);

  const [pageToggle, setPageToggle] = useState(false);

  const linkClick = () => {
    const menu = document.querySelector(".menu-btn");
    if (menu.classList.contains("active")) {
      menu.classList.remove("active");
      menu.classList.add("no-touch");
      document.body.classList.remove("no-scroll");
      document.querySelector(".menu-full-overlay").classList.remove("is-open");
      document
        .querySelector(".menu-full-overlay")
        .classList.remove("has-scroll");
      document
        .querySelector(".menu-full-overlay")
        .classList.remove("animate-active");
      setTimeout(function () {
        document
          .querySelector(".menu-full-overlay")
          .classList.remove("visible");
        menu.classList.remove("no-touch");
      }, 1000);
    } else {
      menu.classList.add("active", "no-touch");
      // var height = document.querySelector(window).height();
      // document.querySelector(".menu-full-overlay").css({ height: height });
      document.body.classList.add("no-scroll");
      document
        .querySelector(".menu-full-overlay")
        .classList.add("is-open", "visible");
      setTimeout(function () {
        document
          .querySelector(".menu-full-overlay")
          .classList.add("has-scroll", "animate-active");
        menu.classList.remove("no-touch");
      }, 1000);
    }
  };

  return (
    <header className="header">
      <div className="header__builder">
        <div className="row">
          <div className="col-xs-4 col-sm-4 col-md-4 col-lg-4">
            {/* logo */}
            <div className="logo">
              <Link href="/">
                <a>
                  <img src="https://iyvhmpdfrnznxgyvvkvx.supabase.co/storage/v1/object/public/Page/YuqiLogo.png" alt="" />
                </a>
              </Link>
            </div>
          </div>
          <div className="col-xs-8 col-sm-8 col-md-8 col-lg-8 align-right">
            {/* switcher btn */}
            <a
              className={`switcher-btn ${day ? "active" : ""}`}
              onClick={() => setDay(!day)}
            >
              <span className="sw-before">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22.22"
                  height="22.313"
                  viewBox="0 0 22.22 22.313"
                >
                  <path
                    fill="#fff"
                    d="M1752.49,105.511a5.589,5.589,0,0,0-3.94-1.655,5.466,5.466,0,0,0-3.94,1.655,5.61,5.61,0,0,0,3.94,9.566,5.473,5.473,0,0,0,3.94-1.653,5.643,5.643,0,0,0,1.65-3.957A5.516,5.516,0,0,0,1752.49,105.511Zm-1.06,6.85a4.1,4.1,0,0,1-5.76,0,4.164,4.164,0,0,1,0-5.788A4.083,4.083,0,0,1,1751.43,112.361Zm7.47-3.662h-2.27a0.768,0.768,0,0,0,0,1.536h2.27A0.768,0.768,0,0,0,1758.9,108.7Zm-10.35,8.12a0.777,0.777,0,0,0-.76.769v2.274a0.777,0.777,0,0,0,.76.767,0.786,0.786,0,0,0,.77-0.767v-2.274A0.786,0.786,0,0,0,1748.55,116.819Zm7.85-.531-1.62-1.624a0.745,0.745,0,0,0-1.06,0,0.758,0.758,0,0,0,0,1.063l1.62,1.625a0.747,0.747,0,0,0,1.06,0A0.759,0.759,0,0,0,1756.4,116.288ZM1748.55,98.3a0.777,0.777,0,0,0-.76.768v2.273a0.778,0.778,0,0,0,.76.768,0.787,0.787,0,0,0,.77-0.768V99.073A0.786,0.786,0,0,0,1748.55,98.3Zm7.88,3.278a0.744,0.744,0,0,0-1.06,0l-1.62,1.624a0.758,0.758,0,0,0,0,1.063,0.745,0.745,0,0,0,1.06,0l1.62-1.624A0.758,0.758,0,0,0,1756.43,101.583Zm-15.96,7.116h-2.26a0.78,0.78,0,0,0-.77.768,0.76,0.76,0,0,0,.77.768h2.26A0.768,0.768,0,0,0,1740.47,108.7Zm2.88,5.965a0.745,0.745,0,0,0-1.06,0l-1.62,1.624a0.759,0.759,0,0,0,0,1.064,0.747,0.747,0,0,0,1.06,0l1.62-1.625A0.758,0.758,0,0,0,1743.35,114.664Zm0-11.457-1.62-1.624a0.744,0.744,0,0,0-1.06,0,0.758,0.758,0,0,0,0,1.063l1.62,1.624a0.745,0.745,0,0,0,1.06,0A0.758,0.758,0,0,0,1743.35,103.207Z"
                    transform="translate(-1737.44 -98.313)"
                  />
                </svg>
              </span>
              <span className="sw-after">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={23}
                  height={23}
                  viewBox="0 0 23 23"
                >
                  <path
                    fill="#fff"
                    d="M1759.46,111.076a0.819,0.819,0,0,0-.68.147,8.553,8.553,0,0,1-2.62,1.537,8.167,8.167,0,0,1-2.96.531,8.655,8.655,0,0,1-8.65-8.682,9.247,9.247,0,0,1,.47-2.864,8.038,8.038,0,0,1,1.42-2.54,0.764,0.764,0,0,0-.12-1.063,0.813,0.813,0,0,0-.68-0.148,11.856,11.856,0,0,0-6.23,4.193,11.724,11.724,0,0,0,1,15.387,11.63,11.63,0,0,0,19.55-5.553A0.707,0.707,0,0,0,1759.46,111.076Zm-4.5,6.172a10.137,10.137,0,0,1-14.29-14.145,10.245,10.245,0,0,1,3.38-2.836c-0.14.327-.29,0.651-0.41,1.006a9.908,9.908,0,0,0-.56,3.365,10.162,10.162,0,0,0,10.15,10.189,9.776,9.776,0,0,0,3.49-.62,11.659,11.659,0,0,0,1.12-.473A10.858,10.858,0,0,1,1754.96,117.248Z"
                    transform="translate(-1737 -98)"
                  />
                </svg>
              </span>
            </a>
            {/* menu btn */}
            <a
            href="#"
            className="menu-btn"
            onClick={() => openMenu(event)}
            >
              <span />
            </a>
          </div>
        </div>
      </div>
      {/* Menu Full Overlay */}
      <div className="menu-full-overlay" style={{ minHeight: "100vh" }}>
        <div className="menu-full-container">
          <div className="container">
            <div className="row">
              <div className="col-xs-12 col-sm-12 col-md-12 col-lg-10 offset-1">
                {/* menu full */}
                <div className="menu-full">
                  <ul className="menu-full">
                    <li className="menu-item">
                      <a
                          href="/#about-section"
                          onClick={() => linkClick()}
                      >
                        About
                      </a>
                    </li>
                    <li className="menu-item">
                      <a
                          href="/#resume-section"
                          onClick={() => linkClick()}
                      >
                        Resume
                      </a>
                    </li>
                    <li className="menu-item">
                      <a
                          href="/#works-section"
                          onClick={() => linkClick()}
                      >
                        Works
                      </a>
                    </li>

                    <li className="menu-item">
                      <a
                          href="/#Blog-section"
                          onClick={() => linkClick()}
                      >
                        Blog
                      </a>
                    </li>

                    <li className="menu-item">
                      <a
                          href="/#contact-section"
                          onClick={() => linkClick()}
                      >
                        Contact
                      </a>
                    </li>
                    <li className="menu-item menu-item-has-children has-children">
                      <a
                          className="position-relative"
                          onClick={() => setPageToggle(!pageToggle)}
                      >
                      </a>
                      <ul
                          className="sub-menu"
                          style={{
                            marginTop: "1rem",
                            display: `${pageToggle ? "block" : "none"}`,
                          }}
                      >
                        <li className="menu-item">
                          <Link href="/works">
                            <a
                                onClick={() => linkClick()}
                            >
                              Works (grid)
                            </a>
                          </Link>
                        </li>
                        <li className="menu-item">
                          <Link href="/works-list">
                            <a
                                onClick={() => linkClick()}
                            >
                              Works (list)
                            </a>
                          </Link>
                        </li>
                        <li className="menu-item">
                          <Link href="/work-single">
                            <a
                                onClick={() => linkClick()}
                            >
                              Work Single Page
                            </a>
                          </Link>
                        </li>
                        <li className="menu-item">
                          <Link href="/blog">
                            <a
                                onClick={() => linkClick()}
                            >
                              Blog Posts
                            </a>
                          </Link>
                        </li>
                        <li className="menu-item">
                          <Link href="/blog-single">
                            <a
                                onClick={() => linkClick()}
                            >
                              Blog Single Post
                            </a>
                          </Link>
                        </li>
                      </ul>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* social */}
        <div className="menu-social-links">
          <a
            href="https://github.com/YuqiGuo105"
            target="blank"
            title="twitter"
          >
            <i className="fab fa-github" />
          </a>
          <a
            href="https://www.instagram.com/yuqi_guo17/"
            target="blank"
            title="behance"
          >
            <i className="fab fa-instagram" />
          </a>
        </div>
      </div>
    </header>
  );
};
export default Header;
