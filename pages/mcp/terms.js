import Link from "next/link";
import SeoHead from "../../src/components/SeoHead";
import styles from "../../styles/ApplicationCopilotPrivacy.module.css";

export default function PortfolioMcpTermsPage() {
  return (
    <>
      <SeoHead
        title="Yuqi Portfolio MCP Terms of Use"
        description="Terms of use for the public Yuqi Portfolio MCP plugin."
        url="/mcp/terms"
        noindex
      />
      <main className={styles.page}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">YUQI.SITE</Link>
          <span className={styles.eyebrow}>YUQI PORTFOLIO MCP</span>
          <h1>Terms of Use</h1>
          <p>Effective September 4, 2026</p>
        </header>

        <article className={styles.policy}>
          <p>These terms govern use of the public Yuqi Portfolio MCP plugin. By using the plugin, you agree to use it lawfully and only for retrieving the public portfolio information it provides.</p>

          <h2>Service scope</h2>
          <p>The plugin offers read-only access to selected public projects, articles, architecture material, and professional profile information. It does not provide administrator access or permission to modify yuqi.site.</p>

          <h2>Acceptable use</h2>
          <p>Do not attempt to bypass access controls, extract private information, disrupt the service, misrepresent returned content, or use the plugin in violation of applicable law or third-party rights.</p>

          <h2>Content and attribution</h2>
          <p>Portfolio content remains owned by its respective author or rights holder. Canonical yuqi.site links should be retained when quoting or referencing returned material. Third-party names and marks remain the property of their owners.</p>

          <h2>Availability and disclaimer</h2>
          <p>The plugin is provided as available for informational use. Content and availability may change, and no guarantee is made that every response is complete, current, or suitable for a particular decision. Verify important claims using the canonical source links.</p>

          <h2>Changes and termination</h2>
          <p>Access may be limited or discontinued to protect the service or address misuse. These terms may be updated when the plugin or its operating requirements change.</p>

          <h2>Contact</h2>
          <p>Questions about these terms may be sent to <a href="mailto:yuqi.guo17@gmail.com">yuqi.guo17@gmail.com</a>.</p>
        </article>
      </main>
    </>
  );
}
