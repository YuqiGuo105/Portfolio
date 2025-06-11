import { useState } from "react";

const ContactForm = () => {
  const [contactData, setContactData] = useState({
    name: "",
    email: "",
    messages: "",
  });
  const [error, setError] = useState(false);
  const { name, email, message } = contactData;
  const [submitted, setSubmitted] = useState(false);

  const onChange = (e) =>
    setContactData({ ...contactData, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email || !message) {
      setError(true);
      setTimeout(() => setError(false), 2000);
      return;
    }

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactData),
      });

      if (res.ok) {
        setSubmitted(true);
        setContactData({ name: "", email: "", message: "" });
      } else {
        throw new Error("Submission failed");
      }
    } catch (err) {
      console.error(err);
      setError(true);
    }
  };

  return (
    <section className="section section-bg section-parallax section-parallax-2" id="contact-section">
      <div className="container">
        <div className="m-titles">
          <h2 className="m-title">Contact Me</h2>
        </div>
        <div className="row row-custom">
          <div className="col-md-3 align-right">
            <div className="numbers-items contacts-items">
              <div className="numbers-item">
                <div className="icon"><i className="fas fa-phone"/></div>
                <div className="num">+1 (315) 956 7675</div>
              </div>
              <div className="numbers-item">
                <div className="icon"><i className="fas fa-mail-bulk"/></div>
                <div className="num">yuqi.guo17@gmail.com</div>
              </div>
              <div className="numbers-item">
                <div className="icon"><i className="fas fa-location-arrow"/></div>
                <div className="num">Syracuse, NY, USA 13210</div>
              </div>
            </div>
          </div>
          <div className="col-md-9 vertical-line">
            <div className="contacts-form">
              <form onSubmit={onSubmit}>
                <label>
                  Name
                  <input type="text" name="name" value={name} onChange={onChange} placeholder="Enter your full name"/>
                  {error && !name && <span className="error">This field is required.</span>}
                </label>
                <label>
                  Email Address
                  <input type="email" name="email" value={email} onChange={onChange}
                         placeholder="Enter your email address"/>
                  {error && !email && <span className="error">This field is required.</span>}
                </label>
                <label>
                  Message
                  <textarea name="message" value={message} onChange={onChange} placeholder="Enter your message here"/>
                  {error && !message && <span className="error">This field is required.</span>}
                </label>
                <button type="submit" className="btn">Submit</button>
              </form>
            </div>
            {submitted && (
              <div className="alert-success">
                <p>Thanks, your message has been sent successfully.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
export default ContactForm;
