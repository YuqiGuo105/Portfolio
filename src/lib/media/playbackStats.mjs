// What a player knows about the picture it is showing and the connection it is using.
// The player writes here; viewing telemetry reads here. Nothing is measured by extra requests:
// the throughput is the estimate the HLS player already keeps from the segments it downloaded.

const reported = new WeakMap();
const round = (value, step = 1) => Math.round(value / step) * step;

/** Called by the player when a rendition is switched in or a segment finishes loading. */
export function notePlaybackStats(video, stats) {
  if (!video || !stats) return;
  reported.set(video, { ...reported.get(video), ...stats });
}

export function clearPlaybackStats(video) {
  if (video) reported.delete(video);
}

/**
 * Bounded telemetry properties for one video element, or {} when nothing is known.
 * quality          the rendition on screen, e.g. "720p" (decoded height when the player did not say)
 * bitrateKbps      what that rendition needs
 * bandwidthKbps    throughput the player measured while downloading segments
 * downlinkMbps,
 * effectiveType    the browser's own estimate of the connection, where it offers one
 */
export function mediaNetworkProperties(video, connection = globalThis.navigator?.connection) {
  const stats = (video && reported.get(video)) || {};
  const decoded = video?.videoWidth > 0 && video?.videoHeight > 0 ? Math.min(video.videoWidth, video.videoHeight) : 0;
  const height = Number.isFinite(stats.height) && stats.height > 0 ? stats.height : decoded;
  const properties = {};
  if (height >= 100 && height <= 4320) properties.quality = `${Math.round(height)}p`;
  if (Number.isFinite(stats.bitrate) && stats.bitrate > 0) properties.bitrateKbps = Math.min(100000, round(stats.bitrate / 1000, 10));
  if (Number.isFinite(stats.bandwidth) && stats.bandwidth > 0) properties.bandwidthKbps = Math.min(1000000, round(stats.bandwidth / 1000, 50));
  if (Number.isFinite(connection?.downlink) && connection.downlink > 0) properties.downlinkMbps = Math.min(10000, Math.round(connection.downlink * 10) / 10);
  if (['slow-2g', '2g', '3g', '4g'].includes(connection?.effectiveType)) properties.effectiveType = connection.effectiveType;
  return properties;
}
