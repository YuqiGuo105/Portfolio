// The site guide: one list of sections, served at /api/site/guide, read by the public MCP tool
// `get_site_guide`, and used by the voice call to bring a section into view.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SITE_ORIGIN, SITE_SECTIONS, publicSiteGuide, trustedSiteGuide } from '../src/lib/siteGuide.mjs';
import { BUILT_IN_GUIDE, VOICE_TARGETS, cleanVoiceGuide, liveConfig, showsInPlace, voiceGuide } from '../src/lib/voice/protocol.mjs';
import { createGuideLoader } from '../src/lib/voice/publicGuide.mjs';
import handler from '../pages/api/site/guide.js';

const page = { path: '/', title: 'Portfolio', text: 'Public page' };
const response = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } });

test('one list feeds the web guide, the voice destinations and the public endpoint', () => {
  assert.equal(new Set(SITE_SECTIONS.map(section => section.key)).size, SITE_SECTIONS.length);
  assert.equal(new Set(SITE_SECTIONS.map(section => section.targetId)).size, SITE_SECTIONS.length);
  for (const section of SITE_SECTIONS) {
    assert.match(section.key, /^home\.[a-zA-Z]+$/);
    assert.match(section.targetId, /^tour-[a-z-]+$/);
    assert.equal(section.href, `/#${section.targetId}`);
    assert.ok(section.covers.length > 20 && section.topics.length >= 3);
  }
  // The destinations a call had before this list existed, unchanged.
  assert.deepEqual(VOICE_TARGETS, {
    about: { href: '/#tour-about', label: 'About' },
    background: { href: '/#tour-background', label: 'My Background' },
    projects: { href: '/#tour-projects', label: 'Projects' },
    articles: { href: '/#tour-techblogs', label: 'My Blogs' },
    dashboard: { href: '/#tour-real-time-data', label: 'Real Time Data' },
    contact: { href: '/#tour-contact', label: 'Contact' },
  });
  // Every anchor in the list is one the pages really have.
  const pages = ['../pages/index.js', '../src/components/ContactForm.js', '../src/components/DashboardPanels.js']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  for (const section of SITE_SECTIONS) assert.ok(pages.includes(`id="${section.targetId}"`), section.targetId);
  const guide = readFileSync(new URL('../src/lib/webGuide.js', import.meta.url), 'utf8');
  assert.match(guide, /SITE_SECTIONS\.map\(\(\{ key, route, targetId, href \}\) => \[key, \{ route, targetId, href \}\]\)/);
});

test('the endpoint answers GET with public text and links to this site only', () => {
  const res = response();
  handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['Cache-Control'], /s-maxage=300/);
  assert.deepEqual(res.data, publicSiteGuide());
  assert.equal(res.data.schemaVersion, 1);
  for (const section of res.data.sections) {
    assert.deepEqual(Object.keys(section), ['key', 'label', 'covers', 'topics', 'url']);
    assert.ok(section.url.startsWith(`${SITE_ORIGIN}/#tour-`));
  }
  const refused = response();
  handler({ method: 'POST' }, refused);
  assert.equal(refused.code, 405); assert.equal(refused.headers.Allow, 'GET');
});

test('a guide read over the network changes wording only, never where a section points', () => {
  const remote = { schemaVersion: 1, sections: [
    { key: 'home.background', label: 'Click here', covers: '  Degrees   and employers. ', url: 'https://evil.example/#tour-background', href: 'https://evil.example', targetId: 'admin' },
    { key: 'home.background', covers: 'A second copy is ignored.' },
    { key: 'admin.secret', label: 'Admin', covers: 'Not a section of the site.', url: 'https://www.yuqi.site/admin' },
    { key: 'home.contact', covers: 42 },
  ] };
  const sections = trustedSiteGuide(remote);
  assert.deepEqual(sections.map(section => section.key), ['home.background', 'home.contact']);
  assert.equal(sections[0].covers, 'Degrees and employers.');
  assert.equal(sections[0].label, 'My Background'); assert.equal(sections[0].href, '/#tour-background'); assert.equal(sections[0].targetId, 'tour-background');
  assert.equal(sections[1].covers, SITE_SECTIONS.find(section => section.key === 'home.contact').covers, 'unusable wording falls back to the list');
  for (const bad of [null, {}, { sections: 'no' }, { sections: [] }, { sections: [{ key: 'elsewhere' }] }]) assert.equal(trustedSiteGuide(bad), null);
  // A section the answer no longer lists is no longer offered to the call.
  const guide = voiceGuide(sections, 'MCP');
  assert.deepEqual(guide, { source: 'MCP', sections: [
    { target: 'background', label: 'My Background', covers: 'Degrees and employers.' },
    { target: 'contact', label: 'Contact', covers: SITE_SECTIONS.find(section => section.key === 'home.contact').covers },
  ] });
  assert.deepEqual(liveConfig(page, undefined, guide).tools[0].functionDeclarations[2].parameters.properties.target.enum, ['background', 'contact']);
});

test('the call is told what each section holds and what showing one does', () => {
  const text = liveConfig(page).systemInstruction.parts[0].text;
  assert.match(text, /Site guide: the sections navigate_section can show/);
  assert.match(text, /"target":"background","label":"My Background","covers":"Education and work history/);
  assert.match(text, /shown means the page has already moved there/);
  assert.match(text, /offered_waiting_for_user means a button was offered/);
  assert.match(text, /never that anything else happened/);
  assert.deepEqual(liveConfig(page).tools[0].functionDeclarations[2].parameters.properties.target.enum, Object.keys(VOICE_TARGETS));
  // Whatever arrives as a guide, a call can only be given destinations this build knows.
  assert.deepEqual(cleanVoiceGuide({ sections: [{ target: 'admin', covers: 'x' }, { target: 'projects', label: 'Hacked', covers: 'x'.repeat(900) }] }),
    [{ target: 'projects', label: 'Projects', covers: 'x'.repeat(240) }]);
  assert.deepEqual(cleanVoiceGuide(null), BUILT_IN_GUIDE.sections);
  assert.equal(showsInPlace('/'), true);
  for (const path of ['/blogs', '/work-single/abc', undefined]) assert.equal(showsInPlace(path), false);
});

test('the guide comes from the MCP tool when it answers, and from this build when it does not', async () => {
  let time = 0, reads = 0;
  const mcp = { source: 'MCP', sections: [{ target: 'about', label: 'About', covers: 'From the tool.' }] };
  const load = createGuideLoader({ now: () => time, read: async () => { reads += 1; return mcp; } });
  assert.equal(await load(), mcp); assert.equal(await load(), mcp);
  assert.equal(reads, 1, 'kept for five minutes');
  time += 300001; await load(); assert.equal(reads, 2);

  let failures = 0;
  const down = createGuideLoader({ now: () => time, read: async () => { failures += 1; throw new Error('tool not published yet'); } });
  assert.equal(await down(), BUILT_IN_GUIDE);
  await down(); assert.equal(failures, 1, 'a failure is not retried on every call');
  time += 30001; await down(); assert.equal(failures, 2, 'and is tried again shortly');

  const slow = createGuideLoader({ timeoutMs: 20, read: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  assert.equal(await slow(), BUILT_IN_GUIDE, 'a call never waits long for the guide');
  const empty = createGuideLoader({ read: async () => ({ source: 'MCP', sections: [] }) });
  assert.equal(await empty(), BUILT_IN_GUIDE);
});
