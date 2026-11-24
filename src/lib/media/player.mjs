import { playbackSnapshot, restorePlayback } from './rendition.mjs';
import { clearPlaybackStats, notePlaybackStats } from './playbackStats.mjs';

const NATIVE_HLS = 'application/vnd.apple.mpegurl';

/** Owns one video element. No playlist, segment or HLS runtime is requested until play. */
export function createMediaPlayer(video, { loadHls = () => import('hls.js'), onState = () => {}, onLevels = () => {}, nativeLevels = [],
  preferNative = typeof window !== 'undefined' && !(window.MediaSource || window.ManagedMediaSource) } = {}) {
  let disposed = false;
  let hls;
  let starting;
  let networkRetry = false;
  let mediaRetry = false;
  let native = false;
  let restoreNative;
  let nativeSnapshot;
  const startNative = () => {
    native = true;
    onLevels(nativeLevels.map((level, index) => ({ index, height: level.height })));
    video.src = video.dataset.hls;
    play();
  };
  const play = () => {
    if (!disposed) video.play()?.catch(() => { if (!disposed) onState('ready'); });
  };
  const fail = () => {
    hls?.destroy();
    hls = undefined;
    if (!disposed) onState('error');
  };
  const onPlaying = () => onState('playing');
  video.addEventListener('playing', onPlaying);
  video.addEventListener('error', fail);

  return {
    start() {
      if (disposed) return Promise.resolve();
      if (starting) return starting;
      onState('loading');
      networkRetry = false;
      mediaRetry = false;
      starting = (async () => {
        if (!video.dataset.hls && video.dataset.mp4) {
          video.src = video.dataset.mp4;
          play();
          return;
        }
        if (preferNative && video.canPlayType(NATIVE_HLS)) {
          startNative();
          return;
        }
        const { default: Hls } = await loadHls();
        if (disposed) return;
        if (!Hls.isSupported()) {
          if (video.canPlayType(NATIVE_HLS)) { startNative(); return; }
          const fallback = video.canPlayType(NATIVE_HLS) ? video.dataset.hls : video.dataset.mp4;
          if (!fallback) throw new Error('Unsupported video');
          video.src = fallback;
          play();
          return;
        }
        hls?.destroy();
        hls = new Hls({ capLevelToPlayerSize: true, autoStartLoad: true, maxBufferLength: 20, maxMaxBufferLength: 30 });
        hls.on(Hls.Events.MEDIA_ATTACHED, () => { if (!disposed && hls) hls.loadSource(video.dataset.hls); });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (disposed || !hls) return;
          onLevels(hls.levels.map((level, index) => ({ index, height: Math.min(level.width, level.height) })));
          onState('ready');
          play();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
          const level = hls?.levels[data.level];
          if (disposed || !level) return;
          notePlaybackStats(video, { height: Math.min(level.width, level.height), bitrate: level.bitrate, bandwidth: hls.bandwidthEstimate });
          video.dispatchEvent(new CustomEvent('media-level', {
            bubbles: true, detail: { height: Math.min(level.width, level.height), bitrate: level.bitrate, levels: hls.levels.length },
          }));
        });
        // The estimate settles as segments arrive; viewing telemetry reads the latest one.
        hls.on(Hls.Events.FRAG_LOADED, () => { if (!disposed && hls) notePlaybackStats(video, { bandwidth: hls.bandwidthEstimate }); });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (disposed || !hls || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !networkRetry) {
            networkRetry = true;
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRetry) {
            mediaRetry = true;
            hls.recoverMediaError();
          } else fail();
        });
        hls.attachMedia(video);
      })().catch(fail).finally(() => { starting = undefined; });
      return starting;
    },
    setQuality(index) {
      if (disposed) return;
      if (hls) {
        if (index !== -1 && !hls.levels[index]) return;
        hls.config.capLevelToPlayerSize = index === -1;
        hls.autoLevelCapping = -1;
        hls.currentLevel = index;
      } else if (native) {
        const src = index === -1 ? video.dataset.hls : nativeLevels[index]?.src;
        if (!src || video.src === src) return;
        nativeSnapshot = playbackSnapshot(video, nativeSnapshot);
        video.removeEventListener('loadedmetadata', restoreNative);
        restoreNative = () => {
          const snapshot = nativeSnapshot;
          nativeSnapshot = undefined;
          restorePlayback(video, { ...snapshot,
            playing: snapshot.playing && (typeof document === 'undefined' || !document.hidden) });
        };
        video.addEventListener('loadedmetadata', restoreNative, { once: true });
        video.pause();
        video.src = src;
        video.load();
      }
    },
    dispose() {
      disposed = true;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', fail);
      if (restoreNative) video.removeEventListener('loadedmetadata', restoreNative);
      nativeSnapshot = undefined;
      clearPlaybackStats(video);
      hls?.destroy();
      hls = undefined;
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
