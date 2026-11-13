import { createHash } from 'node:crypto';
import { VARIANTS } from './core.mjs';

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const UUID = /^[a-f0-9-]{36}$/i;
export async function consumeDiscoveryEvent(event, { store, loadCatalog, now = Date.now }) {
  const time = Date.parse(event?.eventTime);
  if (!event || event.siteId !== 'yuqi.site' || event.consentState !== 'granted' || !/^(?:browser:[a-f0-9]{64}|[a-f0-9-]{36})$/i.test(event.eventId || '')
    || !event.sessionId || !Number.isFinite(time) || Math.abs(now() - time) > 86400000
    || /bot|crawler|spider|headless/i.test(event.uaRaw || '') || event.properties?.botAssessmentVerifiedBot === true
    || (Number.isFinite(event.properties?.botAssessmentHumanScore) && event.properties.botAssessmentHumanScore < .3)) return false;
  if (!['page_view', 'content_impression', 'content_open', 'search_performed', 'search_result_clicked', 'recommendation_impression', 'recommendation_click'].includes(event.eventType)) return false;
  const { items } = await loadCatalog();
  const p = event.properties || {}, session = hash(event.sessionId), stamp = new Date(time).toISOString().slice(0, 10);
  const issued = p.recommendationRequestId && UUID.test(p.recommendationRequestId) ? await store.get(`issued:${p.recommendationRequestId}`) : null;
  // One CAS updates counters AND idempotency receipts. Kafka offset acknowledgement follows this write.
  const aggregate = await store.update('stats', state => {
    if (!state || !state.windowStart || now() - state.windowStart > 30 * 86400000) state = { home: {}, pairs: {}, queries: {}, metrics: {}, receipts: {}, sessions: {}, days: {}, windowStart: now() };
    state.receipts ||= {}; state.sessions ||= {}; state.days ||= {};
    state.receipts = Object.fromEntries(Object.entries(state.receipts).filter(([, at]) => now() - at < 2 * 86400000));
    state.days = Object.fromEntries(Object.entries(state.days).filter(([key]) => now() - Date.parse(key.slice(0, 10)) < 2 * 86400000));
    if (state.receipts[event.eventId]) return state;
    state.sequence = (state.sequence || 0) + 1;
    // Stop learning at capacity rather than evicting live deduplication receipts.
    state.learningPaused = Object.keys(state.receipts).length >= 20000 || Object.keys(state.days).length >= 10000;
    if (state.learningPaused) return state;
    state.receipts[event.eventId] = now();
    state.sessions = Object.fromEntries(Object.entries(state.sessions).filter(([, value]) => now() - value.at < 1800000).slice(-2000));
    const s = state.sessions[session] ||= { at: now(), pages: [], searches: [], impressions: [], clicks: [] };
    s.at = now();
    const path = String(event.pageUrl || '').split(/[?#]/)[0];
    const page = items.find(item => item.url === path);
    if (event.eventType === 'page_view' && page && !s.pages.includes(page.id)) {
      for (const other of s.pages.slice(-5)) {
        const key = [other, page.id].sort().join('|'), dayKey = `${stamp}:${session}:pair:${key}`;
        if (!state.days[dayKey]) { state.pairs[key] = (state.pairs[key] || 0) + 1; state.days[dayKey] = true; }
      }
      s.pages = [...s.pages, page.id].slice(-20);
    }
    if (p.experimentId === 'home-v1' && ['direct', 'linkedin', 'github'].includes(p.campaign) && VARIANTS.includes(p.variant)) {
      const key = `${p.campaign}:${p.variant}`, dayKey = `${stamp}:${session}:home`;
      const row = state.home[key] ||= { views: 0, clicks: 0 };
      if (event.eventType === 'content_impression' && !state.days[dayKey]) { row.views++; state.days[dayKey] = { key, click: false }; }
      if (event.eventType === 'content_open' && state.days[dayKey]?.key === key && !state.days[dayKey].click) { row.clicks++; state.days[dayKey].click = true; }
    }
    if (issued && issued.kind === 'search' && event.eventType === 'search_performed') {
      if (!s.searches.includes(p.recommendationRequestId)) {
        state.metrics.searches = (state.metrics.searches || 0) + 1;
        s.searches.push(p.recommendationRequestId); s.searches = s.searches.slice(-50);
        const key = `${stamp}:${session}:query:${issued.query}`;
        if (issued.query && !state.days[key]) { state.queries[issued.query] = (state.queries[issued.query] || 0) + 1; state.days[key] = true; }
      }
    }
    if (issued && issued.kind === 'recommendation' && event.eventType === 'recommendation_impression' && !s.impressions.includes(p.recommendationRequestId)) {
      state.metrics.recommendations = (state.metrics.recommendations || 0) + 1; s.impressions.push(p.recommendationRequestId); s.impressions = s.impressions.slice(-50);
    }
    const rank = issued?.ids.indexOf(p.contentId) ?? -1;
    if (issued && rank >= 0 && !s.clicks.includes(p.recommendationRequestId)
      && ((issued.kind === 'search' && event.eventType === 'search_result_clicked' && s.searches.includes(p.recommendationRequestId))
        || (issued.kind === 'recommendation' && event.eventType === 'recommendation_click' && s.impressions.includes(p.recommendationRequestId)))) {
      const metric = issued.kind === 'search' ? 'searchClicks' : 'recommendationClicks';
      state.metrics[metric] = (state.metrics[metric] || 0) + 1;
      if (issued.kind === 'search') state.metrics.clickedReciprocalRank = (state.metrics.clickedReciprocalRank || 0) + 1 / (rank + 1);
      s.clicks.push(p.recommendationRequestId); s.clicks = s.clicks.slice(-50);
    }
    // Bounded rolling learning state, never raw queries, IPs, referrers, or visitor profiles.
    state.queries = Object.fromEntries(Object.entries(state.queries).sort((a, b) => b[1] - a[1]).slice(0, 500));
    state.pairs = Object.fromEntries(Object.entries(state.pairs).sort((a, b) => b[1] - a[1]).slice(0, 5000));
    return state;
  }, 30 * 86400);
  // Request handlers read only this compact projection, never deduplication/session working sets.
  // A retried event also repairs a failed projection write before its Kafka offset can advance.
  await store.update('learning-public', old => {
    if (old?.windowStart > aggregate.windowStart || (old?.windowStart === aggregate.windowStart && old.sequence > aggregate.sequence)) return old;
    const { home, pairs, queries, metrics, learningPaused, windowStart, sequence } = aggregate;
    return { home, pairs, queries, metrics, learningPaused, windowStart, sequence };
  }, 30 * 86400);
  return true;
}
