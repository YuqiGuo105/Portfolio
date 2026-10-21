import Head from 'next/head';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const ChatWidget = dynamic(() => import('../../src/components/ChatWidget'), { ssr: false });

export default function VoicePreview() {
  return <>
    <Head><title>Mr. Pot / Voice preview</title><meta name="robots" content="noindex,nofollow" /></Head>
    <main data-voice-public-content style={{ maxWidth: 760, margin: '48px auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #d3dfda', paddingBottom: 24, marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, margin: '0 0 12px' }}>Mr. Pot / Voice preview</h1>
        <Link href="/">Portfolio home</Link>
        <p><Link href="/admin/mr-pot-voice-motion">Animation preview</Link></p>
      </header>
      <h2 style={{ fontSize: 19 }}>Yuqi Guo</h2>
      <p>Software engineering portfolio</p>
      <nav aria-label="Portfolio sections">
        <p><Link href="/#tour-background">My Background</Link></p>
        <p><Link href="/#tour-projects">Projects</Link></p>
        <p><Link href="/#tour-techblogs">My Blogs</Link></p>
      </nav>
    </main>
    <ChatWidget />
  </>;
}

export function getServerSideProps() {
  if (process.env.NODE_ENV !== 'development' || process.env.GEMINI_LIVE_ENABLED !== 'true') return { notFound: true };
  return { props: {} };
}
