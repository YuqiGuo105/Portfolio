import SitePolicyPage from '../src/components/SitePolicyPage';

export default function PrivacyPage() {
  return (
    <SitePolicyPage
      title="Privacy"
      description="How Yuqi Guo's portfolio collects, uses, and protects visitor and account information."
      path="/privacy"
    >
      <p>This policy describes information processed when you browse yuqi.site, use its interactive features, subscribe to updates, or sign in to a protected account.</p>

      <h2>Information collected</h2>
      <ul>
        <li><strong>Usage and diagnostics:</strong> page views, interaction events, read progress, referrer, device and browser characteristics, approximate location, session identifiers, and service errors.</li>
        <li><strong>Information you provide:</strong> contact details, comments, subscription preferences, account information, prompts, and files you intentionally submit to a feature.</li>
        <li><strong>Security records:</strong> authentication, authorization, audit, and abuse-prevention events for protected services.</li>
      </ul>

      <h2>How information is used</h2>
      <p>Information is used to operate and secure the site, understand aggregate engagement, improve content and reliability, answer requested AI interactions, deliver subscribed notifications, and troubleshoot failures. Personal information is not sold or used for third-party advertising.</p>

      <h2>Service providers</h2>
      <p>Limited information may be processed by infrastructure, authentication, database, analytics, email, search, and AI providers that support the requested feature. Access is limited to the purpose of operating the service and subject to provider safeguards.</p>

      <h2>Retention and security</h2>
      <p>Records are retained only as long as reasonably needed for their stated purpose, security, audit, and legal obligations. The platform uses access controls, encrypted transport, protected administrative routes, and least-privilege service authorization. No internet service can guarantee absolute security.</p>

      <h2>Your choices</h2>
      <p>You may avoid optional interactive features, unsubscribe through an email link, adjust browser storage controls, or request access, correction, or deletion where applicable.</p>

      <h2>Contact</h2>
      <p>Privacy questions or data requests may be sent to <a href="mailto:yuqi.guo17@gmail.com">yuqi.guo17@gmail.com</a>.</p>
    </SitePolicyPage>
  );
}
