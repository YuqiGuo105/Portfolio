import { useRef, useState } from "react";
import ContactVerification from "../ContactVerification";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import styles from "../ContactForm.module.css";

// The guarded message form: verification, honeypot and delivery rules live in src/lib/contactGuard.mjs.
const MessageForm = () => {
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
    <>
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
    </>
  );
};
export default MessageForm;
