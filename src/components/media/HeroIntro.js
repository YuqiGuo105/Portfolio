import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, X } from 'lucide-react';
import styles from './HeroIntro.module.css';
import DemoVideo from './DemoVideo';

export function HeroIntroButton({ intro, onPlay, buttonRef }) {
  return <button ref={buttonRef} type="button" className={styles.launch}
    onClick={onPlay} aria-controls="hero-intro-player">
    <span className={styles.playIcon}><Play size={21} fill="currentColor" aria-hidden="true" /></span>
    <span>Watch the {Math.max(1, Math.round(intro.seconds))}-second intro</span>
  </button>;
}

export default function HeroIntro({ intro, onClose }) {
  const root = useRef(null);
  const close = useRef(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return undefined;
    const dialog = root.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    close.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(<dialog id="hero-intro-player" ref={root} className={styles.player} aria-modal="true" aria-label="Yuqi Guo introduction"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { event.stopPropagation(); if (event.target === root.current) onClose(); }}>
    <div className={styles.surface}>
    <header className={styles.header}><h2>Yuqi Guo <span>/ Introduction</span></h2>
      <button ref={close} className={styles.close} type="button" onClick={onClose} aria-label="Close introduction" title="Close introduction"><X aria-hidden="true" /></button>
    </header>
    <DemoVideo demo={intro} autoStart />
    </div>
  </dialog>, document.body);
}
