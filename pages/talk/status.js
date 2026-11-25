import Layout from "../../src/layout/Layout";
import SeoHead from "../../src/components/SeoHead";
import ReferralStatus from "../../src/components/talk/ReferralStatus";
import hub from "../../src/components/talk/Talk.module.css";
import styles from "../../styles/TalkPage.module.css";

// A static page: the request it shows is named by the token after "#" in the link, which the
// browser keeps to itself, so nothing about a request is ever in a URL, a log or a cache.
export default function ReferralStatusPage() {
  return (
    <Layout>
      <SeoHead title="Your referral request" description="Follow a referral request you sent to Yuqi Guo." url="/talk/status" noindex />
      <section className={`section ${styles.page}`}>
        <div className="container">
          <div className={styles.inner}>
            <h1 className={styles.title}>Your referral request</h1>
            <p className={styles.lead}>Where your request stands. This page changes as it moves along.</p>
            <div className={hub.root}><ReferralStatus /></div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
