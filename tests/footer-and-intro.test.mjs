import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { INTRO_SEGMENTS } from '../src/lib/media/introPlan.mjs';

test('footer actions override legacy white hover text in both themes', () => {
  const css = readFileSync(new URL('../src/layout/Footer.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.footer\.footer \.terminal:hover/);
  assert.match(css, /color: var\(--action-hover-text\); background: var\(--action-hover-bg\)/);
  assert.match(css, /body\.light-skin/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.terminal:focus-visible \.historyIcon/);
});

test('intro keeps the accepted PR pacing and adds three technical topics within one minute', () => {
  assert.equal(INTRO_SEGMENTS.reduce((sum, segment) => sum + segment.seconds, 0), 60);
  assert.equal(INTRO_SEGMENTS[0].seconds, 8);
  assert.equal(INTRO_SEGMENTS.find(segment => segment.source === 'open-source').seconds, 6);
  assert.equal(INTRO_SEGMENTS.filter(segment => segment.source.startsWith('blog-')).length, 3);
  for (const segment of INTRO_SEGMENTS) {
    assert.ok(existsSync(new URL(`../public/demos/${segment.source}.mp4`, import.meta.url)));
    assert.ok(segment.end > segment.start && segment.seconds > 0);
  }
});
