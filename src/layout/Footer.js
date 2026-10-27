import SocialLinks from '../components/SocialLinks';
import styles from './Footer.module.css';
import { OPEN_TERMINAL_EVENT } from '../components/TerminalLauncher';

const Footer = () => {
  return (
    <footer className={`footer ${styles.footer}`}>
      <div className="footer__builder">
        <div className="container">
          <div className={styles.content}>
            <div className={styles.social}>
              <SocialLinks className="social-links" />
            </div>
            <div>
              <div className="copyright-text">
                © 2023 <strong>Yuqi Guo&apos;s Blog</strong> All Rights Reserved
              </div>
            </div>
            <div>
              <div className="copyright-text">
                Developed by <strong>Yuqi Guo</strong>
              </div>
              <button
                type="button"
                className={styles.terminal}
                onClick={() => window.dispatchEvent(new Event(OPEN_TERMINAL_EVENT))}
                title="Open the site terminal (` or ⌘K)"
              >
                <span aria-hidden="true">&gt;_</span> Open terminal <kbd>`</kbd>
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
