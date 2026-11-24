import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaTelemetry, mediaContext } from '../src/lib/media/telemetry.mjs';
import { analyzeActivity, activityDestination } from '../src/lib/visitorActivity.mjs';
import { activityFixtures } from '../src/lib/visitorActivityPreview.mjs';

function setup(preview = false) {
  let clock = 0, sequence = 0, visible = true;
  const events = [], video = { duration: 20, currentTime: 0, paused: false, seeking: false, playbackRate: 1, readyState: 4 };
  const tracker = createMediaTelemetry({ context: mediaContext({ id: 'movie', assetId: 'asset-v2' }, 'article', '/project'),
    preview, emit: (event, context) => events.push({ event, ...context }), now: () => clock, id: () => `play-${++sequence}`, visible: () => visible });
  const tick = (seconds = 1) => { clock += seconds * 1000; video.currentTime += seconds * video.playbackRate; tracker.sample(video); };
  return { tracker, video, tick, events, visibility: value => { visible = value; } };
}

test('playback emits one start, bounded checkpoints and cumulative summaries', () => {
  const { tracker, video, tick, events } = setup();
  tracker.request(); tracker.request(); tracker.playing(video); tracker.playing(video);
  for (let n = 0; n < 20; n++) tick();
  tracker.ended(video); tracker.dispose(video);
  assert.equal(events.filter(e => e.event === 'media_play_request').length, 1);
  assert.equal(events.filter(e => e.event === 'media_start').length, 1);
  assert.deepEqual(events.filter(e => e.event === 'media_progress').map(e => e.properties.progressPercent), [25, 50, 75, 95]);
  assert.equal(events.filter(e => e.event === 'media_complete').length, 1);
  assert.equal(tracker.metrics().watchedSeconds, 20);
  assert.equal(events.filter(e => e.event === 'media_summary').length, 2);
});
test('seeking to the end is not completion', () => {
  const { tracker, video, tick, events } = setup();
  tracker.playing(video); tick(); tracker.seeking(); video.currentTime = 19;
  tracker.sample(video); tick(); tracker.ended(video);
  assert.equal(tracker.metrics().watchedSeconds, 2);
  assert.equal(events.some(e => e.event === 'media_complete'), false);
});
test('hidden or suspended playback does not count; replay gets a fresh ID', () => {
  const { tracker, video, tick, visibility, events } = setup();
  tracker.playing(video); tick(); visibility(false); tick(5); visibility(true); tick();
  assert.equal(tracker.metrics().watchedSeconds, 1);
  tick(10); assert.equal(tracker.metrics().watchedSeconds, 1);
  tracker.ended(video); tracker.request(); video.currentTime = 0; tracker.playing(video);
  const starts = events.filter(e => e.event === 'media_start');
  assert.notEqual(starts[0].properties.playbackId, starts[1].properties.playbackId);
});
test('looping previews stay separate from explicit plays', () => {
  const { tracker, video, tick, events } = setup(true);
  tracker.playing(video); for (let n = 0; n < 20; n++) tick();
  video.currentTime = 0; tracker.sample(video); tick(); tracker.dispose(video);
  assert.equal(events.filter(e => e.event === 'media_preview_start').length, 1);
  assert.equal(events.some(e => ['media_start', 'media_progress', 'media_complete'].includes(e.event)), false);
});
test('stalls/actions are bounded; final flush is idempotent without URLs', () => {
  const { tracker, video, tick, events } = setup();
  tracker.playing(video); tracker.waiting(); tracker.waiting(); tick(); tracker.playing(video);
  assert.equal(tracker.metrics().stallCount, 1);
  for (let i = 0; i < 50; i++) tracker.action('quality', { quality: '360' });
  assert.equal(events.filter(e => e.event === 'media_action').length, 12);
  tracker.boundary(video, true); const before = events.length; tracker.dispose(video); tracker.dispose(video);
  assert.equal(events.length, before);
  assert.deepEqual(mediaContext({ id: 'x', src: 'https://private/?secret=abc' }).properties,
    { component: 'video', mediaId: 'x', mediaVersion: 'x', contentId: '', placement: 'article' });
});
test('telemetry exceptions cannot crash playback', () => {
  const t = createMediaTelemetry({ emit() { throw new Error('offline'); }, context: {}, id: () => 'id' });
  assert.doesNotThrow(() => t.request());
});
test('ID dedup and same-IP grouping never delete input or merge visitor counts', () => {
  const records = activityFixtures(), before = JSON.stringify(records);
  const normal = analyzeActivity(records), grouped = analyzeActivity(records, { windowMinutes: 15 });
  assert.equal(normal.counts.duplicates, 1);
  assert.equal(normal.counts.records, records.length - 1);
  assert.equal(normal.counts.records, grouped.counts.records);
  assert.equal(normal.counts.sessions, grouped.counts.sessions);
  assert.ok(normal.counts.groups > grouped.counts.groups);
  assert.ok(grouped.groups.some(g => g.network && g.sessions.length === 2));
  assert.equal(JSON.stringify(records), before);
});
test('shared IP and missing CAPTCHA do not flag people; threshold changes candidates', () => {
  const result = analyzeActivity(activityFixtures(), { risk: 'review' });
  assert.equal(result.counts.savedBot, 1); assert.equal(result.counts.candidates, 3);
  assert.ok(result.groups.every(g => !g.sessions.some(s => ['sample-session-a', 'sample-session-b'].includes(s.sessionId))));
  const higher = analyzeActivity(activityFixtures(), { threshold: 70, risk: 'review' });
  assert.equal(higher.counts.candidates, 0); assert.equal(higher.counts.savedBot, 1);
});
test('watch summaries use maximum, not sum; preview does not inflate deliberate watch time', () => {
  const { media } = analyzeActivity(activityFixtures());
  const intro = media.find(m => m.id === 'yuqi-intro'), preview = media.find(m => m.id === 'talknest');
  assert.equal(intro.watched, 60); assert.equal(intro.starts, 1); assert.equal(intro.completed, 1);
  assert.equal(preview.previews, 1); assert.equal(preview.starts, 0); assert.equal(preview.watched, 0);
  assert.equal(preview.reference.title, 'TalkNest');
});
test('missing identity, partial samples and different versions remain explicit', () => {
  const records = [0, 1].map(n => ({ eventName: 'media_summary', eventTime: new Date().toISOString(),
    properties: { component: 'video', mediaId: 'movie', mediaVersion: `v${n}`, playbackId: 'p', watchedSeconds: 5 } }));
  const result = analyzeActivity(records);
  assert.equal(result.counts.records, 2); assert.equal(result.media.length, 2);
  assert.equal(result.media[0].starts, 0); assert.equal(result.media[0].partial, 1);
  assert.equal(analyzeActivity([]).counts.records, 0);
});

