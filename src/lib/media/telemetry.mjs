export const MEDIA_EVENTS = ['media_impression', 'media_play_request', 'media_preview_start',
  'media_start', 'media_progress', 'media_summary', 'media_complete', 'media_action', 'media_error'];
export const MEDIA_PROPERTIES = ['mediaId', 'mediaVersion', 'placement', 'playbackId', 'playMode',
  'durationSeconds', 'positionSeconds', 'watchedSeconds', 'coveragePercent', 'startupMs',
  'stallCount', 'stallMs', 'quality', 'chapterIndex', 'errorCode', 'sequence', 'playTrigger',
  'bitrateKbps', 'bandwidthKbps', 'downlinkMbps', 'effectiveType'];

// Values are identifiers, never storage URLs, signed URLs, captions or user text.
export function mediaContext(asset = {}, placement = 'article', page = '/') {
  const target = /^\/(?:work-single|blog-single)\/[a-zA-Z0-9-]+$/.test(asset.href || '') ? asset.href : undefined;
  return { page, ...(target ? { target } : {}), properties: { component: 'video', mediaId: String(asset.assetId || asset.id || 'embedded').slice(0, 120),
    mediaVersion: String(asset.version || asset.assetId || asset.id || 'unknown').slice(0, 120),
    contentId: String(asset.contentId || '').slice(0, 120), placement } };
}

// `network(video)` returns what is known about the rendition on screen and the connection
// (see playbackStats.mjs). It is read when a sample is taken, so every record says which quality
// the visitor was watching and how fast their connection was at that moment.
export function createMediaTelemetry({ emit, context, preview = false, now = () => performance.now(),
  id = () => globalThis.crypto?.randomUUID?.() || `play-${Date.now()}-${Math.random().toString(36).slice(2)}`, visible = () => true,
  network = () => ({}) }) {
  let playbackId = id(), sequence = 0, requestedAt = null, started = false, ended = false;
  let last = null, intervals = [], watched = 0, checkpoints = new Set(), lastSummary = 0;
  let stallAt = null, stallMs = 0, stallCount = 0, actions = 0, duration = 0, position = 0;
  let lastEmission = '', disposed = false, playTrigger, conditions = {};
  const viewing = () => ({ durationSeconds: duration, positionSeconds: position,
    watchedSeconds: Math.round(watched * 10) / 10,
    coveragePercent: duration > 0 ? Math.min(100, Math.floor(intervals.reduce((n, [a, b]) => n + b - a, 0) / duration * 100)) : 0,
    stallCount, stallMs: Math.round(stallMs) });
  const metrics = () => ({ ...conditions, ...viewing() });
  function send(event, properties = {}, leaving = false) {
    if (disposed) return;
    try { emit(event, { ...context, leaving, properties: { ...context.properties, playbackId, sequence: ++sequence,
      playMode: preview ? 'preview' : 'explicit', ...(playTrigger ? { playTrigger } : {}), ...metrics(), ...properties } }); } catch { /* Analytics cannot interrupt playback. */ }
  }
  function reset() {
    playbackId = id(); sequence = 0; requestedAt = null; started = false; ended = false;
    last = null; intervals = []; watched = 0; checkpoints = new Set(); lastSummary = 0;
    stallAt = null; stallMs = 0; stallCount = 0; actions = 0; lastEmission = '';
  }
  function sample(v) {
    const at = now();
    duration = Number.isFinite(v.duration) ? Math.max(0, v.duration) : duration;
    position = Number.isFinite(v.currentTime) ? Math.max(0, v.currentTime) : 0;
    try { conditions = network(v) || {}; } catch { conditions = {}; }
    const active = visible() && !v.paused && !v.seeking && v.readyState >= 2;
    if (active && last && position > last.position) {
      const wall = (at - last.at) / 1000, delta = position - last.position;
      // Seeking and suspended tabs must not turn unwatched ranges into completion.
      if (wall > 0 && wall <= 3 && delta <= wall * Math.max(0.25, v.playbackRate || 1) + 0.3) {
        watched += Math.min(wall, delta / Math.max(0.25, v.playbackRate || 1));
        const next = [...intervals, [last.position, position]].sort((a, b) => a[0] - b[0]);
        intervals = [];
        for (const range of next) {
          const previous = intervals[intervals.length - 1];
          if (previous && range[0] <= previous[1] + 0.05) previous[1] = Math.max(previous[1], range[1]);
          else if (intervals.length < 128) intervals.push(range);
        }
      }
    }
    last = active ? { at, position } : null;
    if (started && !preview) for (const percent of [25, 50, 75, 95]) {
      if (metrics().coveragePercent >= percent && !checkpoints.has(percent)) {
        checkpoints.add(percent); send('media_progress', { progressPercent: percent });
      }
    }
    if (started && watched - lastSummary >= 15) summary();
  }
  function summary(leaving = false) {
    if (!started) return;
    // A drifting throughput estimate alone is not a reason to send another summary.
    const fingerprint = JSON.stringify(viewing());
    if (fingerprint === lastEmission) return;
    lastEmission = fingerprint; lastSummary = watched;
    send('media_summary', {}, leaving);
  }
  function closeStall() {
    if (stallAt !== null) { stallMs += Math.max(0, now() - stallAt); stallAt = null; }
  }
  return {
    request(trigger) { if (ended) reset(); if (['hover', 'viewport', 'button'].includes(trigger)) playTrigger = trigger;
      if (requestedAt === null) { requestedAt = now(); send('media_play_request'); } },
    playing(v) {
      if (ended) reset();
      closeStall();
      sample(v);
      if (!started) { started = true; send(preview ? 'media_preview_start' : 'media_start',
        requestedAt === null ? {} : { startupMs: Math.round(now() - requestedAt) }); }
    },
    sample,
    boundary(v, leaving = false) { sample(v); closeStall(); last = null; summary(leaving); },
    seeking() { last = null; },
    finishPreview() { if (preview) { ended = true; last = null; } },
    waiting(v) { if (started && visible() && !v?.seeking && stallAt === null) { stallAt = now(); stallCount++; } last = null; },
    ended(v) { sample(v); closeStall(); summary(); if (!ended && !preview && metrics().coveragePercent >= 95) send('media_complete'); ended = true; last = null; },
    action(action, properties = {}) { if (actions++ < 12) send('media_action', { action, ...properties }); },
    error(code) { if (actions++ < 12) send('media_error', { errorCode: String(code || 'load_failed').slice(0, 64) }); },
    dispose(v) { if (v) sample(v); closeStall(); summary(true); disposed = true; },
    metrics,
  };
}

export function observeMedia(video, telemetry) {
  const handlers = { playing: () => telemetry.playing(video), timeupdate: () => telemetry.sample(video),
    pause: () => telemetry.boundary(video), seeking: () => telemetry.seeking(),
    waiting: () => telemetry.waiting(video), ended: () => telemetry.ended(video),
    error: () => telemetry.error(video.error?.code),
    enterpictureinpicture: () => telemetry.action('pip_enter'), leavepictureinpicture: () => telemetry.action('pip_exit') };
  for (const [name, handler] of Object.entries(handlers)) video.addEventListener(name, handler);
  return () => { for (const [name, handler] of Object.entries(handlers)) video.removeEventListener(name, handler); };
}
