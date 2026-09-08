import Link from 'next/link';

import SocialLinks from '../components/SocialLinks';
import styles from './Footer.module.css';

const LICENSE_URL = 'https://github.com/YuqiGuo105/Portfolio/blob/main/LICENSE';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  const years = currentYear > 2023 ? `2023–${currentYear}` : '2023';

  return (
    <div className="footer">
      <div className="footer__builder">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-4 col-lg-4 align-left">
              <SocialLinks className="social-links" />
            </div>
            <div className="col-xs-12 col-sm-12 col-md-4 col-lg-4 align-center">
              <div className={`copyright-text ${styles.legalCopy}`}>
                <span>© {years} <strong>Yuqi Guo</strong>. All rights reserved.</span>
                <span className={styles.licenseNote}>Content and source code are licensed separately.</span>
              </div>
            </div>
            <div className="col-xs-12 col-sm-12 col-md-4 col-lg-4 align-right">
              <nav className={`copyright-text ${styles.legalLinks}`} aria-label="Legal information">
                <Link href="/content-usage">Content Usage</Link>
                <a href={LICENSE_URL} target="_blank" rel="noreferrer">Open Source Licenses</a>
                <Link href="/privacy">Privacy</Link>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Footer;
