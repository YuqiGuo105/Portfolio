import assert from 'node:assert/strict';
import test from 'node:test';
import { visitorContentReference } from '../src/lib/visitorWorkbench.mjs';
import { createVisitorPreviewApi } from '../src/lib/visitorPreview.mjs';

test('timeline uses existing title and cover metadata with the recorded local destination', () => {
  assert.deepEqual(visitorContentReference({ pageUrl: 'https://www.yuqi.site/work-single/123?token=private#part', pageContent: { title: 'Portfolio Platform', type: 'project', coverUrl: 'https://images.example/cover.webp', canonicalUrl: '/work-single/other' } }), {
    href: '/work-single/123', path: '/work-single/123', title: 'Portfolio Platform', type: 'project', coverUrl: 'https://images.example/cover.webp',
  });
});

test('home, missing covers and legacy pagePath records have readable fallbacks', () => {
  assert.equal(visitorContentReference({ pageUrl: '/' }).title, 'Home');
  assert.equal(visitorContentReference({ pagePath: '/mcp-guide' }).title, 'MCP guide');
  assert.equal(visitorContentReference({ pageUrl: '/unknown' }).coverUrl, null);
  assert.equal(visitorContentReference().href, null);
  assert.equal(visitorContentReference().title, 'Page not recorded');
  assert.equal(visitorContentReference({ pageContent: { canonicalUrl: '/blogs' } }).href, '/blogs');
});

test('untrusted recorded destinations and unsafe covers are never executable links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//evil.example/x', 'https://yuqi.site.evil.example/x', 'https://user:secret@yuqi.site/x', '/\\evil.example', 'https://www.yuqi.site//evil.example']) {
    assert.equal(visitorContentReference({ pageUrl: value }).href, null, value);
  }
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,test', 'https://user:secret@images.example/x']) {
    assert.equal(visitorContentReference({ pageContent: { coverUrl: value } }).coverUrl, null);
  }
  assert.equal(visitorContentReference({ pageContent: { coverUrl: '/assets/images/blog3.jpg' } }).coverUrl, '/assets/images/blog3.jpg');
});

test('local session timeline returns cover metadata without a separate content lookup', async () => {
  const api = createVisitorPreviewApi();
  const result = await api.visitors.list({ sessionId: 'sample-content-session', view: 'visits' });
  assert.equal(result.items.length, 3);
  assert.equal(result.items.filter(event => visitorContentReference(event).coverUrl).length, 2);
  assert.ok(result.items.some(event => visitorContentReference(event).title === 'Home'));
});
