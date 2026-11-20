// Reserved documentation IPs and invented sessions, never copied from visitor logs.
export function diagnosticPreviewEvents(now) {
  const events = [];
  const add = (sessionId, ipAddress, offset, eventName, pageUrl, properties = {}, bot = false) => events.push({
    eventId: `${sessionId}-${events.length}`, siteId: 'preview.local', sessionId, ipAddress, eventName, pageUrl, properties, bot,
    eventTime: new Date(now + offset).toISOString(), serverTime: new Date(now + offset + 100).toISOString(),
    city: 'Sample location', country: 'US', deviceType: 'desktop', browser: 'Chrome', os: 'Windows', userAgent: 'Sample Chrome browser',
  });
  for (let i = 0; i < 3; i++) {
    const session = `sample-concurrent-${i + 1}`, ip = '192.0.2.10', start = -180000 + i * 90;
    add(session, ip, start, 'page_view', '/mcp-guide');
    add(session, ip, start + 700, 'read_progress', '/mcp-guide', { progressPercent: 50 });
    add(session, ip, start + 2200, 'read_progress', '/mcp-guide', { progressPercent: 100 });
    add(session, ip, start + 4000, 'page_view', '/');
  }
  for (let i = 0; i < 3; i++) {
    const session = `sample-repeated-${i + 1}`, ip = '192.0.2.20', start = -90000 + i * 120;
    add(session, ip, start, 'page_view', '/');
    add(session, ip, start + 8000, 'page_view', '/mcp-guide');
  }
  add('sample-fast-only', '192.0.2.30', -60000, 'page_view', '/mcp-guide');
  add('sample-fast-only', '192.0.2.30', -59400, 'read_progress', '/mcp-guide', { progressPercent: 25 });
  add('sample-fast-only', '192.0.2.30', -58000, 'read_progress', '/mcp-guide', { progressPercent: 100 });
  add('sample-ordinary', '192.0.2.40', -50000, 'page_view', '/');
  add('sample-ordinary', '192.0.2.40', -28000, 'page_view', '/mcp-guide');
  add('sample-ordinary', '192.0.2.40', -15000, 'read_progress', '/mcp-guide', { progressPercent: 25 });
  return events;
}
