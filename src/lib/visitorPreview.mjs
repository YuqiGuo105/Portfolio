import { validateSessionRequest } from './visitorSessionRequest.mjs';
import { sampleHistory, previewOverview } from './visitorOverviewPreview.mjs';
import { groupVisitorEvents } from './visitorWorkbench.mjs';
import { groupVisitorSessions } from './visitorSessions.mjs';
import { createVisitorGovernancePreview } from './visitorGovernancePreview.mjs';
import { diagnosticPreviewEvents } from './visitorBotDiagnosticsPreview.mjs';

// Two made-up visits that show what the Visitors view says about reading and video: one on a fast
// connection that watched most of the introduction, one on a slow connection that gave up early.
function journeySamples(now) {
  const events = [];
  const add = (session, seconds, eventName, pageUrl, properties = {}, extra = {}) => events.push({
    eventId: `sample-journey-${events.length}`, siteId: 'preview.local', sessionId: session.id, anonymousId: `${session.id}-anon`,
    eventName, eventTime: new Date(now - 20 * 60000 + seconds * 1000).toISOString(), serverTime: new Date(now - 20 * 60000 + seconds * 1000 + 900).toISOString(),
    pageUrl, bot: false, properties, ...session.client, ...extra });
  const fast = { id: 'sample-reader-session', client: { deviceType: 'desktop', browser: 'Chrome', os: 'macOS', city: 'Seattle', region: 'WA', country: 'US',
    referrer: 'https://www.google.com/', ipAddress: '198.51.100.71', userAgent: 'Sample Chrome macOS' } };
  const slow = { id: 'sample-slow-video-session', client: { deviceType: 'mobile', browser: 'Chrome', os: 'Android', city: 'Pune', region: 'MH', country: 'IN',
    referrer: '', ipAddress: '203.0.113.52', userAgent: 'Sample Chrome Android' } };
  const project = '/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c';
  const projectContent = { title: 'Portfolio Platform', type: 'project', coverUrl: '/assets/images/mcp-guide/claude-public-tools.png' };
  const intro = { component: 'video', mediaId: 'yuqi-intro', mediaVersion: 'v5', placement: 'home_intro', playMode: 'explicit', playTrigger: 'button', durationSeconds: 60 };
  const fastLine = { quality: '720p', bitrateKbps: 2800, bandwidthKbps: 5200, downlinkMbps: 10, effectiveType: '4g' };

  add(fast, 0, 'page_view', '/');
  add(fast, 3, 'media_impression', '/', intro);
  add(fast, 6, 'media_play_request', '/', { ...intro, playbackId: 'sample-play-fast' });
  add(fast, 6.4, 'media_start', '/', { ...intro, playbackId: 'sample-play-fast', startupMs: 420, ...fastLine });
  add(fast, 22, 'media_progress', '/', { ...intro, playbackId: 'sample-play-fast', progressPercent: 25, watchedSeconds: 15, coveragePercent: 25, ...fastLine });
  add(fast, 37, 'media_progress', '/', { ...intro, playbackId: 'sample-play-fast', progressPercent: 50, watchedSeconds: 30, coveragePercent: 50, ...fastLine, quality: '1080p', bitrateKbps: 5000, bandwidthKbps: 8400 });
  add(fast, 49, 'media_summary', '/', { ...intro, playbackId: 'sample-play-fast', watchedSeconds: 42, coveragePercent: 70, stallCount: 0, stallMs: 0, ...fastLine, quality: '1080p', bitrateKbps: 5000, bandwidthKbps: 8400 });
  add(fast, 52, 'read_progress', '/', { progressPercent: 25 });
  add(fast, 58, 'read_progress', '/', { progressPercent: 50 });
  add(fast, 70, 'project_open', '/', { component: 'projects' }, { targetUrl: project, targetContent: projectContent });
  add(fast, 71, 'page_view', project, {}, { pageContent: projectContent });
  for (const [at, percent] of [[84, 25], [101, 50], [130, 75], [162, 100]]) add(fast, at, 'read_progress', project, { progressPercent: percent }, { pageContent: projectContent });
  add(fast, 170, 'outbound_link_clicked', project, { component: 'article', action: 'github' }, { targetUrl: 'https://github.com/example/portfolio', pageContent: projectContent });
  add(fast, 176, 'widget_opened', project, { component: 'chat', action: 'open' }, { pageContent: projectContent });
  add(fast, 190, 'chat_started', project, { component: 'chat' }, { pageContent: projectContent });
  add(fast, 240, 'page_view', '/mcp-guide');
  add(fast, 262, 'read_progress', '/mcp-guide', { progressPercent: 25 });

  const slowLine = { quality: '360p', bitrateKbps: 600, bandwidthKbps: 650, downlinkMbps: 1.2, effectiveType: '3g' };
  add(slow, 400, 'page_view', '/');
  add(slow, 404, 'media_play_request', '/', { ...intro, playbackId: 'sample-play-slow' });
  add(slow, 407.9, 'media_start', '/', { ...intro, playbackId: 'sample-play-slow', startupMs: 3900, ...slowLine });
  add(slow, 431, 'media_summary', '/', { ...intro, playbackId: 'sample-play-slow', watchedSeconds: 12, coveragePercent: 20, stallCount: 3, stallMs: 7400, ...slowLine });
  return events;
}

