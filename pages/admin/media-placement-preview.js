import { useState } from 'react';
import Head from 'next/head';
import HeroIntro, { HeroIntroButton } from '../../src/components/media/HeroIntro';
import { publishedDemo } from '../../src/lib/media/publishedCatalog.mjs';

export async function getServerSideProps() {
  if (process.env.NODE_ENV !== 'development' || process.env.VERCEL || !process.env.MEDIA_E2E_OUTPUT)
    return { notFound: true };
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const row = JSON.parse(await readFile(join(process.env.MEDIA_E2E_OUTPUT, 'presentation.json'), 'utf8'));
  const demo = publishedDemo(row, 'https://local-media.invalid');
  if (!demo) return { notFound: true };
  const local = value => typeof value === 'string' ? value.replace('https://local-media.invalid', '') : value;
  return { props: { intro: { ...demo, src: local(demo.src), hls: local(demo.hls), poster: local(demo.poster),
    qualities: demo.qualities.map(q => ({ ...q, src: local(q.src) })) } } };
}

export default function MediaPlacementPreview({ intro }) {
  const [open, setOpen] = useState(false);
  return <main style={{ padding: 24, maxWidth: 960, margin: 'auto' }}>
    <Head><title>Introduction playback acceptance</title><meta name="robots" content="noindex,nofollow" /></Head>
    <h1 style={{ fontSize: 24 }}>Introduction playback acceptance</h1>
    <HeroIntroButton intro={intro} onPlay={() => setOpen(true)} />
    {open && <HeroIntro intro={intro} onClose={() => setOpen(false)} />}
  </main>;
}
