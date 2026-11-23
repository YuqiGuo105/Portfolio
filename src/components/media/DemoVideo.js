import { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, ExternalLink, Captions, PictureInPicture2, Maximize, Minimize, Volume2, VolumeX } from 'lucide-react';
import { formatVideoTime } from '../../lib/media/demoCatalog.mjs';
import styles from './DemoVideo.module.css';
import useVideoQuality from './useVideoQuality';
import VideoQuality from './VideoQuality';

export default function DemoVideo({ demo, autoStart = false }) {
  const [started, setStarted] = useState(autoStart);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(demo.seconds);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [cue, setCue] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [notice, setNotice] = useState('');
  const video = useRef(null);
  const captionTrack = useRef(null);
  const frame = useRef(null);
  const quality = useVideoQuality(video, demo);
  const chapters = demo.chapters || [];
  const activeChapter = Math.max(0, chapters.findLastIndex(chapter => chapter.seconds <= time));
  const segments = chapters.length ? chapters : [{ seconds: 0, title: demo.title }];
  useEffect(() => {
    setPipSupported(Boolean(document.pictureInPictureEnabled));
    const pause = () => { if (document.pictureInPictureElement !== video.current) video.current?.pause(); };
    const hidden = () => { if (document.hidden) pause(); };
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) pause(); });
    const onFullscreen = () => setFullscreen(document.fullscreenElement === frame.current);
    if (frame.current) observer.observe(frame.current);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', hidden); document.removeEventListener('fullscreenchange', onFullscreen); };
  }, []);
  useEffect(() => {
    if (!started) return undefined;
    const player = video.current;
    return () => { player?.pause(); };
  }, [started]);
  useEffect(() => {
    if (!started || !demo.captions) return undefined;
    const element = captionTrack.current;
    const track = element?.track;
    if (!track) return undefined;
    const update = () => setCue(Array.from(track.activeCues || [], item => item.text).join('\n'));
    track.mode = 'hidden';
    track.addEventListener('cuechange', update);
    element.addEventListener('load', update);
    return () => { track.removeEventListener('cuechange', update); element.removeEventListener('load', update); };
  }, [started, demo.captions]);
  function playFrom(seconds = null) {
    if (seconds !== null) { quality.seek(seconds); setTime(seconds); }
    setError(false);
    setStarted(true);
    if (video.current) {
      if (seconds !== null && video.current.readyState >= 1) video.current.currentTime = seconds;
      if (video.current.error) video.current.load();
      video.current.play().catch(() => {});
    }
  }
  function toggle() {
    if (playing) video.current?.pause();
    else playFrom(time >= duration ? 0 : null);
  }
  function scrub(seconds) {
    const next = Math.max(0, Math.min(duration, seconds));
    setTime(next);
    if (!started) { playFrom(next); return; }
    if (video.current?.readyState >= 1) video.current.currentTime = next;
  }
  async function pictureInPicture() {
    try {
      if (document.pictureInPictureElement === video.current) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
      setNotice('');
    } catch { setNotice('Picture-in-picture is unavailable in this browser.'); }
  }
  async function expand() {
    try {
      if (document.fullscreenElement === frame.current) await document.exitFullscreen();
      else if (frame.current?.requestFullscreen) await frame.current.requestFullscreen();
      else if (video.current?.webkitEnterFullscreen) video.current.webkitEnterFullscreen();
      else setNotice('Fullscreen is unavailable in this browser.');
    } catch { setNotice('Fullscreen is unavailable in this browser.'); }
  }
  function keyboard(event) {
    if (event.target !== frame.current) return;
    if ([' ', 'k', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault();
    if (event.key === ' ' || event.key === 'k') toggle();
    if (event.key === 'ArrowLeft') scrub(time - 5);
    if (event.key === 'ArrowRight') scrub(time + 5);
  }
  return <figure className={styles.figure}>
    <div ref={frame} className={styles.frame} role="group" aria-label={`${demo.title} player`} tabIndex={0} onKeyDown={keyboard}>
      <div className={styles.picture}>
      {started ? <video ref={video} src={quality.source} poster={demo.poster}
        crossOrigin="anonymous" playsInline preload="metadata" muted={muted} aria-label={`${demo.title} video`} onClick={toggle}
        onLoadedMetadata={() => {
          setError(false);
          if (Number.isFinite(video.current.duration)) setDuration(video.current.duration);
          if (video.current.textTracks[0]) video.current.textTracks[0].mode = 'hidden';
          quality.loaded();
        }}
        onTimeUpdate={() => setTime(video.current?.currentTime || 0)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setTime(duration); }}
        onError={() => { setError(true); setPlaying(false); }}>
        {demo.captions && <track ref={captionTrack} kind="captions" src={demo.captions} srcLang="en" label="English" default />}
      </video> :
        <div className={styles.poster}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={demo.poster} alt={`${demo.title} video cover`} width={demo.width} height={demo.height} loading="lazy" decoding="async" />
        </div>}
        {!playing && <button type="button" className={styles.play} onClick={toggle}
          aria-label={`${error ? 'Retry' : time >= duration ? 'Replay' : 'Play'} ${demo.title} video`}>
          {error || time >= duration ? <RotateCcw size={28} aria-hidden="true" /> : <Play size={28} fill="currentColor" aria-hidden="true" />}
        </button>}
      </div>
      <div className={styles.overlay}>
        {captions && cue && <div className={styles.caption}><span>{cue}</span></div>}
        <div className={styles.progress}>
          <div className={styles.segments} aria-hidden="true">{segments.map((chapter, index) => {
            const end = segments[index + 1]?.seconds ?? duration;
            const span = Math.max(0.01, end - chapter.seconds);
            return <span key={chapter.seconds} style={{ flexGrow: span }}><i style={{ width: `${Math.min(100, Math.max(0, (time - chapter.seconds) / span * 100))}%` }} /></span>;
          })}</div>
          <input aria-label={`${demo.title} progress`} type="range" min="0" max={duration} step="0.01" value={time}
            aria-valuetext={`${formatVideoTime(time)} of ${formatVideoTime(duration)}`} onChange={event => scrub(Number(event.target.value))} />
        </div>
        <div className={styles.controls}>
          <button type="button" className={styles.icon} onClick={toggle} aria-label={playing ? 'Pause video' : 'Play video'} title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={21} fill="currentColor" aria-hidden="true" /> : <Play size={21} fill="currentColor" aria-hidden="true" />}
          </button>
          <span className={styles.time}>{formatVideoTime(time)} / {formatVideoTime(duration)}</span>
          <span className={styles.chapterName}>{chapters[activeChapter]?.title}</span>
          <div className={styles.tools}>
            <button type="button" className={`${styles.icon} ${styles.sound}`} onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute video' : 'Mute video'} title={muted ? 'Unmute' : 'Mute'}>
              {muted ? <VolumeX size={21} aria-hidden="true" /> : <Volume2 size={21} aria-hidden="true" />}
            </button>
            <button type="button" className={styles.icon} disabled={!demo.captions} aria-pressed={Boolean(demo.captions && captions)}
              onClick={() => setCaptions(!captions)} aria-label="Captions" title={demo.captions ? 'Captions' : 'No captions available'}><Captions size={21} aria-hidden="true" /></button>
            <VideoQuality quality={quality} title={demo.title} />
            <button type="button" className={`${styles.icon} ${styles.pip}`} disabled={!started || !pipSupported} onClick={pictureInPicture} aria-label="Picture in picture" title="Picture in picture"><PictureInPicture2 size={21} aria-hidden="true" /></button>
            <button type="button" className={styles.icon} onClick={expand} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? <Minimize size={21} aria-hidden="true" /> : <Maximize size={21} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
      {(notice || error) && <p className={styles.notice} role="status">{error ? 'Video could not load. Select play to retry.' : notice}</p>}
    </div>
    {chapters.length > 0 && <figcaption className={styles.toolbar}>
      <div className={styles.chapters} aria-label="Video chapters">
      {chapters.map((chapter, index) => <button key={chapter.seconds} type="button"
        aria-pressed={started && activeChapter === index} onClick={() => playFrom(chapter.seconds)}>
        <span>{formatVideoTime(chapter.seconds)}{duration <= 6 && chapter.seconds % 1 ? `.${String(Math.round(chapter.seconds % 1 * 100)).padStart(2, '0')}` : ''}</span>{chapter.title}
      </button>)}
      </div>
      {chapters[activeChapter]?.href && <a className={styles.source} href={chapters[activeChapter].href}
        target="_blank" rel="noopener noreferrer">Open PR <ExternalLink size={16} aria-hidden="true" /></a>}
    </figcaption>}
  </figure>;
}
