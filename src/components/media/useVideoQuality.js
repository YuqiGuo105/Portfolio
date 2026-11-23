import { useEffect, useMemo, useRef, useState } from 'react';
import { automaticQuality, playbackSnapshot, restorePlayback } from '../../lib/media/rendition.mjs';

export default function useVideoQuality(video, asset) {
  const options = useMemo(() => asset.qualities || [{ height: asset.height, src: asset.src }], [asset.qualities, asset.height, asset.src]);
  const [quality, setQuality] = useState('auto');
  const [automatic, setAutomatic] = useState(options[0].height);
  const pending = useRef(null);
  const resolved = quality === 'auto' ? automatic : quality;
  const source = options.find(option => option.height === resolved)?.src || options[0].src;
  useEffect(() => {
    if (quality !== 'auto') return undefined;
    let timer;
    const connection = navigator.connection;
    const update = () => {
      const next = automaticQuality(options, {
        width: video.current?.clientWidth || Math.min(window.innerWidth, 1280),
        pixelRatio: window.devicePixelRatio,
        saveData: connection?.saveData, effectiveType: connection?.effectiveType, downlink: connection?.downlink,
      });
      if (next === automatic) return;
      if (video.current?.readyState >= 1) pending.current = playbackSnapshot(video.current, pending.current);
      setAutomatic(next);
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 600); };
    update();
    window.addEventListener('resize', schedule);
    connection?.addEventListener('change', schedule);
    return () => { clearTimeout(timer); window.removeEventListener('resize', schedule); connection?.removeEventListener('change', schedule); };
  }, [quality, automatic, options, video]);
  function change(value) {
    const height = value === 'auto' ? 'auto' : Number(value);
    if (height === quality || (height !== 'auto' && !options.some(option => option.height === height))) return;
    if ((height === 'auto' ? automatic : height) !== resolved && video.current?.readyState >= 1) {
      pending.current = playbackSnapshot(video.current, pending.current);
      video.current.pause();
    }
    setQuality(height);
  }
  function loaded(initialTime = 0) {
    const snapshot = pending.current || { time: initialTime, playing: true, rate: 1 };
    pending.current = null;
    restorePlayback(video.current, { ...snapshot, playing: snapshot.playing && !document.hidden });
  }
  function seek(seconds) {
    if (!video.current || video.current.readyState < 1 || pending.current) pending.current = { ...playbackSnapshot(video.current, pending.current), time: seconds, playing: true };
  }
  return { options, quality, resolved, source, change, loaded, seek };
}
