import Head from 'next/head';
import Link from 'next/link';
import { Film, ArrowLeft } from 'lucide-react';
import { MediaLibraryContent } from './media';
import { localDemos, localIntro } from '../../src/lib/media/demoCatalog.mjs';

export function getServerSideProps() {
  const demos = localDemos();
  if (!demos.length) return { notFound: true };
  return { props: { assets: [localIntro(), ...demos].filter(Boolean).map(demo => ({
    id: demo.id, title: demo.title, filename: demo.src.split('/').pop(), kind: 'VIDEO', status: 'LOCAL',
    sizeBytes: demo.bytes, createdAt: '', previewUrl: demo.poster, previewSource: demo.src,
    previewDemo: { ...demo, chapters: demo.chapters || [] },
    usages: demo.href ? [{ label: demo.title, href: demo.href, displayWidth: 820 }, { label: demo.contentId?.startsWith('blog:') ? 'Home / Tech blogs' : 'Home / Projects', href: demo.contentId?.startsWith('blog:') ? '/#blog-section' : '/#works-section', displayWidth: 600 }] : [{ label: 'Home / Introduction', href: '/', displayWidth: 960 }],
  })) } };
}

export default function LocalMediaLibrary({ assets }) {
  return <>
    <Head><title>Media library | Local review</title><meta name="robots" content="noindex,nofollow" /></Head>
    <div className="media-review-shell">
      <aside><strong>Yuqi Admin</strong><span><Film size={18} />Media library</span></aside>
      <main><Link href="/demos"><a className="back"><ArrowLeft size={16} />Demos</a></Link>
        <MediaLibraryContent previewAssets={assets} />
      </main>
    </div>
    <style jsx>{`
      .media-review-shell { min-height: 100vh; display: grid; grid-template-columns: 220px minmax(0, 1fr); background: #fff; color: #25313b; font: 15px/1.5 system-ui, sans-serif; }
      aside { border-right: 1px solid #dfe5e9; padding: 28px 22px; background: #f7f8f9; }
      aside strong { display: block; margin-bottom: 36px; font-size: 20px; }
      aside span { display: flex; align-items: center; gap: 10px; color: #0f766e; }
      main { min-width: 0; padding: 32px; }
      .back { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 24px; min-height: 40px; color: #45505a; }
      @media(max-width: 700px) { .media-review-shell { grid-template-columns: 1fr; grid-template-rows: auto 1fr; } aside { border-bottom: 1px solid #dfe5e9; border-right: 0; display: flex; align-items: center; justify-content: space-between; padding: 16px; } aside strong { margin: 0; } main { padding: 24px 16px; } }
    `}</style>
  </>;
}
