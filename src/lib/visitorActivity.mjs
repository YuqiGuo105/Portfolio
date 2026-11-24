import { classifyVisitorSample, scoreVisitorSample } from './visitorBotDiagnostics.mjs';
import { outboundLinkDetails, visitorContentReference } from './visitorWorkbench.mjs';

const key = (...parts) => JSON.stringify(parts);
const number = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const time = event => Date.parse(event.eventTime || event.serverTime) || 0;
export const EVENT_LABELS = {
  page_view: 'Visited page', content_open: 'Opened article', project_open: 'Opened project',
  media_impression: 'Video visible', media_play_request: 'Requested playback',
  media_preview_start: 'Preview playing', media_start: 'Video playing', media_progress: 'Watched checkpoint',
  media_summary: 'Viewing summary', media_complete: 'Video completed', media_action: 'Player action',
  media_error: 'Playback error', widget_opened: 'Opened widget', widget_action: 'Widget action',
  search_performed: 'Searched', search_result_clicked: 'Opened search result', chat_started: 'Started chat',
  chat_completed: 'Chat completed', read_progress: 'Reading checkpoint', engaged_time: 'Reading time',
  outbound_link_clicked: 'Opened external link', content_impression: 'Content visible',
  recommendation_impression: 'Recommendations visible', recommendation_click: 'Opened recommendation',
  subscribe_started: 'Started subscription', subscribe_verified: 'Verified subscription', tool_used: 'Used agent tool',
};

const CLICK_EVENTS = new Set(['outbound_link_clicked', 'search_result_clicked', 'recommendation_click', 'content_open', 'project_open']);
export function activityDestination(event) {
  const external = outboundLinkDetails(event);
  if (external) return { ...external, path: external.href || '', external: true };
  if (!CLICK_EVENTS.has(event.eventName)) return null;
  const reference = visitorContentReference({ pageUrl: event.targetUrl, pageContent: event.targetContent });
  return { ...reference, label: reference.title, external: false };
}

