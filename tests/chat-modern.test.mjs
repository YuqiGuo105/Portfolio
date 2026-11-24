import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import postcss from 'postcss';

const css = readFileSync(new URL('../styles/chatWidgetModern.css', import.meta.url), 'utf8');
const sheet = postcss.parse(css);
const root = '#__chat_widget_root#__chat_widget_root';
const declarations = (selector) => {
  const values = {};
  sheet.walkRules(selector, rule => rule.walkDecls(d => { values[d.prop] = d.value; }));
  return values;
};
const luminance = hex => {
  const values = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('modern skin stays within the widget and preserves panel and avatar geometry', () => {
  sheet.walkRules(rule => {
    for (const selector of rule.selectors) assert.ok(selector.includes(root), selector);
    assert.doesNotMatch(rule.selector, /avatar|mr-pot/i);
    if (rule.selector === `${root} .bot-container`) {
      rule.walkDecls(d => assert.ok(!/^(width|height|min-width|min-height|max-width|max-height|position|inset|top|left|right|bottom|transform)$/.test(d.prop), d.prop));
    }
  });
});

test('small text and links meet contrast in both themes', () => {
  for (const selector of [root, `.dark ${root},\nbody.dark-skin ${root}`]) {
    const vars = declarations(selector);
    for (const text of ['ink', 'soft', 'muted', 'accent']) {
      for (const surface of ['surface', 'raised']) {
        assert.ok(contrast(vars[`--cwm-${text}`], vars[`--cwm-${surface}`]) >= 4.5, `${selector}: ${text}/${surface}`);
      }
    }
  }
});

test('composer avoids iOS zoom and distinguishes disabled actions', () => {
  const input = declarations(`${root} .input-area textarea.cw-textbox,\n${root} .input-area textarea.cw-textbox:focus`);
  assert.equal(input['font-size'], '16px');
  const disabled = declarations(`${root} .input-area > div:has(> textarea.cw-textbox) > button[aria-disabled="true"],\n${root} .input-area > div:has(> textarea.cw-textbox) > button:disabled`);
  assert.equal(disabled.opacity, '0.55');
  let reduced = false, focus = false;
  sheet.walkAtRules('media', rule => { if (rule.params.includes('prefers-reduced-motion')) reduced = true; });
  sheet.walkRules(rule => { if (rule.selector.includes(':focus-visible')) focus = true; });
  assert.ok(reduced && focus);
  const menu = declarations(`${root} .cw-mode-menu`);
  assert.equal(menu.left, '50%');
  assert.equal(menu.transform, 'translateX(-50%)');
});

test('skin is lightweight and loaded after the base styles', () => {
  assert.ok(gzipSync(css).byteLength < 5000);
  sheet.walkAtRules(rule => assert.notEqual(rule.name, 'import'));
  assert.doesNotMatch(css, /url\(/);
  const app = readFileSync(new URL('../pages/_app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf('styles/chatWidgetModern.css') > app.indexOf('styles/chatWidget.css'));
});
