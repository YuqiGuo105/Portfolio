import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { canPreviewOnHover } from '../../lib/media/demoCatalog.mjs';
import styles from './ProjectHoverVideo.module.css';

const PREVIEW_STARTED = 'yuqi:media-preview-start';

export default function ProjectHoverVideo({ demo, children, inline = false, hoverBoundary = null, hoverDelay = 800 }) {
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  const video = useRef(null);
  const root = useRef(null);
  const visible = useRef(true);
  const manual = useRef(false);
  const stop = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    manual.current = false;
    video.current?.pause();
    setActive(false);
    setPlaying(false);
  }, []);
  const start = useCallback((explicit = false) => {
    if (!demo?.preview || document.hidden || !visible.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    manual.current = explicit;
    window.dispatchEvent(new window.CustomEvent(PREVIEW_STARTED, { detail: root.current }));
    setActive(true);
  }, [demo?.preview]);
  const leave = useCallback(() => {
    // A touch pointer leaves on finger-up; an explicit preview must keep playing.
    if (!manual.current) stop();
  }, [stop]);
  const enter = useCallback(event => {
    const pointerType = event.pointerType;
    const allowed = () => !document.hidden && visible.current && canPreviewOnHover({
      pointerType,
      fineHover: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      saveData: navigator.connection?.saveData,
    });
    if (!demo?.preview || !allowed()) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (allowed()) start();
    }, hoverDelay);
  }, [demo?.preview, hoverDelay, start]);
  const toggle = event => {
    event.preventDefault();
    event.stopPropagation();
    if (active) stop();
    else start(true);
  };
  const mountVideo = useCallback(node => {
    video.current = node;
    if (node) node.play()?.catch(() => { if (video.current === node) stop(); });
  }, [stop]);
  useEffect(() => {
    stop();
    if (!demo?.preview) return undefined;
    const hidden = () => { if (document.hidden) stop(); };
    const otherPreview = event => { if (event.detail !== root.current) stop(); };
    const observer = new IntersectionObserver(entries => {
      visible.current = Boolean(entries[0]?.isIntersecting);
      if (!visible.current) stop();
    });
    if (root.current) observer.observe(root.current);
    const boundary = hoverBoundary ? root.current?.closest(hoverBoundary) : null;
    boundary?.addEventListener('pointerenter', enter);
    boundary?.addEventListener('pointerleave', leave);
    boundary?.addEventListener('pointercancel', leave);
    window.addEventListener(PREVIEW_STARTED, otherPreview);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearTimeout(timer.current);
      observer.disconnect();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener(PREVIEW_STARTED, otherPreview);
      boundary?.removeEventListener('pointerenter', enter);
      boundary?.removeEventListener('pointerleave', leave);
      boundary?.removeEventListener('pointercancel', leave);
    };
  }, [demo?.preview, hoverBoundary, enter, leave, stop]);
  const label = `${active ? 'Pause' : 'Play'} video preview${demo?.title ? `: ${demo.title}` : ''}`;
  return <div ref={root} className={`${styles.cover} ${inline ? styles.inline : ''}`} onPointerEnter={hoverBoundary ? undefined : enter} onPointerLeave={hoverBoundary ? undefined : leave} onPointerCancel={leave}>
    {children}
    {active && <video ref={mountVideo} src={demo.preview} muted autoPlay loop playsInline preload="none"
      aria-hidden="true" tabIndex={-1} className={`${styles.video} ${playing ? styles.playing : ''}`}
      onPlaying={() => setPlaying(true)} onError={stop} />}
    {demo?.preview && <button type="button" className={styles.previewButton} aria-label={label} title={label}
      aria-pressed={active} onClick={toggle} onPointerDown={event => event.stopPropagation()}
      onTouchStart={event => event.stopPropagation()}>
      {active ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
    </button>}
  </div>;
}
