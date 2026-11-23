import Link from 'next/link';
import { Terminal, History } from 'lucide-react';
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
              <SocialLinks className="social-links" placement="footer" />
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
                <Terminal className={styles.terminalIcon} size={16} aria-hidden="true" /> Open terminal <kbd>`</kbd>
              </button>
              <Link href="/site-history" passHref>
                <a className={styles.terminal} title="See this homepage at every point in its history">
                  <History className={styles.historyIcon} size={16} aria-hidden="true" /> Site history
                </a>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
