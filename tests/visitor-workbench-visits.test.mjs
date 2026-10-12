import assert from 'node:assert/strict';
import test from 'node:test';
import { groupVisitorEvents, scrollDepthPercent, sessionWindow } from '../src/lib/visitorWorkbench.mjs';
import { createVisitorPreviewApi } from '../src/lib/visitorPreview.mjs';

const event = (id, percent, extra = {}) => ({ eventId: id, sessionId: 's1', siteId: 'test.site',
  eventName: percent === undefined ? 'page_view' : 'read_progress', pageUrl: '/',
  eventTime: `2026-10-12T10:00:${String(id).padStart(2, '0')}Z`, properties: { progressPercent: percent },
  ipAddress: '198.51.100.24', ...extra });

test('same session/page becomes one visit with peak depth and first-reached checkpoints', () => {
  const input = [event(0), event(1, 25), event(2, 50), event(3, 75), event(4, 100), event(5, 25)];
  const copy = structuredClone(input);
  const [result] = groupVisitorEvents(input.reverse());
  assert.equal(result.visit.eventCount, 6); assert.equal(scrollDepthPercent(result), 100);
  assert.deepEqual(result.visit.checkpoints.map(p => p.percent), [25,50,75,100]);
  assert.equal(result.visit.checkpoints[0].eventTime, copy[1].eventTime);
  assert.equal(result.visit.openedAt, copy[0].eventTime);
  assert.deepEqual(input.reverse(), copy, 'Original events remain intact');
  const range = sessionWindow(result, 24, Date.parse(copy[4].eventTime));
  assert.ok(Date.parse(range.to) > Date.parse(copy[5].eventTime));
});

test('no IP-based merging; missing sessions, sites, other pages and actions stay separate', () => {
  const input = [event(0), event(1, 25, { pageUrl: 'https://test.site/?x=1#top' }),
    event(2, 50, { sessionId: 's2' }), event(3, 75, { sessionId: null }), event(4, 100, { sessionId: null }),
    event(5, 50, { pageUrl: '/mcp-guide' }), event(6, 50, { siteId: 'other.site' }), event(7, undefined, { eventName: 'click' })];
  const result = groupVisitorEvents(input);
  assert.equal(result.length, 7); assert.equal(result.filter(e => !e.visit).length, 3);
  assert.equal(result.find(e => e.eventId === 1).visit.eventCount, 2);
});

test('preview groups the full query before pagination, raw evidence is unchanged', async () => {
  const api = createVisitorPreviewApi();
  const filters = { sessionId: 'sample-jaipur-session', hours: 24, size: 2, view: 'visits' };
  const first = await api.visitors.list(filters);
  assert.equal(first.summary.totalEvents, 29);
  assert.equal(first.page.totalElements, 11);
  assert.equal(first.items[0].visit.maxProgressPercent, 100);
  assert.deepEqual(first.items[0].visit.checkpoints.map(p => p.percent), [25,50,75,100]);
  const ids = new Set();
  for (let page = 0; page < first.page.totalPages; page++) {
    for (const item of (await api.visitors.list({ ...filters, page })).items) {
      assert.equal(ids.has(item.eventId), false); ids.add(item.eventId);
    }
  }
  assert.equal(ids.size, 11);
  const raw = await api.visitors.list({ ...filters, view: 'events' });
  assert.equal(raw.page.totalElements, 29); assert.equal(raw.items[0].visit, undefined);
});
