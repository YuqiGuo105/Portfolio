import {
  CheckCircle2,
  ExternalLink,
  LockKeyhole,
  PlugZap,
  Search,
  TerminalSquare,
} from "lucide-react";
import Link from "next/link";
import SeoHead from "../src/components/SeoHead";
import styles from "../styles/ProductDocs.module.css";

const CODEX_COMMANDS = `codex mcp add yuqi-portfolio --url https://www.yuqi.site/mcp
codex mcp list`;

export default function McpGuidePage() {
  return (
    <>
      <SeoHead
        title="Yuqi Portfolio MCP"
        description="Connect Yuqi Portfolio MCP to Codex and other AI clients for grounded access to projects, articles, architecture, experience, and public profile data."
        url="/mcp-guide"
      />
      <main className={styles.page}>
        <header className={styles.hero}>
          <Link className={styles.brand} href="/">
            YUQI.SITE
          </Link>
          <span className={styles.eyebrow}>
            <PlugZap size={15} /> MODEL CONTEXT PROTOCOL
          </span>
          <h1>Connect Yuqi Portfolio MCP</h1>
          <p>
            Give Codex, Claude, Gemini, Cursor, or another compatible AI client
            structured access to projects, technical writing, architecture,
            experience, and public profile evidence.
          </p>
          <div className={styles.endpoint}>
            <span>PUBLIC ENDPOINT</span>
            <code>https://www.yuqi.site/mcp</code>
          </div>
        </header>

        <section className={styles.band}>
          <div className={styles.inner}>
            <div className={styles.sectionHeading}>
              <span>CODEX</span>
              <h2>Connect in two commands</h2>
            </div>
            <pre className={styles.code}>
              <code>{CODEX_COMMANDS}</code>
            </pre>
            <p className={styles.note}>
              Restart or reopen Codex after installation. The public endpoint
              requires no API key.
            </p>
          </div>
        </section>

        <section className={styles.inner}>
          <div className={styles.sectionHeading}>
            <span>CAPABILITIES</span>
            <h2>Grounded, typed, read-only tools</h2>
          </div>
          <div className={styles.featureGrid}>
            <div>
              <Search size={18} />
              <strong>Unified search</strong>
              <p>Search projects, articles, life writing, and experience.</p>
            </div>
            <div>
              <CheckCircle2 size={18} />
              <strong>Project evidence</strong>
              <p>Retrieve systems by technology, pattern, or engineering problem.</p>
            </div>
            <div>
              <CheckCircle2 size={18} />
              <strong>Architecture</strong>
              <p>Inspect authored diagrams, decisions, and service boundaries.</p>
            </div>
            <div>
              <LockKeyhole size={18} />
              <strong>Public boundary</strong>
              <p>Private operations, analytics, audit data, and identifiers stay excluded.</p>
            </div>
          </div>
        </section>

        <section className={styles.band}>
          <div className={styles.inner}>
            <div className={styles.sectionHeading}>
              <span>OTHER CLIENTS</span>
              <h2>One endpoint, multiple AI platforms</h2>
            </div>
            <p className={styles.bodyCopy}>
              Add the Streamable HTTP endpoint as a remote MCP server in any
              compatible client. Tool discovery is automatic, and every public
              operation is sanitized and non-destructive.
            </p>
            <div className={styles.actions}>
              <a
                href="https://github.com/YuqiGuo105/portfolio-mcp-server/blob/main/docs/CLIENT_INTEGRATIONS.md"
                target="_blank"
                rel="noreferrer"
              >
                <TerminalSquare size={17} /> Client setup details
                <ExternalLink size={15} />
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
