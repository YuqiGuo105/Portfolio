import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CALL_GROUND, isDarkPage } from '../src/lib/voice/callTheme.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/components/LiveVoiceCall.module.css');
// The first rule holds the day colours, the rule keyed on the site's night class holds the others.
const block = selector => {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} is styled`);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};
const token = (rule, name) => rule.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
const day = block('.call {');
const night = block(':global(body.dark-skin) .call');

test('the floor under Mr. Pot is one colour in the scene and in the window, by day and by night', () => {
  assert.equal(token(day, '--vc-floor'), CALL_GROUND.light.floor);
  assert.equal(token(night, '--vc-floor'), CALL_GROUND.dark.floor);
  assert.notEqual(CALL_GROUND.light.floor, CALL_GROUND.dark.floor);
  const scene = read('../src/lib/voice/callScene.mjs');
  assert.match(scene, /CALL_GROUND\.dark : CALL_GROUND\.light/, 'the scene paints the ground from the shared colours');
  assert.match(scene, /theme\(night\)/, 'the scene can be repainted while a call is open');
  const stage = read('../src/components/VoiceCallStage.js');
  assert.match(stage, /createCallScene\(canvas\.current, \{ onFailure: fallback, dark: isDarkPage\(\) \}\)/, 'a call opened at night starts dark');
  assert.match(stage, /new MutationObserver\(\(\) => \{\s+if \(isDarkPage\(\) === night\) return;\s+night = !night; scene\.current\?\.theme\(night\);/, 'the stage follows the site switch');
});

test('night mode restyles every colour the day theme sets', () => {
  const names = rule => [...rule.matchAll(/(--vc-[a-z-]+):/g)].map(match => match[1]);
  const fixed = ['--vc-top', '--vc-rest'];
  for (const name of names(day).filter(name => !fixed.includes(name))) {
    assert.ok(token(night, name), `${name} has a night value`);
    assert.notEqual(token(night, name), token(day, name), `${name} differs at night`);
  }
  assert.match(css, /:global\(\.dark\) \.call/, 'a page-level dark class is honoured like in the chat window');
  assert.equal(/#[0-9a-f]{3,8}|rgba?\(/i.test(css.slice(css.indexOf('@keyframes arrive'), css.indexOf('/* The admin'))
    .replace(/--call-button-color: #fff/g, '').replace(/rgba\(20, 24, 28, 0\.0\d\)/g, '').replace(/#000/g, '')), false,
  'component rules take their colours from the theme, not from fixed values');
});

test('the page theme is read from the site switch', () => {
  const page = (bodyClass, match = false) => ({ body: { classList: { contains: name => bodyClass.split(' ').includes(name) } }, querySelector: () => (match ? {} : null) });
  assert.equal(isDarkPage(page('home page light-skin')), false);
  assert.equal(isDarkPage(page('dark-skin')), true);
  assert.equal(isDarkPage(page('', true)), true);
  assert.equal(isDarkPage(null), false);
});

test('the window keeps the size the page and its checks rely on', () => {
  assert.match(day, /width: 380px;[^}]*height: 580px;/);
  assert.match(css, /\.call\[data-collapsed="true"\] \{ height: 68px; grid-template-rows: 68px;/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.call, \.call \*/, 'motion can be switched off');
});
