export function automaticQuality(options, { width = 1280, pixelRatio = 1, saveData = false, effectiveType = '', downlink = 0 } = {}) {
  const heights = [...new Set(options.map(option => option.height))].sort((a, b) => a - b);
  let ceiling = 720;
  if (saveData || /(^|-)2g$/.test(effectiveType) || (downlink > 0 && downlink < 1.5)) ceiling = 360;
  else if (effectiveType === '3g' || (downlink > 0 && downlink < 3)) ceiling = 480;
  const allowed = heights.filter(height => height <= ceiling);
  const target = Math.min(ceiling, Math.max(360, width * 9 / 16 * Math.min(1.5, pixelRatio)));
  return allowed.find(height => height >= target) || allowed.at(-1) || heights[0];
}

export function playbackSnapshot(video, pending = null) {
  return pending || {
    time: video?.currentTime || 0,
    playing: video ? !video.paused && !video.ended : false,
    rate: video?.playbackRate || 1,
  };
}

export function restorePlayback(video, snapshot) {
  if (!video || !snapshot) return;
  const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.01) : snapshot.time;
  video.currentTime = Math.min(Math.max(0, snapshot.time), end);
  video.playbackRate = snapshot.rate;
  if (snapshot.playing) video.play()?.catch(() => {});
  else video.pause();
}
