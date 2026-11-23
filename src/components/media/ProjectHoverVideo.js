import { useCallback, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { canPreviewOnHover } from '../../lib/media/demoCatalog.mjs';
import styles from './ProjectHoverVideo.module.css';

export default function ProjectHoverVideo({ demo, children, inline = false, hoverBoundary = null }) {
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  const video = useRef(null);
  const root = useRef(null);
  const stop = useCallback(() => {
    clearTimeout(timer.current);
    video.current?.pause();
    setActive(false);
    setPlaying(false);
  }, []);
  const enter = useCallback(event => {
    if (!demo?.preview || !canPreviewOnHover({
      pointerType: event.pointerType,
      fineHover: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      saveData: navigator.connection?.saveData,
    })) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setActive(true), 180);
  }, [demo?.preview]);
  useEffect(() => {
    if (!demo?.preview) return undefined;
    const hidden = () => { if (document.hidden) stop(); };
    const observer = new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) stop(); });
    if (root.current) observer.observe(root.current);
    const boundary = hoverBoundary ? root.current?.closest(hoverBoundary) : null;
    boundary?.addEventListener('pointerenter', enter);
    boundary?.addEventListener('pointerleave', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => { clearTimeout(timer.current); observer.disconnect(); document.removeEventListener('visibilitychange', hidden); boundary?.removeEventListener('pointerenter', enter); boundary?.removeEventListener('pointerleave', stop); };
  }, [demo?.preview, hoverBoundary, enter, stop]);
  return <div ref={root} className={`${styles.cover} ${inline ? styles.inline : ''}`} onPointerEnter={hoverBoundary ? undefined : enter} onPointerLeave={hoverBoundary ? undefined : stop}>
    {children}
    {active && <video ref={video} src={demo.preview} muted autoPlay loop playsInline preload="none"
      aria-hidden="true" tabIndex={-1} className={`${styles.video} ${playing ? styles.playing : ''}`}
      onPlaying={() => setPlaying(true)} onError={stop} />}
    {demo?.preview && <span className={styles.badge}><Play size={12} aria-hidden="true" />{playing ? 'Preview' : '0:06'}</span>}
  </div>;
}
