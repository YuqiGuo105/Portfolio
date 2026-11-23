import { useEffect, useMemo, useRef, useState } from 'react';
import { automaticQuality, playbackSnapshot, restorePlayback } from '../../lib/media/rendition.mjs';
import { createMediaPlayer } from '../../lib/media/player.mjs';

export default function useVideoQuality(video, asset, active = true, onError) {
  const options = useMemo(() => asset.qualities || [{ height: asset.height, src: asset.src }], [asset.qualities, asset.height, asset.src]);
  const [quality, setQuality] = useState('auto');
  const [automatic, setAutomatic] = useState(options[0].height);
  const pending = useRef(null);
  const player = useRef(null);
  const levels = useRef([]);
  const selected = useRef('auto');
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const hlsLoaded = useRef(false);
  const resolved = quality === 'auto' ? automatic : quality;
  const source = options.find(option => option.height === resolved)?.src || options[0].src;
  useEffect(() => {
    if (asset.hls || quality !== 'auto') return undefined;
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
  }, [quality, automatic, options, video, asset.hls]);
  useEffect(() => {
    if (!active || !asset.hls || !video.current) return undefined;
    const element = video.current;
    hlsLoaded.current = false;
    const level = event => setAutomatic(event.detail.height);
    element.addEventListener('media-level', level);
    const controller = createMediaPlayer(element, { nativeLevels: options,
      onState: state => { if (state === 'error') errorHandler.current?.(); },
      onLevels: available => {
        levels.current = available;
        if (selected.current !== 'auto') controller.setQuality(available.find(l => l.height === selected.current)?.index ?? -1);
      },
    });
    player.current = controller;
    // Native playback reports its actual decoded height rather than a guessed Auto level.
    const resized = () => { if (element.videoHeight) setAutomatic(Math.min(element.videoWidth, element.videoHeight)); };
    element.addEventListener('resize', resized);
    controller.start();
    return () => { element.removeEventListener('media-level', level); element.removeEventListener('resize', resized); controller.dispose(); player.current = null; };
  }, [active, asset.hls, options, video]);
  function change(value) {
    const height = value === 'auto' ? 'auto' : Number(value);
    if (height === quality || (height !== 'auto' && !options.some(option => option.height === height))) return;
    if (asset.hls) {
      selected.current = height;
      player.current?.setQuality(height === 'auto' ? -1 : levels.current.find(l => l.height === height)?.index ?? -1);
      setQuality(height);
      return;
    }
    if ((height === 'auto' ? automatic : height) !== resolved && video.current?.readyState >= 1) {
      pending.current = playbackSnapshot(video.current, pending.current);
      video.current.pause();
    }
    setQuality(height);
  }
  function loaded(initialTime = 0) {
    if (asset.hls && hlsLoaded.current && !pending.current) return;
    hlsLoaded.current = true;
    const snapshot = pending.current || { time: initialTime, playing: true, rate: 1 };
    pending.current = null;
    restorePlayback(video.current, { ...snapshot, playing: snapshot.playing && !document.hidden });
  }
  function seek(seconds) {
    if (!video.current || video.current.readyState < 1 || pending.current) pending.current = { ...playbackSnapshot(video.current, pending.current), time: seconds, playing: true };
  }
  return { options, quality, resolved, source: asset.hls ? undefined : source, change, loaded, seek,
    retry: () => player.current?.start() };
}