// Synthetic fixtures only. Never contains production visitor data or credentials.
export function createVisitorPreviewApi() {
  const now = Date.now();
  const socialLinks = [
    ['github', 'https://github.com/example'],
    ['linkedin', 'https://www.linkedin.com/in/example/'],
    ['instagram', 'https://www.instagram.com/example/'],
    ['leetcode', 'https://leetcode.com/u/example/'],
  ];
  const contentSamples = [
    { pageUrl: '/', pageContent: null },
    { pageUrl: '/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c', pageContent: { title: 'Portfolio Platform', type: 'project', coverUrl: '/assets/images/mcp-guide/claude-public-tools.png' } },
    { pageUrl: '/blog-single/preview-article', pageContent: { title: 'Reliable event delivery and recovery', type: 'tech blog', coverUrl: '/assets/images/blog3.jpg' } },
  ].map((entry, index) => ({ ...entry, eventId: `sample-content-${index}`, siteId: 'preview.local', sessionId: 'sample-content-session', eventName: 'page_view', eventTime: new Date(now - (4 - index) * 60000).toISOString(), deviceType: 'desktop', browser: 'Chrome', os: 'macOS', bot: false }));
  const baseEvents = [...sampleHistory(now), ...contentSamples, ...Array.from({ length: 32 }, (_, index) => ({
    eventId: `sample-event-${index}`, siteId: 'preview.local', sessionId: index < 29 ? 'sample-jaipur-session' : 'sample-bot-session',
    anonymousId: 'sample-anonymous', eventTime: new Date(now - (33 - index) * 90000).toISOString(),
    serverTime: new Date(now - (33 - index) * 90000 + 1200).toISOString(),
    eventName: index % 3 === 0 ? 'page_view' : index % 3 === 1 ? 'read_progress' : 'outbound_link_clicked',
    targetUrl: index % 3 === 2 ? socialLinks[Math.floor(index / 3) % socialLinks.length][1] : null,
    pageUrl: index % 3 === 0 ? '/' : '/mcp-guide', deviceType: index < 29 ? 'mobile' : 'bot', browser: index < 29 ? 'Safari' : 'Chrome', os: index < 29 ? 'iOS' : 'Linux',
    city: index < 29 ? 'Jaipur' : '', region: index < 29 ? 'RJ' : '', country: index < 29 ? 'IN' : 'US',
    referrer: index < 29 ? 'https://linkedin.com/feed/?private=removed' : '', ipAddress: index < 29 ? '198.51.100.24' : '203.0.113.9', bot: index >= 29,
    userAgent: index < 29 ? 'Sample Safari iPhone' : 'Sample Googlebot/2.1',
    properties: { ...(index % 3 === 2 ? { action: socialLinks[Math.floor(index / 3) % socialLinks.length][0], component: 'footer' } : {}), ...(index % 3 === 1 ? { progressPercent: [25, 50, 75, 100][Math.floor(index / 3) % 4] } : {}), ...(index < 29 ? {} : { botAssessmentProvider: 'GOOGLE_RECAPTCHA_ENTERPRISE', botAssessmentStatus: 'VALID', botAssessmentHumanScore: 0.1, botAssessmentReasons: ['AUTOMATION'], botAssessmentVerifiedBot: true }) },
  }))].sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  const events = [...baseEvents, ...diagnosticPreviewEvents(now), ...journeySamples(now)].sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  const rules = [{ ruleId: 1, siteId: 'preview.local', name: 'Sample visitor alert', eventType: 'page_view', geoLevel: 'GLOBAL', geoAreaId: '', threshold: 1, comparator: '>=', granularity: '5m', cooldownSeconds: 1800, filters: { bot: 'EXCLUDE' }, enabled: false }];
  const pending = new Map();
  const governance = createVisitorGovernancePreview(baseEvents, now);
  function matches(item, f) {
    if (f.bot === 'EXCLUDE' && item.bot !== false || f.bot === 'ONLY' && item.bot !== true) return false;
    const to = f.to ? Date.parse(f.to) : now;
    const from = f.from ? Date.parse(f.from) : to - (f.hours || 24) * 3600000;
    if (Date.parse(item.eventTime) < from || Date.parse(item.eventTime) >= to) return false;
    const names = { event: 'eventName', path: 'pageUrl', country: 'country', city: 'city', device: 'deviceType', browser: 'browser', referrer: 'referrer', sessionId: 'sessionId' };
    return Object.entries(names).every(([key, field]) => !f[key] || (['path', 'referrer'].includes(key) ? String(item[field] || '').toLowerCase().includes(f[key].toLowerCase()) : String(item[field] || '').toLowerCase() === f[key].toLowerCase())) && (!f.query || JSON.stringify(item).toLowerCase().includes(f.query.toLowerCase()));
  }
  function paginate(items, page, size) { return { items: items.slice(page * size, (page + 1) * size), page: { number: page, size, totalElements: items.length, totalPages: Math.ceil(items.length / size) } }; }
  return {
    visitorGovernance: governance,
    visitors: {
      async overview(filters) { return previewOverview(events.filter(item => matches(item, filters)), filters, now); },
      async list(filters) { const items = events.filter(item => matches(item, filters)).reverse(); const visits = groupVisitorEvents(items); return { ...paginate(filters.view === 'sessions' ? groupVisitorSessions(visits) : filters.view === 'visits' ? visits : items, filters.page || 0, filters.size || 50), view: filters.view || 'events', ...(filters.view === 'sessions' ? { sample: { activities: visits.length, totalActivities: visits.length, complete: true } } : {}), summary: { totalEvents: items.length, uniqueVisitors: new Set(items.map(e => e.sessionId)).size, countries: new Set(items.map(e => e.country)).size, cities: new Set(items.map(e => e.city).filter(Boolean)).size } }; },
      async sessionEvidence(body) {
        const { sessionId, window, page } = validateSessionRequest(body);
        const all = events.filter(e => e.sessionId === sessionId && e.eventTime >= window.from && e.eventTime < window.to).reverse();
        const output = paginate(all, page.number, page.size);
        output.items = output.items.map(item => ({ ...item, automationEvidence: { verdict: item.bot ? 'AUTOMATION_INDICATED' : 'UNDETERMINED', matches: item.bot ? ['Sample Googlebot'] : [] } }));
        return { ...output, trafficAnalysis: { detector: 'Sample fixture (not a live provider)', verdict: output.items.some(e => e.bot) ? 'AUTOMATION_INDICATED' : 'UNDETERMINED', sampledEvents: output.items.length, windowTotalEvents: all.length, completeWindow: page.number === 0 && output.items.length === all.length, counts: { automationIndicated: output.items.filter(e => e.bot).length, storedFlagConflicts: 0 }, limitations: ['Synthetic local preview. This is not a real visitor assessment.', 'A non-bot flag and a mobile browser do not prove a human visitor.'] } };
      },
      async download(filters) { const items = events.filter(item => matches(item, filters)); return { blob: new Blob([filters.format === 'csv' ? 'eventId,eventName\n' + items.map(i => `${i.eventId},${i.eventName}`).join('\n') : JSON.stringify(items)], { type: filters.format === 'csv' ? 'text/csv' : 'application/json' }), filename: `sample-visitors.${filters.format}` }; },
    },
    visitorIntelligence: { async overview() { return {}; } },
    visitorAlerts: {
      async overview() { return { rules: [...rules], incidents: [], summary: { total: 0, notified: 0 } }; },
      async prepareChange({ ruleId, patch, reason }) { const before = rules.find(r => r.ruleId === ruleId) || {}; const changeId = `sample-${pending.size + 1}`; const result = { changeId, ruleId, after: patch, diff: Object.fromEntries(Object.entries(patch).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])).map(([k, v]) => [k, { from: before[k] ?? null, to: v }])), warnings: ['Local preview only. Applying updates this sample in memory; no email or production rule is created.'], reason }; pending.set(changeId, result); return result; },
      async applyChange(id) { const p = pending.get(id); if (!p) throw new Error('Unknown sample change'); const index = rules.findIndex(r => r.ruleId === p.ruleId); const updated = { ...p.after, ruleId: p.ruleId || rules.length + 1 }; if (index < 0) rules.push(updated); else rules[index] = updated; pending.delete(id); return updated; },
    },
  };
}
