import TalkHub from "./talk/TalkHub";

// The home page's Contact section: direct contact details on the left, and on the right the Talk
// hub (send a message, ask for a referral, chat live). The same hub is the whole of /talk.
const ContactForm = ({ referral = null }) => (
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
          <TalkHub mode="section" referral={referral} />
        </div>
      </div>
    </div>
  </section>
);
export default ContactForm;
