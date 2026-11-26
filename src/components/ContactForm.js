import Link from "next/link";
import { ArrowRight, Handshake, Share2 } from "lucide-react";
import TalkHub from "./talk/TalkHub";
import { referralHref } from "./talk/links";
import styles from "./ContactForm.module.css";

// Keep direct contact and referral links separate from the message/live-chat switcher.
const ContactForm = ({ referral = null, shareCardHref }) => (
  <section className="section section-bg" id="contact-section">
    <div className="container">
      <div className={`m-titles ${styles.sectionHeading}`}>
        <h2 className="m-title" id="tour-contact">Contact Me</h2>
        {shareCardHref && <Link href={shareCardHref}><a className={styles.shareCard}>
          <Share2 size={18} aria-hidden="true" /><span>Share card</span>
        </a></Link>}
      </div>
      <div className="row row-custom contact-layout">
        <div className="col-md-3 align-right contact-details">
          <div className="numbers-items contacts-items">
            <div className="numbers-item">
              <div className="icon"><i className="fas fa-phone"/></div>
              <a className="num contact-value" href="tel:+13159567675">+1 (315) 956 7675</a>
            </div>
            <div className="numbers-item">
              <div className="icon"><i className="fas fa-mail-bulk"/></div>
              <a className="num contact-value" href="mailto:yuqi.guo17@gmail.com">yuqi.guo17@gmail.com</a>
            </div>
            <div className="numbers-item">
              <a
                className="contact-map-link"
                href="https://www.google.com/maps/search/?api=1&query=Syracuse%2C%20NY%2013210%2C%20USA"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open Syracuse, NY 13210 in Google Maps (new tab)"
              >
                <span className="icon"><i className="fas fa-location-arrow" aria-hidden="true" /></span>
                <span className="num contact-value">Syracuse, NY, USA 13210</span>
              </a>
            </div>
          </div>
          <Link href={referralHref} prefetch={false}>
            <a className={styles.referralLink}>
              <Handshake size={20} aria-hidden="true" />
              <span>Request a referral</span>
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          </Link>
        </div>
        <div className="col-md-9 vertical-line contact-form-column">
          <TalkHub mode="section" referral={referral} />
        </div>
      </div>
    </div>
  </section>
);
export default ContactForm;
