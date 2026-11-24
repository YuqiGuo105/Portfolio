export function activityFixtures(now = Date.now()) {
  const events = [];
  const add = (session, seconds, eventName, properties = {}, extra = {}) => {
    const stamp = new Date(now - 3600000 + seconds * 1000).toISOString();
    const event = { eventId: `preview-${events.length}`, siteId: 'preview', sessionId: session,
      eventName, eventTime: stamp, serverTime: stamp, pageUrl: '/', ipAddress: '192.0.2.20',
      userAgent: 'Mozilla/5.0', bot: false, properties: { botAssessmentStatus: 'NOT_REQUESTED_COST_POLICY', ...properties }, ...extra };
    events.push(event); return event;
  };
  add('sample-session-a', 0, 'page_view');
  const media = { component: 'video', mediaId: 'yuqi-intro', mediaVersion: 'v3', placement: 'home_intro', playbackId: 'sample-play-a', playMode: 'explicit' };
  for (const [seconds, event, props] of [[1, 'media_impression', {}], [3, 'media_play_request', {}], [3.4, 'media_start', { startupMs: 400 }],
    [18, 'media_progress', { progressPercent: 25, watchedSeconds: 15 }], [33, 'media_summary', { watchedSeconds: 30 }],
    [60, 'media_summary', { watchedSeconds: 57, coveragePercent: 95 }], [63, 'media_complete', { watchedSeconds: 60, coveragePercent: 100 }]]) {
    add('sample-session-a', seconds, event, { ...media, ...props });
  }
  events.push({ ...events[4] }); // A retry with the same ID, not a new watch.
  add('sample-session-a', 64, 'widget_opened', { component: 'chat', action: 'open' });
  add('sample-session-a', 75, 'chat_started', { component: 'chat' });
  add('sample-session-b', 120, 'page_view'); // Same network, different visitor/session.
  add('sample-session-b', 124, 'widget_opened', { component: 'search', action: 'open' });
  const project = { title: 'Content Intelligence Platform', type: 'project', canonicalUrl: '/work-single/example-content', coverUrl: '/demos/content-intelligence.webp' };
  add('sample-session-b', 128, 'search_result_clicked', { component: 'search' }, { targetUrl: project.canonicalUrl, targetContent: project });
  add('sample-session-b', 132, 'outbound_link_clicked', { component: 'social', action: 'github' }, { targetUrl: 'https://github.com/YuqiGuo105' });
  add('sample-session-a', 133, 'outbound_link_clicked', { component: 'social', action: 'linkedin' }, { targetUrl: 'https://www.linkedin.com/in/yuqiguo105/' });
  add('sample-session-b', 134, 'recommendation_click', { component: 'read-next' }, { targetUrl: project.canonicalUrl, targetContent: project });
  add('sample-session-a', 135, 'widget_action', { component: 'share', action: 'link_copied' });
  add('sample-session-a', 136, 'widget_opened', { component: 'monitoring', action: 'open' });
  add('sample-session-c', 900, 'page_view', {}, { ipAddress: '198.51.100.5', bot: true, userAgent: 'ExampleBot/1.0' });
  for (let n = 0; n < 3; n++) {
    const extra = { ipAddress: '203.0.113.8' };
    add(`burst-${n}`, 1000 + n / 10, 'page_view', {}, { ...extra, pageUrl: '/mcp-guide' });
    add(`burst-${n}`, 1002 + n / 10, 'page_view', {}, extra);
  }
  const talknest = { ipAddress: '192.0.2.44', targetUrl: '/work-single/example-talknest', targetContent: { title: 'TalkNest', type: 'project' } };
  add('sample-session-d', 1600, 'media_preview_start', { ...media, mediaId: 'talknest', mediaVersion: 'v1', placement: 'project_cover', playMode: 'preview', playTrigger: 'viewport', playbackId: 'preview-loop' }, talknest);
  add('sample-session-d', 1607, 'media_summary', { ...media, mediaId: 'talknest', mediaVersion: 'v1', placement: 'project_cover', playMode: 'preview', playbackId: 'preview-loop', watchedSeconds: 6 }, talknest);
  return events.reverse();
}