test('click destinations and widget actions remain separate from autoplay', () => {
  const result = analyzeActivity(activityFixtures());
  assert.equal(result.clicks.length, 4);
  assert.equal(result.clicks.reduce((n, c) => n + c.count, 0), 4);
  assert.equal(result.clicks.find(c => c.label === 'GitHub link').href, 'https://github.com/YuqiGuo105');
  assert.equal(result.widgets.find(w => w.component === 'share').breakdown[0].action, 'link_copied');
  assert.equal(result.media.find(m => m.id === 'talknest').autoPreviews, 1);
  assert.equal(activityDestination({ eventName: 'outbound_link_clicked', targetUrl: 'javascript:alert(1)' }).href, null);
  assert.equal(activityDestination({ eventName: 'search_result_clicked', targetUrl: 'https://untrusted.example/x' }).href, null);
});

test('separate preview visits have fresh playback IDs and record their trigger', () => {
  const { tracker, video, events } = setup(true);
  tracker.request('viewport'); tracker.playing(video); tracker.finishPreview();
  tracker.request('button'); tracker.playing(video);
  const starts = events.filter(e => e.event === 'media_preview_start');
  assert.notEqual(starts[0].properties.playbackId, starts[1].properties.playbackId);
  assert.deepEqual(starts.map(e => e.properties.playTrigger), ['viewport', 'button']);
});

test('cover attribution uses only a public article path, never signed media URLs', () => {
  assert.equal(mediaContext({ href: '/work-single/abc-123' }).target, '/work-single/abc-123');
  for (const href of ['/admin/media', 'https://storage.example/file?token=secret', '/work-single/abc?token=secret']) {
    assert.equal(mediaContext({ href }).target, undefined);
  }
});
