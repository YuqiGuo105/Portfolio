// Local, deterministic sample activity. This module is only used by the dev preview.
export function sampleHistory(now) {
  const countries = ['US', 'IN', 'GB', 'DE', 'SG'];
  const paths = ['/', '/mcp-guide', '/works', '/blogs', '/cv'];
  return Array.from({ length: 30 }, (_, day) => Array.from({ length: 26 + (day * 13 % 49) + (day === 4 ? 78 : 0) }, (_, i) => {
    const bot = (i + day) % 8 === 0 ? null : i % (day === 4 ? 2 : 5) === 0;
    return {
      eventId: `sample-history-${day}-${i}`, siteId: 'preview.local',
      eventTime: new Date(now - (day * 24 + 2 + (i * 7 % 22)) * 3600000 - i * 11000).toISOString(),
      eventName: i % 3 ? 'page_view' : 'read_progress', sessionId: `sample-session-${day}-${Math.floor(i / 3)}`,
      pageUrl: paths[i % paths.length], country: countries[i % countries.length],
      city: ['Lehi', 'Jaipur', 'London', 'Berlin', 'Singapore'][i % 5], region: '',
      deviceType: i % 3 ? 'desktop' : 'mobile', browser: i % 3 ? 'Chrome' : 'Safari', os: i % 3 ? 'macOS' : 'iOS',
      referrer: ['', 'https://linkedin.com/feed/', 'https://google.com/search?q=sample', 'https://github.com/YuqiGuo105'][i % 4],
      bot, properties: {},
    };
  })).flat();
}

export function previewOverview(events, { from, to, hours = 24 }, now) {
  const end = to ? Date.parse(to) : now;
  const start = from ? Date.parse(from) : end - hours * 3600000;
  const hourly = end - start <= 24 * 3600000;
  const step = (hourly ? 1 : 24) * 3600000;
  const timeline = new Map();
  for (let time = Math.floor(start / step) * step; time < end; time += step) {
    timeline.set(time, { time: new Date(time).toISOString(), events: 0, pageViews: 0, sessions: new Set() });
  }
  const summary = { events: events.length, pageViews: 0, sessions: new Set(), countries: new Set(), likelyPeople: 0, bots: 0, unknown: 0 };
  const dimensions = Object.fromEntries(['pages', 'countries', 'devices', 'referrers'].map(key => [key, new Map()]));
  for (const event of events) {
    const point = timeline.get(Math.floor(Date.parse(event.eventTime) / step) * step);
    if (!point) continue;
    point.events++;
    if (event.eventName === 'page_view') { point.pageViews++; summary.pageViews++; }
    if (event.sessionId) { point.sessions.add(event.sessionId); summary.sessions.add(event.sessionId); }
    if (event.country) summary.countries.add(event.country);
    summary[event.bot == null ? 'unknown' : event.bot ? 'bots' : 'likelyPeople']++;
    const fields = { countries: event.country || null, devices: event.deviceType || null,
      referrers: event.referrer ? new URL(event.referrer).hostname : 'Direct',
      ...(event.eventName === 'page_view' ? { pages: new URL(event.pageUrl, 'https://preview.local').pathname } : {}),
    };
    for (const [key, value] of Object.entries(fields)) dimensions[key].set(value, (dimensions[key].get(value) || 0) + 1);
  }
  return {
    from: new Date(start).toISOString(), to: new Date(end).toISOString(), bucket: hourly ? 'hour' : 'day', timezone: 'UTC',
    summary: { ...summary, sessions: summary.sessions.size, countries: summary.countries.size },
    timeline: [...timeline.values()].map(point => ({ ...point, sessions: point.sessions.size })),
    rankings: Object.fromEntries(Object.entries(dimensions).map(([key, counts]) => [key, [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value))).slice(0, 5)])),
  };
}
