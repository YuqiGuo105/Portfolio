import Link from 'next/link';

import SeoHead from './SeoHead';
import styles from '../../styles/SitePolicy.module.css';

const LICENSE_URL = 'https://github.com/YuqiGuo105/Portfolio/blob/main/LICENSE';

export default function SitePolicyPage({
  title,
  description,
  path,
  updated = 'September 7, 2026',
  children,
}) {
  return (
    <div className={styles.page}>
      <SeoHead title={title} description={description} url={path} />
      <header className={styles.header}>
        <Link className={styles.brand} href="/">YUQI.SITE</Link>
        <p className={styles.eyebrow}>Site policy</p>
        <h1>{title}</h1>
        <p className={styles.updated}>Last updated {updated}</p>
      </header>
      <main>
        <article className={styles.article}>{children}</article>
      </main>
      <footer className={styles.footer}>
        <Link href="/content-usage">Content Usage</Link>
        <a href={LICENSE_URL} target="_blank" rel="noreferrer">Open Source Licenses</a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/">Return to portfolio</Link>
      </footer>
    </div>
  );
}
