import Layout from "../src/layout/Layout";
import SeoHead from "../src/components/SeoHead";
import TalkHub from "../src/components/talk/TalkHub";
import styles from "../styles/TalkPage.module.css";

// The referral form at its own address, so a link sent to someone previews as what it is.
// The preview names no company: it says "Ask for a referral" and nothing else.
// Same static page as /talk in every other respect: the company comes from the work history
// when the page is generated, and the page is regenerated in the background.
export async function getStaticProps() {
  const { referralRuntime } = await import("../src/lib/referral/runtime.mjs");
  const { publicAvailability } = await import("../src/lib/referral/availability.mjs");
  const state = await referralRuntime().availability.get();
  return { props: { referral: publicAvailability(state) }, revalidate: state.known ? 300 : 30 };
}

export default function ReferralPage({ referral }) {
  return (
    <Layout>
      <SeoHead
        title="Ask for a referral"
        description="Ask Yuqi Guo for a referral. Every request is evaluated by his own AI screening system, and you can follow yours on a status page."
        url="/referral"
      />
      <section className={`section ${styles.page}`}>
        <div className="container">
          <div className={styles.inner}>
            <h1 className={styles.title}>Ask for a referral</h1>
            <p className={styles.lead}>Tell me which role you want and send your résumé. It takes about five minutes.</p>
            <TalkHub mode="page" initialIntent="referral" referral={referral} syncUrl={false} />
          </div>
        </div>
      </section>
    </Layout>
  );
}
