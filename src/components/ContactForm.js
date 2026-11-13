import { useRef, useState } from "react";
import TalkNestContact from "./TalkNestContact";
import ContactVerification from "./ContactVerification";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import styles from "./ContactForm.module.css";

const ContactForm = () => {
  const [contactData, setContactData] = useState({
    name: "",
    email: "",
    message: "",
    website: "",
  });
  const [error, setError] = useState(false);
  const { name, email, message } = contactData;
  const [submitted, setSubmitted] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [verificationActive, setVerificationActive] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [verificationReset, setVerificationReset] = useState(0);

  const onChange = (e) =>
    setContactData({ ...contactData, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    if (inFlight.current) return;
    setSubmitted(false);
    setNotice("");
    if (!name || !email || !message) {
      setError(true);
      setTimeout(() => setError(false), 2000);
      return;
    }

    if (!turnstileToken) {
      setVerificationActive(true);
      setNotice("Please complete the verification before sending.");
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contactData, turnstileToken }),
      });
      const result = await res.json();

      if (res.ok) {
        setPendingReview(result.status === 'pending_review');
        setSubmitted(true);
        setContactData({ name: "", email: "", message: "", website: "" });
        setError(false);
      } else {
        setNotice(result.error || "Your message could not be sent. Please try again.");
      }
    } catch (err) {
      setNotice("We could not confirm delivery. Please wait before trying again.");
    } finally {
      inFlight.current = false;
      setSending(false);
      setTurnstileToken("");
      setVerificationReset(value => value + 1);
    }
  };

  return (
    <section className="section section-bg" id="contact-section">
      <div className="container">
        <div className="m-titles">
          <h2 className="m-title" id="tour-contact">Contact Me</h2>
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
          </div>
          <div className="col-md-9 vertical-line contact-form-column">
            <TalkNestContact />
            <div className="contacts-form">
              <form className={styles.form} onSubmit={onSubmit} onFocusCapture={() => setVerificationActive(true)} aria-busy={sending}>
                <label>
                  Name
                  <input type="text" name="name" value={name} onChange={onChange} placeholder="Enter your full name" maxLength={120} required/>
                  {error && !name && <span className="error">This field is required.</span>}
                </label>
                <label>
                  Email Address
                  <input type="email" name="email" value={email} onChange={onChange}
                         placeholder="Enter your email address" maxLength={320} required/>
                  {error && !email && <span className="error">This field is required.</span>}
                </label>
                <label>
                  Message
                  <textarea name="message" value={message} onChange={onChange} placeholder="Enter your message here" maxLength={5000} required/>
                  {error && !message && <span className="error">This field is required.</span>}
                </label>
                <div aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
                  <label>Leave this field empty<input type="text" name="website" tabIndex={-1} autoComplete="off" value={contactData.website} onChange={onChange}/></label>
                </div>
                <div className={styles.footer} data-contact-actions>
                  <ContactVerification active={verificationActive} resetKey={verificationReset} onToken={setTurnstileToken}/>
                  <button type="submit" className={styles.submit} disabled={sending}>
                    <span>{sending ? 'Sending...' : 'Submit'}</span>
                    {sending ? <LoaderCircle size={18} className={styles.spinner} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
                  </button>
                </div>
                {notice && <p className={styles.notice} role="alert">{notice}</p>}
              </form>
            </div>
            {submitted && (
              <div className="alert-success">
                <p>{pendingReview ? 'Your message was received and is waiting for review.' : 'Thanks, your message has been sent successfully.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
export default ContactForm;
