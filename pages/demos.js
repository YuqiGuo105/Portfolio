import Link from 'next/link';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import Layout from '../src/layout/Layout';
import SeoHead from '../src/components/SeoHead';
import DemoVideo from '../src/components/media/DemoVideo';
import { loadMediaCatalog } from '../src/lib/media/publishedCatalog.mjs';
import { publicServerClient } from '../src/lib/publicContent.mjs';
import styles from '../src/components/media/Demos.module.css';

export async function getServerSideProps() {
  const { demos } = await loadMediaCatalog(publicServerClient());
  return demos.length ? { props: { demos } } : { notFound: true };
}

export default function Demos({ demos }) {
  return <><SeoHead title="My Demos" description="Project walkthroughs by Yuqi Guo." />
    <Layout><section className={styles.page}>
      <div className="container">
        <Link href="/#works-section"><a className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Projects</a></Link>
        <h1>My Demos</h1>
        {demos.map(demo => <article key={demo.id} className={styles.demo}>
          <DemoVideo demo={demo} />
          <div className={styles.details}>
            <span className={styles.eyebrow}>{demo.contentId.startsWith('blog:') ? 'Technical article' : 'Featured project'}</span>
            <h2>{demo.title}</h2>
            <p>{demo.summary}</p>
            <Link href={`${demo.href}#${demo.contentId.startsWith('blog:') ? 'article-video' : 'project-video'}`}><a className={styles.projectLink}>{demo.contentId.startsWith('blog:') ? 'Read article' : 'View project'} <ArrowUpRight size={18} aria-hidden="true" /></a></Link>
          </div>
        </article>)}
      </div>
    </section></Layout>
  </>;
}