// Read-only projection over a bounded sample. IP clusters are networks, not people.
export function analyzeActivity(input, { windowMinutes = 0, risk = 'all', threshold = 50 } = {}) {
  const sample = scoreVisitorSample(input);
  const classified = classifyVisitorSample(sample, { suspected: threshold, high: Math.max(80, threshold + 1) });
  const sessions = classified.sessions.map(session => ({ ...session,
    risk: session.storedBotCount ? 'saved_bot' : session.verdict === 'undetermined' ? 'unknown' : 'candidate' }));
  const retained = sessions.filter(session => risk === 'all' || (risk === 'exclude' ? session.risk === 'unknown' : session.risk !== 'unknown'));
  const entries = retained.flatMap(session => session.events.map(event => ({ event, session })));
  entries.sort((a, b) => time(a.event) - time(b.event));
  const width = [5, 15, 30].includes(Number(windowMinutes)) ? Number(windowMinutes) * 60000 : 0;
  const groups = [], latest = new Map();
  for (const entry of entries) {
    const { event, session } = entry;
    const ip = event.ipAddress || '';
    const network = width && ip && time(event) > 0;
    const identity = network ? key(event.siteId, 'network', ip) : session.key;
    let group = latest.get(identity);
    if (!group || (network && time(event) - group.start > width)) {
      group = { key: key(identity, groups.length), start: time(event), end: time(event), network: Boolean(network),
        events: [], sessions: new Map(), pages: new Set(), ip };
      latest.set(identity, group); groups.push(group);
    }
    group.events.push(event); group.sessions.set(session.key, session); group.pages.add(event.pageUrl || '/'); group.end = time(event);
  }
  const widgets = new Map(), media = new Map(), clicks = new Map();
  for (const { event, session } of entries) {
    const p = event.properties || {}, name = event.eventName || '';
    if (CLICK_EVENTS.has(name)) {
      const destination = activityDestination(event);
      const identity = key(name, destination.href || 'unrecorded', p.component || 'page');
      if (!clicks.has(identity)) clicks.set(identity, { key: identity, ...destination,
        event: name, component: p.component || 'page', count: 0, sessions: new Set() });
      const click = clicks.get(identity);
      click.count++; click.sessions.add(session.key);
    }
    const component = p.component || (name.startsWith('chat_') ? 'chat' : name.startsWith('search_') ? 'search' : null);
    if (component && !name.startsWith('media_')) {
      if (!widgets.has(component)) widgets.set(component, { component, events: 0, opens: 0, actions: 0, sessions: new Set(), breakdown: new Map() });
      const widget = widgets.get(component);
      widget.events++; widget.sessions.add(session.key);
      if (name === 'widget_opened') widget.opens++; else widget.actions++;
      const action = p.action || EVENT_LABELS[name] || name;
      widget.breakdown.set(action, (widget.breakdown.get(action) || 0) + 1);
    }
    if (!name.startsWith('media_') || !p.mediaId) continue;
    const identity = key(p.mediaId, p.mediaVersion || 'unknown', p.placement || 'unknown');
    if (!media.has(identity)) media.set(identity, { key: identity, id: p.mediaId, version: p.mediaVersion || 'unknown',
      placement: p.placement || 'unknown', page: event.pageUrl || '/',
      reference: visitorContentReference(event.targetContent || event.targetUrl
        ? { pageUrl: event.targetUrl, pageContent: event.targetContent } : event),
      impressions: new Set(), plays: new Map(), errors: 0 });
    const item = media.get(identity);
    if (name === 'media_impression') item.impressions.add(session.key);
    if (name === 'media_error') item.errors++;
    if (!p.playbackId) continue;
    const playKey = key(session.key, p.playbackId);
    if (!item.plays.has(playKey)) item.plays.set(playKey, { requested: false, started: false, preview: p.playMode === 'preview', complete: false, watched: 0, stalls: 0, trigger: p.playTrigger });
    const play = item.plays.get(playKey);
    if (p.playTrigger) play.trigger = p.playTrigger;
    if (name === 'media_play_request') play.requested = true;
    if (['media_start', 'media_preview_start'].includes(name)) play.started = true;
    if (name === 'media_complete') play.complete = true;
    // Summaries are cumulative; late delivery and retries must not inflate totals.
    play.watched = Math.max(play.watched, number(p.watchedSeconds));
    play.stalls = Math.max(play.stalls, number(p.stallCount));
  }
  return { sample, counts: { records: sample.eventCount, shown: entries.length, duplicates: sample.duplicates,
    sessions: retained.length, groups: groups.length, savedBot: sessions.filter(s => s.risk === 'saved_bot').length,
    candidates: sessions.filter(s => s.risk === 'candidate').length },
    groups: groups.reverse().map(group => ({ ...group, sessions: [...group.sessions.values()], pages: [...group.pages] })),
    clicks: [...clicks.values()].map(c => ({ ...c, sessions: c.sessions.size })).sort((a, b) => b.count - a.count),
    widgets: [...widgets.values()].map(w => ({ ...w, sessions: w.sessions.size, breakdown: [...w.breakdown].map(([action, count]) => ({ action, count })) })),
    media: [...media.values()].map(item => {
      const plays = [...item.plays.values()], explicit = plays.filter(p => !p.preview);
      return { ...item, plays: undefined, impressions: item.impressions.size,
        previews: plays.filter(p => p.preview && p.started).length, requests: explicit.filter(p => p.requested).length,
        autoPreviews: plays.filter(p => p.preview && p.started && p.trigger === 'viewport').length,
        starts: explicit.filter(p => p.started).length, completed: explicit.filter(p => p.complete).length,
        watched: Math.round(explicit.reduce((sum, p) => sum + p.watched, 0)),
        stalls: explicit.reduce((sum, p) => sum + p.stalls, 0), partial: explicit.filter(p => !p.started).length };
    }) };
}
