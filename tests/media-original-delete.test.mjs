import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/admin/media' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const React = require('react'), { createRoot } = require('react-dom/client'), { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/media/OriginalFileActions.js', import.meta.url), 'utf8'), {
  filename: 'OriginalFileActions.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(name => name.endsWith('.css') ? { __esModule: true, default: {} } : require(name), exports);
let root, calls, changed, result, api;
const asset = { id: 'video-a', kind: 'VIDEO', status: 'READY', filename: 'original.mp4', metadataVersion: 2, originalStatus: 'AVAILABLE', manifest: { hls: 'master.m3u8' } };
const button = name => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === name);
const click = name => act(async () => Simulate.click(button(name)));
const render = (value = asset) => act(async () => root.render(React.createElement(exports.default, { key: value.id, asset: value, api, onChanged: next => changed.push(next) })));
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root'));
  calls = []; changed = [];
  result = { id: asset.id, metadataVersion: 7, deletable: true, reasons: [], originalStatus: 'AVAILABLE' };
  api = {
    checkOriginalDeletion: async id => { calls.push(['check', id]); return result; },
    deleteOriginal: async (id, version) => { calls.push(['delete', id, version]); return { ...asset, originalStatus: 'DELETED', metadataVersion: version + 1 }; },
    get: async id => { calls.push(['get', id]); return { ...asset, originalStatus: 'DELETED' }; },
  };
});
afterEach(async () => { await act(() => root.unmount()); });
after(() => dom.window.close());

test('no network on mount; requires a fresh check and explicit deletion confirmation', async () => {
  await render(); assert.deepEqual(calls, []);
  await click('Delete original');
  assert.deepEqual(calls, [['check', 'video-a']]);
  assert.equal(document.querySelector('dialog').open, true);
  assert.equal(document.activeElement, button('Cancel'));
  assert.match(document.querySelector('dialog').textContent, /cannot re-transcode/);
  assert.match(document.querySelector('dialog').textContent, /retention may delay final erasure/);
  await click('Confirm deletion');
  assert.deepEqual(calls[1], ['delete', 'video-a', 7]);
  assert.equal(document.querySelector('dialog').open, false);
  assert.deepEqual(changed[0].manifest, asset.manifest);
  await render(changed[0]); assert.match(document.querySelector('[role=status]').textContent, /Playback files retained/);
  assert.equal(button('Delete original'), undefined);
});
test('cancel does not delete and reopening rechecks server state', async () => {
  await render(); await click('Delete original'); await click('Cancel');
  assert.equal(document.querySelector('dialog').open, false);
  await click('Delete original'); assert.deepEqual(calls.map(c => c[0]), ['check', 'check']);
});
test('unfinished processing cannot be deleted and read-only or unsupported assets have no action', async () => {
  for (const status of ['UPLOADING', 'PROCESSING', 'FAILED']) {
    await render({ ...asset, status }); assert.equal(button('Delete original').disabled, true);
  }
  for (const value of [{ ...asset, kind: 'IMAGE' }, { ...asset, status: 'LOCAL' }, { ...asset, originalStatus: undefined }]) {
    await render(value); assert.equal(document.querySelector('section'), null);
  }
  api = null; await render(); assert.equal(document.querySelector('section'), null); assert.deepEqual(calls, []);
});
test('server refusal exposes reasons but no deletion or confirmation', async () => {
  result = { ...result, deletable: false, reasons: ['active_jobs'] };
  await render(); await click('Delete original');
  assert.match(document.querySelector('[role=alert]').textContent, /Processing is still active/);
  assert.equal(document.querySelector('dialog').open, false); assert.equal(calls.length, 1);
});
test('stale version never claims success and requires another fresh check', async () => {
  api.deleteOriginal = async () => { throw Object.assign(new Error('stale'), { status: 409 }); };
  await render(); await click('Delete original'); await click('Confirm deletion');
  assert.equal(changed.length, 0); assert.match(document.querySelector('[role=alert]').textContent, /changed/);
  assert.equal(document.querySelector('dialog').open, false);
  await click('Delete original'); assert.equal(calls.filter(c => c[0] === 'check').length, 2);
});
test('storage/network error is retryable without false success', async () => {
  api.deleteOriginal = async () => { throw new Error('Object storage temporarily unavailable'); };
  await render({ ...asset, originalStatus: 'DELETE_FAILED' }); await click('Retry original deletion'); await click('Confirm deletion');
  assert.equal(changed.length, 0); assert.match(document.querySelector('[role=alert]').textContent, /temporarily unavailable/);
});
test('duplicate confirm is coalesced and controls lock during request', async () => {
  let resolve;
  api.deleteOriginal = (id, version) => { calls.push(['delete', id, version]); return new Promise(done => { resolve = done; }); };
  await render(); await click('Delete original');
  await act(async () => { Simulate.click(button('Confirm deletion')); Simulate.click(button('Confirm deletion')); });
  assert.equal(calls.filter(c => c[0] === 'delete').length, 1);
  assert.equal(button('Cancel').disabled, true);
  await act(async () => resolve({ ...asset, originalStatus: 'DELETED' })); assert.equal(changed.length, 1);
});
test('switching asset ignores an old pending check', async () => {
  let resolve; api.checkOriginalDeletion = () => new Promise(done => { resolve = done; });
  await render(); await click('Delete original');
  await render({ ...asset, id: 'video-b' });
  await act(async () => resolve(result));
  assert.equal(document.querySelector('dialog').open, false); assert.equal(changed.length, 0);
});
test('already deleted by another admin refreshes status without repeating deletion', async () => {
  result = { ...result, originalStatus: 'DELETED', deletable: false };
  await render(); await click('Delete original');
  assert.deepEqual(calls.map(c => c[0]), ['check', 'get']); assert.equal(changed[0].originalStatus, 'DELETED');
});
