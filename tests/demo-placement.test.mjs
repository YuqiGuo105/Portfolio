import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { localDemos, localIntro, LOCAL_INTRO, LOCAL_DEMOS, demoForContent, formatVideoTime, canPreviewOnHover } from '../src/lib/media/demoCatalog.mjs';

test('local samples never turn on in production or hosted previews', () => {
  assert.equal(localDemos({ NODE_ENV: 'development', MEDIA_LOCAL_REVIEW: '1' }).length, 8);
  for (const env of [{}, { NODE_ENV: 'production', MEDIA_LOCAL_REVIEW: '1' },
    { NODE_ENV: 'development', MEDIA_LOCAL_REVIEW: '1', VERCEL: '1' },
    { NODE_ENV: 'development', MEDIA_LOCAL_REVIEW: '1', K_SERVICE: 'service' }]) {
    assert.deepEqual(localDemos(env), []);
    assert.equal(localIntro(env), null);
  }
});

test('a video belongs only to its associated article', () => {
  assert.equal(demoForContent(LOCAL_DEMOS, LOCAL_DEMOS[0].contentId), LOCAL_DEMOS[0]);
  assert.equal(demoForContent(LOCAL_DEMOS, 'project:another-project'), null);
  assert.equal(demoForContent(LOCAL_DEMOS, 'blog:7c3715bf-7722-4df5-9e83-5d7e9493ea2c'), null);
});

test('all referenced sample files exist and chapter times fit the clip', () => {
  for (const demo of LOCAL_DEMOS) {
    for (const key of ['src', 'preview', 'poster']) assert.ok(fs.statSync(new URL(`../public${demo[key]}`, import.meta.url)).size > 0);
    assert.equal(fs.statSync(new URL(`../public${demo.src}`, import.meta.url)).size, demo.bytes);
    assert.ok(demo.chapters.every((chapter, i) => chapter.seconds >= 0 && chapter.seconds < demo.seconds
      && (i === 0 || chapter.seconds > demo.chapters[i - 1].seconds)));
  }
  assert.equal(formatVideoTime(19.208), '0:19');
});

test('homepage uses the reference hero intro, not a demos link under projects', () => {
  const homepage = fs.readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8');
  assert.match(homepage, /<HeroIntroButton intro=\{intro\}/);
  assert.match(homepage, /introOpen && <HeroIntro/);
  assert.doesNotMatch(homepage, /HeroIntroBadge/);
  assert.doesNotMatch(homepage, /Watch demos|href="\/demos"/);
  assert.doesNotMatch(homepage, /PlatformRecordingPreview|<DemoVideo|id="platform-demo"/);
  const detail = fs.readFileSync(new URL('../pages/work-single/[id].js', import.meta.url), 'utf8');
  assert.match(detail, /demoForContent\(\(await loadMediaCatalog\(supabaseServer\)\).demos, `project:\$\{id\}`\)/);
  assert.match(detail, /<MediaEnhancer html=\{project.content\}/);
});

test('intro is a separate captioned asset and every project has its own preview', () => {
  assert.equal(localIntro({ NODE_ENV: 'development', MEDIA_LOCAL_REVIEW: '1' }), LOCAL_INTRO);
  assert.equal(LOCAL_INTRO.seconds, 60);
  for (const file of [LOCAL_INTRO.src, LOCAL_INTRO.captions, LOCAL_INTRO.poster]) assert.ok(fs.statSync(new URL(`../public${file}`, import.meta.url)).size > 0);
  assert.equal(fs.statSync(new URL(`../public${LOCAL_INTRO.src}`, import.meta.url)).size, LOCAL_INTRO.bytes);
  assert.equal(new Set(LOCAL_DEMOS.map(demo => demo.contentId)).size, 8);
  assert.equal(new Set(LOCAL_DEMOS.map(demo => demo.preview)).size, 8);
  const intro = fs.readFileSync(new URL('../src/components/media/HeroIntro.js', import.meta.url), 'utf8');
  assert.match(intro, /<DemoVideo demo=\{intro\} autoStart/);
  assert.match(intro, /event.stopPropagation\(\)/);
  const player = fs.readFileSync(new URL('../src/components/media/DemoVideo.js', import.meta.url), 'utf8');
  assert.match(player, /kind="captions"/);
  assert.match(player, /visibilitychange/);
  assert.match(player, /IntersectionObserver/);
  assert.match(intro, /createPortal/);
  assert.match(intro, /dialog.showModal\(\)/);
  assert.match(intro, /onCancel=/);
  assert.doesNotMatch(intro, /Play introduction in portrait/);
});

test('technical blogs have distinct article videos and hover previews; life remains excluded', () => {
  assert.equal(LOCAL_DEMOS.filter(demo => demo.contentId.startsWith('blog:')).length, 3);
  assert.ok(LOCAL_DEMOS.every(demo => !demo.href.startsWith('/life-blog')));
  const detail = fs.readFileSync(new URL('../pages/blog-single/[id].js', import.meta.url), 'utf8');
  assert.match(detail, /demoForContent\(\(await loadMediaCatalog\(supabaseServer\)\).demos, `blog:\$\{id\}`\)/);
  assert.match(detail, /<DemoVideo demo=\{demo\}/);
  const listing = fs.readFileSync(new URL('../pages/blogs.js', import.meta.url), 'utf8');
  assert.match(listing, /blog.blogType === 'technical' \? <ProjectHoverVideo/);
  const homepage = fs.readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8');
  assert.match(homepage, /<ProjectHoverVideo hoverBoundary=".archive-item"/);
});

test('all eight merged PRs fit the six-second clip and retain real PR links', () => {
  const demo = LOCAL_DEMOS.find(item => item.id === 'open-source');
  assert.equal(demo.seconds, 6);
  assert.equal(demo.chapters.length, 8);
  assert.deepEqual(demo.chapters.map(chapter => chapter.seconds), [0, .75, 1.5, 2.25, 3, 3.75, 4.5, 5.25]);
  assert.ok(demo.chapters.every(chapter => /^https:\/\/github.com\/.+\/pull\/\d+$/.test(chapter.href)));
});

test('touch, reduced motion, and data-saving never autoplay a cover preview', () => {
  const desktop = { pointerType: 'mouse', fineHover: true, reducedMotion: false, saveData: false };
  assert.equal(canPreviewOnHover(desktop), true);
  for (const changes of [{ pointerType: 'touch' }, { fineHover: false }, { reducedMotion: true }, { saveData: true }]) {
    assert.equal(canPreviewOnHover({ ...desktop, ...changes }), false);
  }
});

test('the real media library stays authenticated and the local review is read-only', () => {
  const library = fs.readFileSync(new URL('../pages/admin/media.js', import.meta.url), 'utf8');
  assert.match(library, /<AdminLayout><MediaLibraryContent \/><\/AdminLayout>/);
  assert.match(library, /if \(readOnly\) \{ setAssets\(previewAssets\); return; \}/);
  const preview = fs.readFileSync(new URL('../pages/admin/media-preview.js', import.meta.url), 'utf8');
  assert.match(preview, /if \(!demos.length\) return \{ notFound: true \}/);
  assert.doesNotMatch(preview, /service.role|auth.getSession|\.from\(/);
});
