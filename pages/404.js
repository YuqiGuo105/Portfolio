import Link from "next/link";
import { useEffect, useState } from "react";
import SeoHead from "../src/components/SeoHead";
import Layout from "../src/layout/Layout";

const DESTINATIONS = [
  { href: "/", label: "Home", detail: "Profile, experience and live dashboards" },
  { href: "/works-list", label: "Projects", detail: "Distributed systems and AI platforms" },
  { href: "/blogs", label: "Blog", detail: "Engineering write-ups and notes" },
  { href: "/architecture", label: "System design", detail: "System overview, data flows and topology" },
];

export default function NotFoundPage() {
  // The 404 page is statically rendered, so the requested path is read on the client.
  const [path, setPath] = useState("");
  useEffect(() => {
    setPath(window.location.pathname);
  }, []);

  return (
    <Layout>
      <SeoHead title="Page not found" description="The requested page does not exist on yuqi.site." noindex />
      <section className="section section-inner not-found">
        <div className="container">
          <p className="not-found-eyebrow">HTTP 404 · ROUTE NOT FOUND</p>
          <h1 className="not-found-title">This page isn&apos;t served here.</h1>
          <p className="not-found-text">
            No route on yuqi.site matches this address. It may have moved when the portfolio was reorganized.
          </p>
          <div className="not-found-trace" role="note" aria-label="Request summary">
            <div className="trace-line">
              <span className="method">GET</span> {path || "/…"}
            </div>
            <div className="trace-line">
              <span className="arrow">→</span> edge router: no matching page
            </div>
            <div className="trace-line">
              <span className="arrow">→</span> <span className="status">404 Not Found</span>
            </div>
          </div>
          <nav className="not-found-links" aria-label="Suggested pages">
            {DESTINATIONS.map((item) => (
              <Link key={item.href} href={item.href}>
                <a className="not-found-link">
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </a>
              </Link>
            ))}
          </nav>
        </div>
      </section>
      <style jsx>{`
        .not-found {
          padding-top: 200px;
          padding-bottom: 120px;
        }
        .not-found-eyebrow {
          margin: 0 0 14px;
          font: 700 13px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
          letter-spacing: 0.12em;
          color: #ff8059;
        }
        .not-found-title {
          margin: 0;
          font-family: "Sorts Mill Goudy", serif;
          font-size: clamp(40px, 7vw, 84px);
          font-weight: 400;
          line-height: 1.05;
        }
        .not-found-text {
          max-width: 620px;
          margin: 20px 0 28px;
          font-size: 18px;
          line-height: 1.6;
          opacity: 0.8;
        }
        .not-found-trace {
          max-width: 620px;
          margin: 0 0 36px;
          padding: 16px 18px;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.55);
          color: #e2e8f0;
          font: 500 14px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace;
          font-style: normal;
        }
        .trace-line {
          overflow-wrap: anywhere;
        }
        .method {
          color: #67e8f9;
          font-weight: 700;
        }
        .arrow {
          color: #94a3b8;
        }
        .status {
          color: #fb7185;
          font-weight: 700;
        }
        .not-found-links {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
          max-width: 920px;
        }
        .not-found-link {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 16px 18px;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          color: inherit;
          text-decoration: none;
          transition: border-color 160ms ease, transform 160ms ease;
        }
        .not-found-link:hover,
        .not-found-link:focus-visible {
          border-color: #ff8059;
          transform: translateY(-2px);
        }
        .not-found-link strong {
          font-size: 17px;
        }
        .not-found-link span {
          font-size: 14px;
          opacity: 0.7;
        }
        :global(body.light-skin) .not-found-trace {
          background: #1e293b;
        }
        @media (max-width: 767px) {
          .not-found {
            padding-top: 140px;
            padding-bottom: 80px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .not-found-link {
            transition: none;
          }
        }
      `}</style>
    </Layout>
  );
}

NotFoundPage.hasCustomSeo = true;
