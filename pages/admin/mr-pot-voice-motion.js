import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Pause, Play, RotateCcw } from 'lucide-react';
import VoiceCallStage from '../../src/components/VoiceCallStage';
import styles from '../../src/components/LiveVoiceCall.module.css';

const STATES = { ready: 'Welcome', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', ended: 'Goodbye' };

export default function VoiceMotionPreview() {
  const [status, setStatus] = useState('ready');
  const [paused, setPaused] = useState(false);
  const [replay, setReplay] = useState(0);
  const level = useRef(null);
  useEffect(() => {
    level.current?.(0);
    if (status !== 'speaking' || paused) return;
    const start = performance.now();
    const timer = setInterval(() => {
      const time = (performance.now() - start) / 1000;
      const phrase = time % 4.8;
      level.current?.(phrase > 3.3 ? 0 : 0.13 + 0.13 * Math.sin(time * 11) ** 2);
    }, 100);
    return () => clearInterval(timer);
  }, [status, paused, replay]);
  return <>
    <Head><title>Mr. Pot / Motion preview</title><meta name="robots" content="noindex,nofollow" /></Head>
    <main className={styles.studyPage}>
      <nav><Link href="/">Portfolio</Link><Link href="/admin/mr-pot-voice">Voice preview</Link></nav>
      <section className={`${styles.call} ${styles.study}`} aria-label="Voice animation preview">
        <header className={styles.header}>
          <div className={styles.identity}><h2>Mr. Pot<span>.</span></h2><span className={styles.kicker}>MOTION STUDY</span></div>
          <select className={styles.stateSelect} aria-label="Preview state" value={status} onChange={event => { setStatus(event.target.value); setPaused(false); }}>
            {Object.entries(STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </header>
        <VoiceCallStage status={status} level={level} visible={!paused} replay={replay} />
        <section className={styles.conversation}>
          <div className={styles.status} role="status">{STATES[status]}</div>
          <p className={styles.disclosure}>Animation only · No microphone · No API calls</p>
        </section>
        <footer className={styles.footer}>
          <div className={styles.controls}>
            <button type="button" title={paused ? 'Play animation' : 'Pause animation'} aria-label={paused ? 'Play animation' : 'Pause animation'} onClick={() => setPaused(value => !value)}>{paused ? <Play size={19} /> : <Pause size={19} />}</button>
            <button type="button" title="Replay animation" aria-label="Replay animation" onClick={() => { setReplay(value => value + 1); setPaused(false); }}><RotateCcw size={19} /></button>
          </div>
        </footer>
      </section>
    </main>
  </>;
}

export function getServerSideProps() {
  if (process.env.NODE_ENV !== 'development') return { notFound: true };
  return { props: {} };
}
