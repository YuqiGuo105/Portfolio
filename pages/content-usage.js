import SitePolicyPage from '../src/components/SitePolicyPage';
import styles from '../styles/SitePolicy.module.css';

const LICENSE_URL = 'https://github.com/YuqiGuo105/Portfolio/blob/main/LICENSE';

export default function ContentUsagePage() {
  return (
    <SitePolicyPage
      title="Content Usage"
      description="Copyright and permitted-use terms for original content published on Yuqi Guo's portfolio."
      path="/content-usage"
    >
      <p>
        Original articles, photography, illustrations, interface design, and other editorial material
        published on this site are protected by copyright unless a different owner or license is stated.
        Website content and open-source code are licensed separately.
      </p>

      <h2>Permitted use</h2>
      <p>You may link to public pages and quote brief excerpts for commentary, education, or reference when you provide clear attribution to Yuqi Guo and a link to the original page.</p>

      <h2>Permission required</h2>
      <p>Written permission is required to republish a complete article or a substantial portion of it, redistribute original photography or design assets, remove attribution, or use site content commercially.</p>

      <h2>Open-source software</h2>
      <p>
        Source code is governed by the license included in each repository. For this portfolio, refer to
        the repository&apos;s <a href={LICENSE_URL} target="_blank" rel="noreferrer">MIT License</a>.
        A repository without an explicit license does not grant permission to copy, modify, or distribute its code.
      </p>

      <h2>Third-party material</h2>
      <p>Product names, trademarks, quoted material, and third-party assets remain the property of their respective owners and are subject to their own terms.</p>

      <p className={styles.callout}>
        For republication, commercial-use, or licensing requests, contact <a href="mailto:yuqi.guo17@gmail.com">yuqi.guo17@gmail.com</a>.
      </p>
    </SitePolicyPage>
  );
}
