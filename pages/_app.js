import Head from "next/head";
import { Fragment, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import SeoHead from "../src/components/SeoHead";
import { startPageBehaviorTracking } from "../src/lib/behaviorAnalytics";
import "../styles/globals.css";
import "../styles/carousel.css";
import "../styles/chatWidget.css";

const SITE_URL = "https://www.yuqi.site";
const SITE_PROFILE_JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: SITE_URL,
    mainEntity: {
      "@id": `${SITE_URL}/#person`,
      "@type": "Person",
      name: "Yuqi Guo",
      alternateName: "郭育奇",
      identifier: "yuqi-guo",
      url: SITE_URL,
      image: `${SITE_URL}/assets/images/profile_guyuqi.jpg`,
      jobTitle: "Software Engineer",
      description:
        "Software engineer specializing in backend systems, distributed platforms, and AI infrastructure.",
      sameAs: [
        "https://github.com/YuqiGuo105",
        "https://www.linkedin.com/in/y-guo-6080733a5/",
      ],
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: SITE_URL,
    name: "Yuqi Guo's Portfolio",
    author: { "@id": `${SITE_URL}/#person` },
    about: { "@id": `${SITE_URL}/#person` },
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/blogs?tag={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  },
];

function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const cleanupTracking = useRef(null);

  // One tracker owns page views, engagement time and reading milestones.
  useEffect(() => {
    const track = (url) => {
      cleanupTracking.current?.();
      cleanupTracking.current = startPageBehaviorTracking(url);
    };

    track(window.location.pathname);

    // Subsequent client-side navigations
    const handleRouteChange = (url) => track(url);
    router.events.on("routeChangeComplete", handleRouteChange);
    return () => {
      router.events.off("routeChangeComplete", handleRouteChange);
      cleanupTracking.current?.();
      cleanupTracking.current = null;
    };
  }, [router.events]);

  return (
    <Fragment>
      <Head>
        <title>Yuqi Guo Portfolio</title>
        <meta
          name="description"
          content="Portfolio and blog of Yuqi Guo, featuring distributed systems, backend engineering, AI infrastructure, projects, and technical writing."
        />
        <meta
          name="keywords"
          content="Yuqi Guo, 郭育奇, software engineer, backend engineer, distributed systems, AI platform, portfolio"
        />
        <meta name="author" content="Yuqi Guo (郭育奇)" />
        {SITE_PROFILE_JSON_LD.map((entry) => (
          <script
            key={entry["@type"]}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
          />
        ))}
        {/* <!-- Fonts --> */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css?family=Rubik%3A300%2C300i%2C400%2C400i%2C500%2C500i%2C600%2C600i%2C700%2C700i%2C800%2C800i%2C900%2C900i%7CSorts+Mill+Goudy&#038;display=swap"
          type="text/css"
          media="all"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css?family=Roboto%3A100%2C100italic%2C200%2C200italic%2C300%2C300italic%2C400%2C400italic%2C500%2C500italic%2C600%2C600italic%2C700%2C700italic%2C800%2C800italic%2C900%2C900italic%7CRoboto+Slab%3A100%2C100italic%2C200%2C200italic%2C300%2C300italic%2C400%2C400italic%2C500%2C500italic%2C600%2C600italic%2C700%2C700italic%2C800%2C800italic%2C900%2C900italic&#038;display=auto"
          type="text/css"
          media="all"
        />

        {/* <!-- CSS STYLES --> */}
        <link
          rel="stylesheet"
          href="/assets/css/vendors/bootstrap.css"
          type="text/css"
          media="all"
        />
        <link
          rel="stylesheet"
          href="/assets/fonts/font-awesome/css/font-awesome.css"
          type="text/css"
          media="all"
        />
        <link
          rel="stylesheet"
          href="/assets/css/vendors/magnific-popup.css"
          type="text/css"
          media="all"
        />
        <link
          rel="stylesheet"
          href="/assets/css/vendors/splitting.css"
          type="text/css"
          media="all"
        />
        <link
          rel="stylesheet"
          href="/assets/css/vendors/swiper.css"
          type="text/css"
          media="all"
        />
        <link
          rel="stylesheet"
          href="/assets/css/vendors/animate.css"
          type="text/css"
          media="all"
        />
        <link
          rel="stylesheet"
          href="/assets/css/main.css"
          type="text/css"
          media="all"
        />

        {/* <!-- Favicon --> */}
        <link rel="shortcut icon" href="/favicon.ico" type="image/x-icon" />
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
      </Head>
      {!Component.hasCustomSeo && <SeoHead />}
      <Component {...pageProps} />{" "}
    </Fragment>
  );
}

export default MyApp;
