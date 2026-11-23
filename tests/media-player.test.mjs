import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaPlayer } from '../src/lib/media/player.mjs';

class Video extends EventTarget {
  dataset = { hls: 'https://media.example/master.m3u8' };
  plays = 0;
  canPlayType() { return ''; }
  play() { this.plays++; return Promise.resolve(); }
  pause() {}
  load() {}
  removeAttribute() { this.src = ''; }
}
class Hls {
  static Events = { MEDIA_ATTACHED: 'attach', MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', ERROR: 'error' };
  static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
  static instances = [];
  static isSupported() { return true; }
  events = {};
  levels = [{ width: 640, height: 360, bitrate: 800000 }, { width: 1280, height: 720, bitrate: 2000000 }];
  retries = 0;
  constructor(config) { this.config = config; Hls.instances.push(this); }
  on(name, handler) { this.events[name] = handler; }
  attachMedia() { this.events.attach(); }
  loadSource(source) { this.source = source; this.events.manifest(); }
  startLoad() { this.retries++; }
  recoverMediaError() {}
  destroy() { this.destroyed = true; }
}

test('no runtime or media is loaded until start; quality selection and disposal work', async () => {
  let imports = 0;
  const video = new Video();
  const levels = [];
  const player = createMediaPlayer(video, { loadHls: async () => { imports++; return { default: Hls }; }, onLevels: list => levels.push(list) });
  assert.equal(imports, 0);
  await player.start();
  const hls = Hls.instances.at(-1);
  assert.equal(hls.source, video.dataset.hls);
  assert.equal(video.plays, 1);
  assert.equal(levels[0].length, 2);
  player.setQuality(1);
  assert.equal(hls.currentLevel, 1);
  assert.equal(hls.config.capLevelToPlayerSize, false);
  player.setQuality(-1);
  assert.equal(hls.config.capLevelToPlayerSize, true);
  player.dispose();
  assert.equal(hls.destroyed, true);
  assert.equal(video.src, '');
});

test('navigation during a lazy import creates no orphan player or state update', async () => {
  let resolve;
  const states = [];
  const before = Hls.instances.length;
  const player = createMediaPlayer(new Video(), { loadHls: () => new Promise(done => { resolve = done; }), onState: state => states.push(state) });
  const pending = player.start();
  player.dispose();
  resolve({ default: Hls });
  await pending;
  assert.equal(Hls.instances.length, before);
  assert.deepEqual(states, ['loading']);
});

test('fatal errors retry once, then show retry rather than silently losing audio', async () => {
  const states = [];
  const player = createMediaPlayer(new Video(), { loadHls: async () => ({ default: Hls }), onState: state => states.push(state) });
  await player.start();
  const hls = Hls.instances.at(-1);
  hls.events.error(null, { fatal: true, type: 'network' });
  hls.events.error(null, { fatal: true, type: 'network' });
  assert.equal(hls.retries, 1);
  assert.equal(hls.destroyed, true);
  assert.equal(states.at(-1), 'error');
  await player.start();
  assert.notEqual(Hls.instances.at(-1), hls);
  player.dispose();
});

test('native HLS avoids importing hls.js and can be reattached after navigation', async () => {
  const video = new Video();
  video.canPlayType = () => 'probably';
  const options = { preferNative: true, loadHls: () => { throw new Error('must not import'); } };
  const first = createMediaPlayer(video, options);
  await first.start();
  assert.equal(video.src, video.dataset.hls);
  first.dispose();
  const second = createMediaPlayer(video, options);
  await second.start();
  assert.equal(video.plays, 2);
  second.dispose();
});

test('native HLS can select a rendition and return to Auto without losing paused progress', async () => {
  const video = new Video();
  video.canPlayType = () => 'probably';
  video.currentTime = 4; video.duration = 60; video.paused = true; video.playbackRate = 1.25;
  const player = createMediaPlayer(video, { preferNative: true,
    nativeLevels: [{ height: 360, src: 'https://media.example/360p/index.m3u8' }] });
  await player.start();
  player.setQuality(0);
  assert.equal(video.src, 'https://media.example/360p/index.m3u8');
  video.currentTime = 0;
  video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(video.currentTime, 4);
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.plays, 1);
  player.setQuality(-1);
  assert.equal(video.src, video.dataset.hls);
  video.currentTime = 0;
  player.setQuality(0);
  video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(video.currentTime, 4, 'rapid quality changes retain the original playback snapshot');
  player.dispose();
  player.setQuality(0);
  assert.equal(video.src, '');
});
