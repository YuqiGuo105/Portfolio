import Link from "next/link";
import SeoHead from "../../src/components/SeoHead";
import styles from "../../styles/ApplicationCopilotPrivacy.module.css";

export default function ApplicationCopilotPrivacyPage() {
  return (
    <>
      <SeoHead
        title="Application Copilot Privacy Policy"
        description="Privacy policy for the Yuqi Application Copilot Chrome extension."
        url="/application-copilot/privacy"
        noindex
      />
      <main className={styles.page}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">YUQI.SITE</Link>
          <span className={styles.eyebrow}>APPLICATION COPILOT</span>
          <h1>Privacy Policy</h1>
          <p>Effective September 3, 2026</p>
        </header>

        <article className={styles.policy}>
          <p>Yuqi Application Copilot is an assisted job-application tool. It processes only the information needed to scan a user-selected form, resolve approved answers, attach a resume, and fill the fields the user chooses. It does not submit applications on the user&apos;s behalf.</p>

          <h2>Information processed</h2>
          <ul>
            <li><strong>Application page content:</strong> visible labels, choices, control types, page title, and canonical HTTPS origin and path.</li>
            <li><strong>Profile information:</strong> user-approved contact, location, education, experience, skills, work authorization, demographic answers, and recurring application answers.</li>
            <li><strong>Resume files:</strong> the active private Resume Vault PDF or a one-time local PDF selected by the user.</li>
            <li><strong>Authentication information:</strong> a short-lived yuqi.site access token retained in Chrome session storage.</li>
            <li><strong>Operational information:</strong> workflow identifiers, resolution status, integrity metadata, and errors required to complete or troubleshoot the requested action.</li>
          </ul>
          <p>The extension does not intentionally collect full browsing history, page screenshots, payment information, personal communications, or information from tabs the user has not selected for application assistance.</p>

          <h2>How information is used</h2>
          <p>Information is used only to identify fields on the selected application page, retrieve approved profile and resume data, resolve potential answers, fill user-approved fields, and maintain an auditable application workflow. Data is not sold, used for advertising, transferred to data brokers, or used for unrelated eligibility, lending, or credit decisions.</p>

          <h2>Storage and retention</h2>
          <p>The access token is kept in <code>chrome.storage.session</code> and cleared when the browser session ends. A bounded local cache may retain sanitized field classifications; it excludes passwords, resume files, immigration answers, and full page content. Private profile data and resume metadata are encrypted at rest by the authenticated yuqi.site Career service. Resume downloads use short-lived signed URLs and integrity verification.</p>

          <h2>Data sharing</h2>
          <p>The minimum required field metadata is sent to first-party yuqi.site MCP and Career services. Unfamiliar non-sensitive labels may be classified by a local Codex process or by the configured first-party model service when local classification is unavailable. Credentials, sensitive answers, resume files, and full page bodies are excluded from model prompts. Application information reaches a job application site only when the user chooses to fill that site&apos;s form.</p>

          <h2>Security and user control</h2>
          <p>Network requests use HTTPS. The MCP gateway enforces authentication and authorization, privileged operations are confirmation-gated, and security-relevant actions are audited. Users can review every resolved value, leave fields blank, use a local resume, sign out, or request deletion. CAPTCHA, MFA, legal terms, attestations, signatures, and final submission always remain manual.</p>

          <h2>Chrome Web Store Limited Use</h2>
          <p>Use of information received through Chrome APIs follows the Chrome Web Store User Data Policy, including its Limited Use requirements. Data is used only to provide or improve the extension&apos;s prominent application-assistance feature.</p>

          <h2>Contact</h2>
          <p>Questions or deletion requests may be sent to <a href="mailto:yuqi.guo17@gmail.com">yuqi.guo17@gmail.com</a>.</p>
        </article>
      </main>
    </>
  );
}
