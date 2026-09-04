import Link from "next/link";
import SeoHead from "../../src/components/SeoHead";
import styles from "../../styles/ApplicationCopilotPrivacy.module.css";

export default function PortfolioMcpPrivacyPage() {
  return (
    <>
      <SeoHead
        title="Yuqi Portfolio MCP Privacy Policy"
        description="Privacy policy for the public Yuqi Portfolio MCP plugin."
        url="/mcp/privacy"
        noindex
      />
      <main className={styles.page}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">YUQI.SITE</Link>
          <span className={styles.eyebrow}>YUQI PORTFOLIO MCP</span>
          <h1>Privacy Policy</h1>
          <p>Effective September 4, 2026</p>
        </header>

        <article className={styles.policy}>
          <p>Yuqi Portfolio MCP is a public, read-only plugin that helps AI clients retrieve published portfolio projects, technical articles, architecture material, and professional profile information from yuqi.site.</p>

          <h2>Information processed</h2>
          <p>The plugin processes the tool name and search parameters supplied by the user or AI client. The service may also process ordinary technical request information, such as timestamps, response status, latency, and security diagnostics, to operate and protect the service.</p>

          <h2>How information is used</h2>
          <p>Requests are used only to find and return relevant public portfolio content, maintain service reliability, prevent abuse, and diagnose failures. The public plugin does not require a user account and does not expose private admin, visitor, subscriber, notification, application, or audit data.</p>

          <h2>Storage and sharing</h2>
          <p>Published portfolio content remains stored by yuqi.site. Infrastructure providers may temporarily process bounded operational logs as needed to host and secure the service. Request data is not sold, used for advertising, or provided to data brokers.</p>

          <h2>User choices</h2>
          <p>Users can stop using or uninstall the plugin at any time. Because the plugin is read-only, it cannot publish, edit, delete, email, subscribe, or submit content on a user&apos;s behalf.</p>

          <h2>Contact</h2>
          <p>Privacy questions may be sent to <a href="mailto:yuqi.guo17@gmail.com">yuqi.guo17@gmail.com</a>.</p>
        </article>
      </main>
    </>
  );
}
