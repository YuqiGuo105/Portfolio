import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Play, RotateCw } from 'lucide-react';
import { createMediaPlayer } from '../../lib/media/player.mjs';
import useMediaTelemetry from './useMediaTelemetry';

function PlayerControls({ video }) {
  const [state, setState] = useState('idle');
  const [levels, setLevels] = useState([]);
  const [quality, setQuality] = useState(-1);
  const player = useRef();
  const videoRef = useRef(video), frameRef = useRef(video.parentElement);
  videoRef.current = video; frameRef.current = video.parentElement;
  const telemetry = useMediaTelemetry({ asset: { id: video.parentElement.dataset.mediaId },
    frame: frameRef, video: videoRef, active: true, placement: 'article_inline' });
  useEffect(() => {
    setState('idle');
    setLevels([]);
    setQuality(-1);
    const controller = createMediaPlayer(video, { onState: setState, onLevels: setLevels });
    player.current = controller;
    return () => controller.dispose();
  }, [video]);
  const pending = ['idle', 'loading', 'error'].includes(state);
  const Icon = state === 'loading' ? Loader2 : state === 'error' ? RotateCw : Play;
  const label = state === 'loading' ? 'Loading video' : state === 'error' ? 'Retry video' : 'Play video';
  return <>
    {pending && <button className="media-play" type="button" aria-label={label} title={label}
      disabled={state === 'loading'} onClick={() => { telemetry.current?.request(); setQuality(-1); player.current?.start(); }}><Icon size={28} aria-hidden="true" /></button>}
    {state === 'error' && <span className="media-error" role="status">Video unavailable. Try again.</span>}
    {levels.length > 1 && <label className="media-quality">Quality <select aria-label="Video quality" value={quality}
      onChange={event => { const index = Number(event.target.value); telemetry.current?.action('quality', { quality: index === -1 ? 'auto' : String(levels.find(level => level.index === index)?.height || index) }); setQuality(index); player.current?.setQuality(index); }}>
      <option value={-1}>Auto</option>{levels.map(level => <option key={level.index} value={level.index}>{level.height}p</option>)}
    </select></label>}
  </>;
}

export default function MediaEnhancer({ html }) {
  const [videos, setVideos] = useState([]);
  useEffect(() => {
    setVideos(Array.from(document.querySelectorAll('.media-video > video[data-hls]')));
  }, [html]);
  return <>
    {videos.map((video, index) => createPortal(<PlayerControls video={video} />, video.parentElement, `${html.length}-${index}`))}
    <style jsx global>{`
      .media-figure { margin: 1.6em 0; }
      .media-video { position: relative; }
      .media-figure video, .media-figure img { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 8px; background: #0f1419; }
      .media-figure.media-image img { background: transparent; }
      .media-figure figcaption { margin-top: 0.5em; font-size: 0.875rem; color: #6b7480; }
      .media-asset img { max-width: 100%; height: auto; border-radius: 8px; }
      .media-play { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: grid; place-items: center; width: 60px; height: 60px; padding: 0; border-radius: 50%; background: #fff; color: #183b36; border: 1px solid #b1c9c4; box-shadow: 0 2px 12px #0003; cursor: pointer; }
      .media-play:focus-visible { outline: 3px solid #26a99b; outline-offset: 4px; }
      .media-play:disabled { cursor: progress; }
      .media-error { position: absolute; left: 12px; right: 12px; bottom: 42px; padding: 6px; text-align: center; color: white; background: #141b21e6; font-size: 14px; }
      .media-quality { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; font-size: 14px; }
      .media-quality select { width: 96px; height: 40px; padding: 4px 8px; font: 14px/1.25 system-ui, sans-serif; color: #183b36; background: #fff; border: 1px solid #b1c9c4; border-radius: 6px; appearance: auto; letter-spacing: 0; }
    `}</style>
  </>;
}
