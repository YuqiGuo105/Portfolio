import { Fragment, useEffect, useState } from "react";
import {
  animation,
  initCursor,
  parallax,
  splittingText,
  stickyNav,
} from "../utils";
import Footer from "./Footer";
import Header from "./Header";
import PreLoader from "./PreLoader";
import dynamic from "next/dynamic";
import SearchOverlay from "../components/SearchOverlay";

const ChatWidget = dynamic(() => import("../../src/components/ChatWidget"), {
  ssr: false,
});

const Layout = ({ children, extraWrapClass }) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  useEffect(() => {
    initCursor();
    animation();
    window.addEventListener("scroll", stickyNav);
  }, []);

  useEffect(() => {
    setTimeout(() => {
      const srollAnimation = document.querySelectorAll(".scroll-animate");
      srollAnimation.forEach((element) => {
        const elementHeight = element.offsetHeight;
        const width = window.scrollY;
        element.classList.add("animate__active", "animate__animated");
      });
    }, 500);
  }, []);

  useEffect(() => {
    splittingText();
    parallax();
  }, []);

  return (
    <Fragment>
      <div className="container-page ">
        {/* Preloader */}
        <PreLoader />
        {/* Header */}
        <Header onOpenSearch={() => setIsSearchOpen(true)} />
        {/* Wrapper */}
        <div className={`wrapper ${extraWrapClass}`}>{children}</div>
        {/* Footer */}
        <Footer />
      </div>
      <ChatWidget />
      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
      <div className="cursor"></div>
    </Fragment>
  );
};
export default Layout;
