import { outboundLinkDetails, scrollDepthPercent, visitorContentReference } from './visitorWorkbench.mjs';

// One record per visitor session: the pages they opened in order, how far they read each one,
// what they clicked there and what they watched. Built from the "page visits" records, so a
// session is the recorded session ID and nothing else; an IP address never joins two sessions.

const time = value => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; };
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const largest = (a, b) => (b == null ? a : a == null ? b : Math.max(a, b));
const first = item => time(item.visit?.firstEventTime || item.eventTime);
const last = item => time(item.visit?.lastEventTime || item.eventTime);

function pagePath(value) {
  if (!value) return '';
  try { return new URL(value, 'https://www.yuqi.site').pathname.replace(/\/+$/, '') || '/'; }
  catch { return String(value).split(/[?#]/)[0] || ''; }
}

const ACTION_LABELS = {
  search_performed: 'Searched the site', chat_started: 'Started a chat', chat_completed: 'Finished a chat',
  subscribe_started: 'Started subscribing', subscribe_verified: 'Confirmed a subscription',
  unsubscribe_completed: 'Unsubscribed', tool_used: 'Used an assistant tool',
  recommendation_dismiss: 'Dismissed a recommendation', widget_opened: 'Opened', widget_action: 'Used',
};
const CLICKS = { outbound_link_clicked: 'outbound', search_result_clicked: 'search', recommendation_click: 'recommendation',
  content_open: 'content', project_open: 'content' };
// Seen-on-screen records say nothing about what the visitor did.
const PASSIVE = new Set(['content_impression', 'recommendation_impression', 'media_impression']);

function play(entry, item) {
  const p = item.properties || {};
  const id = p.playbackId;
  if (!id) return;
  let current = entry.media.find(media => media.key === id);
  if (!current) {
    current = { key: id, mediaId: p.mediaId || '', placement: p.placement || '', preview: p.playMode === 'preview',
      trigger: p.playTrigger || '', title: item.targetContent?.title || '', startedAt: null, firstSeen: item.eventTime,
      started: false, completed: false, watchedSeconds: null, durationSeconds: null, coveragePercent: null,
      startupMs: null, stallCount: null, stallMs: null, errors: 0, quality: '', qualities: [], bitrateKbps: null,
      bandwidthKbps: null, downlinkMbps: null, effectiveType: '', actions: [] };
    entry.media.push(current);
  }
  if (p.playTrigger) current.trigger = p.playTrigger;
  if (['media_start', 'media_preview_start'].includes(item.eventName)) {
    current.started = true;
    current.startedAt = current.startedAt || item.eventTime;
    current.startupMs = largest(current.startupMs, number(p.startupMs));
  }
  if (item.eventName === 'media_complete') current.completed = true;
  if (item.eventName === 'media_error') current.errors++;
  if (item.eventName === 'media_action' && p.action) current.actions.push(String(p.action));
  // Viewing figures are cumulative per playback, so the largest value is the latest truth.
  for (const key of ['watchedSeconds', 'durationSeconds', 'coveragePercent', 'stallCount', 'stallMs']) {
    current[key] = largest(current[key], number(p[key]));
  }
  // Quality and connection are readings at a moment; keep the newest and remember every quality seen.
  const playing = typeof p.quality === 'string' && /^\d{3,4}p$/.test(p.quality) ? p.quality : '';
  if (playing && !current.qualities.includes(playing)) current.qualities.push(playing);
  if (time(item.eventTime) >= time(current.readAt)) {
    if (playing) current.quality = playing;
    for (const key of ['bitrateKbps', 'bandwidthKbps', 'downlinkMbps']) if (number(p[key]) != null) current[key] = number(p[key]);
    if (typeof p.effectiveType === 'string' && p.effectiveType) current.effectiveType = p.effectiveType;
    current.readAt = item.eventTime;
  }
}

function addToPage(entry, item) {
  entry.items.push(item);
  // The first record of a page may lack its title and cover; any later one that has them names the page.
  if (item.pageContent && !entry.named) { entry.reference = visitorContentReference(item); entry.named = true; }
  entry.first = Math.min(entry.first || Infinity, first(item) || Infinity);
  entry.last = Math.max(entry.last, last(item));
  const name = item.eventName || '';
  if (item.visit) {
    entry.opened = entry.opened || Boolean(item.visit.openedAt);
    entry.eventCount += Number(item.visit.eventCount) || 1;
    entry.scroll = largest(entry.scroll, scrollDepthPercent(item));
    for (const point of item.visit.checkpoints || []) {
      if (!entry.checkpoints.some(existing => existing.percent === point.percent)) entry.checkpoints.push(point);
    }
    return;
  }
  entry.eventCount++;
  if (name === 'page_view') entry.opened = true;
  if (name === 'read_progress') entry.scroll = largest(entry.scroll, scrollDepthPercent(item));
  if (name.startsWith('media_')) { if (name === 'media_impression') entry.videosSeen++; play(entry, item); return; }
  if (CLICKS[name]) {
    const outbound = outboundLinkDetails(item);
    const target = outbound ? null : visitorContentReference({ pageUrl: item.targetUrl, pageContent: item.targetContent });
    entry.clicks.push({ time: item.eventTime, kind: CLICKS[name],
      label: outbound ? outbound.label : target.title, href: outbound ? outbound.href : target.href,
      detail: item.properties?.component || '' });
    return;
  }
  if (PASSIVE.has(name) || ['read_progress', 'engaged_time', 'page_view'].includes(name)) return;
  const component = item.properties?.component, action = item.properties?.action;
  const label = ACTION_LABELS[name] || name.replace(/_/g, ' ');
  entry.actions.push({ time: item.eventTime,
    label: name.startsWith('widget_') ? `${label} ${component || 'a widget'}` : label,
    detail: name.startsWith('widget_') ? (action && action !== 'open' ? String(action).replace(/_/g, ' ') : '') : (action || component || '') });
}

/**
 * Group "page visits" records into sessions, newest first.
 * `boundary` is the time of the oldest record that was read when the window held more than
 * was read: a session starting within half an hour after it may have earlier activity.
 */
export function groupVisitorSessions(records, { boundary = null } = {}) {
  const sessions = new Map();
  const ordered = [...(Array.isArray(records) ? records : [])].sort((a, b) => first(a) - first(b));
  for (const item of ordered) {
    if (!item) continue;
    const key = item.sessionId ? JSON.stringify([item.siteId || '', item.sessionId]) : JSON.stringify(['event', item.eventId]);
    let session = sessions.get(key);
    if (!session) {
      session = { key, sessionId: item.sessionId || '', siteId: item.siteId || '', start: 0, end: 0, pages: [], items: [],
        visitor: { city: '', region: '', country: '', deviceType: '', browser: '', os: '', referrer: '', ipAddress: '', bot: null } };
      sessions.set(key, session);
    }
    session.items.push(item);
    session.start = Math.min(session.start || Infinity, first(item) || Infinity);
    session.end = Math.max(session.end, last(item));
    for (const field of ['city', 'region', 'country', 'deviceType', 'browser', 'os', 'referrer', 'ipAddress']) {
      if (!session.visitor[field] && typeof item[field] === 'string' && item[field]) session.visitor[field] = item[field];
    }
    if (item.bot === true) session.visitor.bot = true;
    else if (item.bot === false && session.visitor.bot === null) session.visitor.bot = false;

    const path = pagePath(item.pageUrl);
    // Reading records arrive grouped by session and page. Anything else done on a page after
    // another page was opened in between (a click, a video) is listed as coming back to it.
    let entry = session.pages[session.pages.length - 1];
    if (!entry || entry.path !== path) {
      entry = { key: `${session.pages.length}:${path}`, path, reference: visitorContentReference(item), first: 0, last: 0,
        opened: false, eventCount: 0, scroll: null, checkpoints: [], clicks: [], media: [], actions: [], videosSeen: 0, items: [] };
      session.pages.push(entry);
    }
    addToPage(entry, item);
  }

  return [...sessions.values()].map(session => {
    const pages = session.pages.map(page => ({ ...page, first: iso(page.first), last: iso(page.last),
      checkpoints: [...page.checkpoints].sort((a, b) => a.percent - b.percent),
      media: page.media.map(({ readAt, ...media }) => media), named: undefined }));
    const plays = pages.flatMap(page => page.media).filter(media => media.started && !media.preview);
    const newest = session.items.reduce((a, b) => (last(b) >= last(a) ? b : a));
    return {
      key: session.key, sessionId: session.sessionId, siteId: session.siteId,
      start: iso(session.start), end: iso(session.end), durationMs: Math.max(0, session.end - session.start),
      visitor: session.visitor, pages,
      totals: {
        pages: new Set(pages.map(page => page.path)).size,
        events: pages.reduce((sum, page) => sum + page.eventCount, 0),
        clicks: pages.reduce((sum, page) => sum + page.clicks.length, 0),
        actions: pages.reduce((sum, page) => sum + page.actions.length, 0),
        plays: plays.length,
        watchedSeconds: Math.round(plays.reduce((sum, media) => sum + (media.watchedSeconds || 0), 0)),
      },
      // The inspector and the per-record actions work on one stored record of the session.
      representative: newest,
      mayStartEarlier: boundary != null && session.start - time(boundary) < 30 * 60000,
    };
  }).sort((a, b) => time(b.end) - time(a.end));
}

const iso = value => (value && Number.isFinite(value) ? new Date(value).toISOString() : null);

export function formatSeconds(seconds) {
  if (seconds == null) return '';
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} s`;
  return `${Math.floor(whole / 60)} min${whole % 60 ? ` ${whole % 60} s` : ''}`;
}

/** "3 pages, 2 clicks, 42 s of video" — what the visitor did, in one line. */
export function sessionHeadline(session) {
  const { pages, clicks, actions, plays, watchedSeconds } = session.totals;
  const count = (value, word) => `${value} ${word}${value === 1 ? '' : 's'}`;
  return [
    count(pages, 'page'),
    clicks ? count(clicks, 'click') : '',
    actions ? count(actions, 'action') : '',
    plays ? `${formatSeconds(watchedSeconds)} of video` : '',
  ].filter(Boolean).join(', ');
}

/** How fast the connection was for one playback, in words, or '' when the browser gave nothing. */
export function connectionSummary(media) {
  const parts = [];
  if (media.bandwidthKbps != null) parts.push(`about ${formatRate(media.bandwidthKbps)} measured`);
  else if (media.downlinkMbps != null) parts.push(`about ${media.downlinkMbps} Mbps reported by the browser`);
  if (media.effectiveType) parts.push(media.effectiveType.toUpperCase());
  return parts.join(', ');
}

export const formatRate = kbps => (kbps >= 1000 ? `${Math.round(kbps / 100) / 10} Mbps` : `${Math.round(kbps)} kbps`);

/**
 * Everything recorded on one page, in the order it happened: the page opening, each scroll
 * checkpoint, each playback starting, each click and each other action.
 */
export function pageTimeline(page) {
  const rows = [];
  if (page?.first) rows.push({ time: page.first, kind: 'open', text: 'Opened the page', detail: '', href: '' });
  for (const point of page?.checkpoints || []) rows.push({ time: point.eventTime, kind: 'scroll', text: `Scrolled to ${point.percent}%`, detail: '', href: '' });
  for (const media of page?.media || []) {
    if (!media.started) continue;
    const name = media.title || (media.placement === 'home_intro' ? 'the homepage introduction' : 'a video');
    rows.push({ time: media.startedAt || media.firstSeen, kind: 'play', text: `${media.preview ? 'A preview played of' : 'Started'} ${name}`, detail: '', href: '' });
  }
  for (const click of page?.clicks || []) rows.push({ time: click.time, kind: 'click', text: `Clicked ${click.label}`, detail: click.detail ? `in ${click.detail}` : '', href: click.href || '' });
  for (const action of page?.actions || []) rows.push({ time: action.time, kind: 'action', text: action.label, detail: action.detail && !action.label.toLowerCase().includes(String(action.detail).toLowerCase()) ? action.detail : '', href: '' });
  // Array.prototype.sort is stable, so records sharing a timestamp keep the order above.
  return rows.filter(row => time(row.time)).sort((a, b) => time(a.time) - time(b.time));
}

/**
 * How long a page was open: until the next page was opened, which is exact, or for the last
 * page until its last recorded event, which is only a lower bound.
 */
export function timeOnPage(page, next) {
  const from = time(page?.first), until = next ? time(next.first) : time(page?.last);
  if (!from || !until || until - from < 1000) return null;
  return { ms: until - from, atLeast: !next };
}
