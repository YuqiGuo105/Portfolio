import Link from "next/link";
import Layout from "../src/layout/Layout";
import SeoHead from "../src/components/SeoHead";
import TalkHub from "../src/components/talk/TalkHub";
import { TALK_PATH } from "../src/components/talk/links";
import styles from "../styles/ReferralPage.module.css";

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
  const company = referral?.company || "";
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
            <div className={styles.hero}>
              <div>
                <h1 className={styles.title}>Let me put your name forward.</h1>
                <p className={styles.lead}>
                  A referral sends your application in with my name on it. Tell me the role, send your résumé,
                  and I will take it from there{company ? ` at ${company}` : ""}.
                </p>
                <a className={styles.start} href="#referral-form">Start my request</a>
                <p className={styles.terms}>About five minutes. One request per person.</p>
              </div>
              {/* An illustration of what is being asked for; it holds no data. */}
              <div className={styles.slip} aria-hidden="true">
                <p className={styles.slipHead}><span>Employee referral</span><span>No. R-2026</span></p>
                <dl className={styles.fields}>
                  <div><dt>Candidate</dt><dd className={styles.blank}>Your name here</dd></div>
                  <div><dt>Role</dt><dd className={styles.blank}>The opening you choose</dd></div>
                  <div><dt>Referred by</dt><dd>Yuqi Guo, Software Engineer</dd></div>
                </dl>
                <div className={styles.slipFoot}>
                  <p className={styles.signature}>Yuqi Guo<small>Referring employee</small></p>
                  <span className={styles.stamp}>Referred</span>
                </div>
              </div>
            </div>

            <ol className={styles.steps}>
              <li>
                <h2>Tell me the role</h2>
                <p>Pick up to three openings, add a short introduction and attach your résumé.</p>
              </li>
              <li>
                <h2>Get a full evaluation</h2>
                <p>My own AI screening system reads your whole background and résumé, usually within a minute.</p>
              </li>
              <li>
                <h2>Follow it to the referral</h2>
                <p>A private status page shows every stage. When your request passes, I am asked to submit your referral.</p>
              </li>
            </ol>

            <div className={styles.form} id="referral-form">
              <h2 className={styles.formTitle}>Your request</h2>
              <TalkHub mode="page" initialIntent="referral" referral={referral} syncUrl={false} only="referral" />
            </div>
            <p className={styles.other}>
              Not after a referral? <Link href={TALK_PATH}><a>Send me a message or chat live</a></Link>.
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
