import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as links from '../src/lib/share/link.mjs';
import * as codes from '../src/lib/share/qr.mjs';
import * as posters from '../src/lib/share/poster.mjs';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:3150/card' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'), { createRoot } = require('react-dom/client'), { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/share/ShareSheet.js', import.meta.url), 'utf8'), {
  filename: 'ShareSheet.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
let root, generated, copied, touched, downloads, blobs, exported, closed, makePoster, makeBlob;
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name.endsWith('.css')) return { __esModule: true, default: {} };
  if (name.endsWith('link.mjs')) return links;
  if (name.endsWith('qr.mjs')) return codes;
  if (name.endsWith('open.mjs')) return { touch: event => touched.push(event) };
  if (name.endsWith('poster.mjs')) return { ...posters, posterCanvas: async value => { generated.push(value); return makePoster(value); }, canvasBlob: async canvas => { exported.push(canvas); return makeBlob(canvas); } };
  return require(name);
}, exports);
const content = { kind: 'card', heading: 'Share my card', title: 'Yuqi Guo', role: 'Software Engineer', url: '/card', image: '/assets/images/yuqi-guo-card-320.jpg' };
const label = node => node.getAttribute('aria-label') || node.textContent.trim();
const button = name => [...document.querySelectorAll('button')].find(node => label(node) === name);
const click = name => act(async () => Simulate.click(button(name)));
const render = (value = content) => act(async () => root.render(React.createElement(exports.default, { content: value, onClose: () => closed++ })));
beforeEach(() => {
  document.body.innerHTML = '<button id="opener">Share</button><div id="root"></div>';
  document.documentElement.style.overflow = 'auto'; document.getElementById('opener').focus();
  root = createRoot(document.getElementById('root'));
  generated = []; copied = []; touched = []; downloads = []; blobs = []; exported = []; closed = 0;
  makePoster = async () => ({ width: 1080, height: 1350 }); makeBlob = async () => new Blob(['png'], { type: 'image/png' });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => copied.push(value) } });
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  document.execCommand = () => false;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, name: this.download }); };
  URL.createObjectURL = blob => { blobs.push(blob); return `blob:share-${blobs.length}`; };
  URL.revokeObjectURL = () => {};
});
afterEach(async () => { if (root) await act(() => root.unmount()); root = null; });
after(() => dom.window.close());

test('the initial sheet shows the link and QR without rendering a poster or calling the server', async () => {
  await render();
  assert.equal(generated.length, 0); assert.equal(touched.length, 0);
  assert.equal(button('Link & QR').getAttribute('aria-selected'), 'true');
  assert.equal(document.querySelectorAll('[role="tabpanel"]')[1].hidden, true);
  assert.equal(document.querySelector('input').value, 'http://localhost:3150/card?via=link');
  const qr = document.querySelector('svg[role="img"]');
  assert.equal(qr.getAttribute('viewBox'), `0 0 ${codes.qrMatrix('http://localhost:3150/card?via=qr').size + 8} ${codes.qrMatrix('http://localhost:3150/card?via=qr').size + 8}`);
  assert.equal(document.activeElement, button('Copy link'));
  assert.equal(button('Share...'), undefined);
});

test('copy success is recorded only after clipboard or fallback confirms success', async () => {
  await render(); await click('Copy link');
  assert.deepEqual(copied, ['http://localhost:3150/card?via=link']);
  assert.deepEqual(touched, []);
  assert.equal(document.querySelector('[role="status"]').textContent, 'Link copied');
});

test('the sheet mounts at the body overlay layer and removes only its own portal on close', async () => {
  const launcher = document.createElement('button');
  launcher.textContent = 'Mr. Pot'; document.body.appendChild(launcher);
  await render();
  const backdrop = document.querySelector('[role="dialog"]').parentElement;
  assert.equal(backdrop.parentElement, document.body);
  assert.equal(document.body.lastElementChild, backdrop);
  await act(() => root.render(null));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(launcher.isConnected, true);
  assert.equal(document.activeElement, document.getElementById('opener'));
});

test('a rejected clipboard and failed fallback do not claim success or record a share', async () => {
  navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await render(); await click('Copy link');
  assert.match(document.querySelector('[role="status"]').textContent, /Could not copy/);
  assert.equal(touched.length, 0); assert.ok(button('Copy link'));
  assert.equal(document.activeElement, document.querySelector('input'));
  document.execCommand = () => true;
  await click('Copy link'); assert.equal(touched.length, 0); assert.ok(button('Link copied'));
});

test('image rendering is lazy and reused across tabs and PNG downloads', async () => {
  await render(); await click('Share image');
  assert.equal(generated.length, 1); assert.equal(button('Save image').disabled, false);
  assert.equal(document.querySelector('canvas').width, 1080); assert.equal(document.querySelector('canvas').height, 1350);
  await click('Link & QR'); await click('Share image'); await click('Save image');
  assert.equal(generated.length, 1); assert.equal(exported[0], document.querySelector('canvas'));
  assert.equal(downloads[0].name, 'yuqi-guo-card.png');
  assert.deepEqual(touched, []);
});

test('pending generation disables downloads; failed generation can retry without losing the link', async () => {
  let reject;
  makePoster = () => new Promise((_, fail) => { reject = fail; });
  await render(); await click('Share image'); assert.equal(button('Save image').disabled, true);
  await act(async () => reject(new Error('font/canvas unavailable')));
  assert.ok(button('Retry')); assert.equal(button('Save image').disabled, true);
  makePoster = async () => ({ width: 1080, height: 1350 });
  await click('Retry'); assert.equal(button('Save image').disabled, false);
  await click('Link & QR'); assert.equal(document.querySelector('input').value, 'http://localhost:3150/card?via=link');
});

test('QR download preserves the encoded destination and four-module quiet zone', async () => {
  await render(); await click('Save QR');
  assert.equal(downloads[0].name, 'yuqi-guo-qr.svg'); assert.equal(blobs[0].type, 'image/svg+xml');
  assert.equal(await blobs[0].text(), codes.qrSvg('http://localhost:3150/card?via=qr', { quiet: 4, title: 'QR code for localhost:3150/card' }));
  assert.equal(generated.length, 0);
});

test('arrow keys switch tabs, focus stays inside, and closing restores scroll and opener focus', async () => {
  await render();
  await act(async () => Simulate.keyDown(button('Link & QR'), { key: 'ArrowRight', preventDefault() {} }));
  assert.equal(button('Share image').getAttribute('aria-selected'), 'true'); assert.equal(document.activeElement, button('Share image'));
  button('Save image').focus();
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, button('Close share window'));
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  assert.equal(closed, 1);
  await act(() => root.unmount()); root = null;
  assert.equal(document.documentElement.style.overflow, 'auto'); assert.equal(document.activeElement.id, 'opener');
});

test('native sharing uses the system link; cancellation is not a share or an error', async () => {
  const calls = [];
  Object.defineProperty(navigator, 'share', { configurable: true, value: async value => { calls.push(value); throw Object.assign(new Error('cancel'), { name: 'AbortError' }); } });
  await render(); await click('Share...');
  assert.equal(calls[0].url, 'http://localhost:3150/card?via=system'); assert.equal(touched.length, 0);
  assert.equal(document.querySelector('[role="status"]').textContent, '');
});
