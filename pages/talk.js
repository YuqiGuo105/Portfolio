import Layout from "../src/layout/Layout";
import SeoHead from "../src/components/SeoHead";
import TalkHub from "../src/components/talk/TalkHub";
import styles from "../styles/TalkPage.module.css";

// Still a static page: the company I can refer to is read from my work history when the page is
// generated, and the page is regenerated in the background (and at once from the admin pages when
// my employer or the referral switch changes). Visitors never wait on a lookup.
export async function getStaticProps() {
  const { referralRuntime } = await import("../src/lib/referral/runtime.mjs");
  const { publicAvailability } = await import("../src/lib/referral/availability.mjs");
  const state = await referralRuntime().availability.get();
  // An unanswered lookup is retried soon instead of being kept for five minutes.
  return { props: { referral: publicAvailability(state) }, revalidate: state.known ? 300 : 30 };
}

// Two ways to reach Yuqi: a message or a live chat. /talk?intent=chat opens that tab directly.
// A referral is asked for on /referral; an old /talk?intent=referral link is sent there.
export default function TalkPage({ referral }) {
  return (
    <Layout>
      <SeoHead
        title="Talk with me"
        description="Send Yuqi Guo a message, or chat and call live on TalkNest."
        url="/talk"
      />
      <section className={`section ${styles.page}`}>
        <div className="container">
          <div className={styles.inner}>
            <h1 className={styles.title}>Talk with me</h1>
            <p className={styles.lead}>
              Choose what you came for. Messages land in my inbox; live chat and calls happen on TalkNest.
            </p>
            <TalkHub mode="page" referral={referral} />
          </div>
        </div>
      </section>
    </Layout>
  );
}
