import { validateSessionRequest } from './visitorSessionRequest.mjs';

// Synthetic fixtures only. Never contains production visitor data or credentials.
export function createVisitorPreviewApi() {
  const now = Date.now();
  const events = Array.from({ length: 32 }, (_, index) => ({
    eventId: `sample-event-${index}`, siteId: 'preview.local', sessionId: index < 29 ? 'sample-jaipur-session' : 'sample-bot-session',
    anonymousId: 'sample-anonymous', eventTime: new Date(now - (33 - index) * 90000).toISOString(),
    serverTime: new Date(now - (33 - index) * 90000 + 1200).toISOString(),
    eventName: index % 3 === 0 ? 'page_view' : index % 3 === 1 ? 'read_progress' : 'click',
    pageUrl: index % 3 === 0 ? '/' : '/mcp-guide', deviceType: index < 29 ? 'mobile' : 'bot', browser: index < 29 ? 'Safari' : 'Chrome', os: index < 29 ? 'iOS' : 'Linux',
    city: index < 29 ? 'Jaipur' : '', region: index < 29 ? 'RJ' : '', country: index < 29 ? 'IN' : 'US',
    referrer: index < 29 ? 'https://linkedin.com/feed/?private=removed' : '', ipAddress: index < 29 ? '198.51.100.24' : '203.0.113.9', bot: index >= 29,
    userAgent: index < 29 ? 'Sample Safari iPhone' : 'Sample Googlebot/2.1',
    properties: index < 29 ? {} : { botAssessmentProvider: 'GOOGLE_RECAPTCHA_ENTERPRISE', botAssessmentStatus: 'VALID', botAssessmentHumanScore: 0.1, botAssessmentReasons: ['AUTOMATION'], botAssessmentVerifiedBot: true },
  }));
  const rules = [{ ruleId: 1, siteId: 'preview.local', name: 'Sample visitor alert', eventType: 'page_view', geoLevel: 'GLOBAL', geoAreaId: '', threshold: 1, comparator: '>=', granularity: '5m', cooldownSeconds: 1800, filters: { bot: 'EXCLUDE' }, enabled: false }];
  const pending = new Map();
  function matches(item, f) {
    if (f.bot === 'EXCLUDE' && item.bot || f.bot === 'ONLY' && !item.bot) return false;
    const names = { event: 'eventName', path: 'pageUrl', country: 'country', city: 'city', device: 'deviceType', browser: 'browser', referrer: 'referrer', sessionId: 'sessionId' };
    return Object.entries(names).every(([key, field]) => !f[key] || String(item[field]).toLowerCase().includes(f[key].toLowerCase())) && (!f.query || JSON.stringify(item).toLowerCase().includes(f.query.toLowerCase()));
  }
  function paginate(items, page, size) { return { items: items.slice(page * size, (page + 1) * size), page: { number: page, size, totalElements: items.length, totalPages: Math.ceil(items.length / size) } }; }
  return {
    visitors: {
      async list(filters) { const items = events.filter(item => matches(item, filters)).reverse(); return { ...paginate(items, filters.page || 0, filters.size || 50), summary: { totalEvents: items.length, uniqueVisitors: new Set(items.map(e => e.sessionId)).size, countries: new Set(items.map(e => e.country)).size, cities: new Set(items.map(e => e.city).filter(Boolean)).size } }; },
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
