import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { automaticQuality, playbackSnapshot, restorePlayback } from '../src/lib/media/rendition.mjs';
import { LOCAL_DEMOS, LOCAL_INTRO } from '../src/lib/media/demoCatalog.mjs';

function video(overrides = {}) {
  return { currentTime: 7.5, duration: 24, paused: false, ended: false, playbackRate: 1.5,
    volume: 0.4, muted: true, play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }, ...overrides };
}
test('quality switches preserve position, playback rate, mute and volume', () => {
  const element = video(); const snapshot = playbackSnapshot(element);
  element.currentTime = 0; element.pause();
  restorePlayback(element, snapshot);
  assert.equal(element.currentTime, 7.5);
  assert.equal(element.paused, false);
  assert.equal(element.playbackRate, 1.5);
  assert.equal(element.muted, true);
  assert.equal(element.volume, 0.4);
});
test('paused and ended videos do not restart when switching quality', () => {
  for (const state of [{ paused: true }, { ended: true }]) {
    const element = video(state); restorePlayback(element, playbackSnapshot(element));
    assert.equal(element.paused, true);
  }
});
test('rapid switches retain the first position instead of the unloaded element time', () => {
  const snapshot = playbackSnapshot(video());
  assert.equal(playbackSnapshot(video({ currentTime: 0, paused: true }), snapshot), snapshot);
});
test('restore clamps to the new duration and tolerates autoplay rejection', async () => {
  const element = video({ duration: 10, play() { return Promise.reject(new Error('not allowed')); } });
  restorePlayback(element, { time: 24, rate: 1, playing: true });
  assert.equal(element.currentTime, 9.99);
  await Promise.resolve();
});
test('every local full-length video has real 720p, 480p and 360p variants', () => {
  for (const demo of [...LOCAL_DEMOS, LOCAL_INTRO]) {
    assert.deepEqual(demo.qualities.map(option => option.height), [720, 480, 360]);
    for (const option of demo.qualities) {
      assert.equal(fs.statSync(new URL(`../public${option.src}`, import.meta.url)).size, option.bytes);
    }
  }
});
test('the intro delegates to the same custom player, without native controls or eager downloads', () => {
  const source = fs.readFileSync(new URL('../src/components/media/DemoVideo.js', import.meta.url), 'utf8');
  assert.match(source, /<VideoQuality/);
  assert.match(source, /src=\{quality.source\}/);
  assert.doesNotMatch(source, /<source|prefetch|preload="auto"|\scontrols\s/);
  assert.match(source, /requestPictureInPicture/);
  assert.match(source, /requestFullscreen/);
  const intro = fs.readFileSync(new URL('../src/components/media/HeroIntro.js', import.meta.url), 'utf8');
  assert.match(intro, /<DemoVideo demo=\{intro\} autoStart/);
  assert.doesNotMatch(intro, /HeroIntroBadge|<video/);
});
test('auto uses player size and network hints and never invents a rendition', () => {
  const options = [720, 480, 360].map(height => ({ height }));
  assert.equal(automaticQuality(options, { width: 1200 }), 720);
  assert.equal(automaticQuality(options, { width: 320, pixelRatio: 3 }), 360);
  assert.equal(automaticQuality(options, { width: 1200, saveData: true }), 360);
  assert.equal(automaticQuality(options, { effectiveType: 'slow-2g' }), 360);
  assert.equal(automaticQuality(options, { effectiveType: '3g' }), 480);
  assert.equal(automaticQuality(options, { downlink: .8 }), 360);
  assert.equal(automaticQuality(options, { downlink: 2 }), 480);
  assert.equal(automaticQuality([{ height: 480 }], { saveData: true }), 480);
});
