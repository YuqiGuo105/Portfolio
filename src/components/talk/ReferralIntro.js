import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { referralHref } from "./links";
import styles from "./Talk.module.css";

// What a referral request involves, shown on the home page before the full form at /talk.
export default function ReferralIntro({ company }) {
  return (
    <div className={styles.hub}><div className={styles.explain}>
      <h3 className={styles.panelTitle}>Ask me for a referral at {company}</h3>
      <p>Have these three things ready. The form takes about five minutes.</p>
      <ul className={styles.checklist}>
        <li><Check size={16} aria-hidden="true" /><span>The link to the posting you want, with its job ID if it has one.</span></li>
        <li><Check size={16} aria-hidden="true" /><span>Your résumé as a PDF, 2 MB or smaller.</span></li>
        <li><Check size={16} aria-hidden="true" /><span>A short introduction of you, written by you in third person, the way it would read in a referral form.</span></li>
      </ul>
      <p>Every request is evaluated by my own AI screening system, which looks at your whole background and résumé. You can follow yours on a status page. One request per person; a referral is not guaranteed.</p>
      <div className={styles.explainActions}>
        <Link href={referralHref}>
          <a className={styles.primary}>Start a referral request <ArrowRight size={17} aria-hidden="true" /></a>
        </Link>
      </div>
    </div></div>
  );
}
