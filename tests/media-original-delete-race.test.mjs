import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as library from '../src/lib/media/library.mjs';
import * as markup from '../src/lib/media/markup.mjs';
import * as demoCatalog from '../src/lib/media/demoCatalog.mjs';
import * as presentationJobs from '../src/lib/media/presentationJobs.mjs';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/admin/media' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.sessionStorage = dom.window.sessionStorage;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Unexpected network request'); };
const React = require('react'), { createRoot } = require('react-dom/client'), { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const asDefault = value => ({ __esModule: true, default: value });
const modules = { 'library.mjs': library, 'markup.mjs': markup, 'demoCatalog.mjs': demoCatalog, 'presentationJobs.mjs': presentationJobs };

async function loadComponent(path, dependencies = {}) {
  const { code } = await transform(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    filename: path, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
  });
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name in dependencies) return dependencies[name];
    if (name.endsWith('.css')) return asDefault({});
    if (name === 'next/link' || name.endsWith('/AdminLayout')) return asDefault(({ children }) => children);
    if (name.endsWith('/writerApi')) return { writerApi: { media: {} } };
    if (name.endsWith('/upload.mjs')) return { uploadMedia() { throw new Error('Unexpected upload'); } };
    const dependency = modules[name.split('/').pop()];
    if (dependency) return dependency;
    if (name.startsWith('.')) throw new Error(`Unexpected dependency: ${name}`);
    return require(name);
  }, exports);
  return exports;
}

const OriginalFileActions = (await loadComponent('src/components/media/OriginalFileActions.js')).default;
let observedAsset;
function ObserveOriginalFileActions(props) {
  observedAsset = props.asset;
  return React.createElement(OriginalFileActions, props);
}
const originalActionsModule = asDefault(ObserveOriginalFileActions);
const MediaInspector = (await loadComponent('src/components/media/MediaInspector.js', {
  './OriginalFileActions': originalActionsModule,
  './DemoVideo': asDefault(() => null),
  '../../lib/media/player.mjs': { createMediaPlayer: () => ({ dispose() {} }) },
})).default;
const { MediaLibraryContent } = await loadComponent('pages/admin/media.js', {
  '../../src/components/media/MediaInspector': asDefault(MediaInspector),
});
const IntroductionManager = (await loadComponent('src/components/media/IntroductionManager.js', {
  './OriginalFileActions': originalActionsModule,
})).default;

const asset = { id: 'video-a', kind: 'VIDEO', status: 'READY', filename: 'original.mp4', title: 'Video A', metadataVersion: 2, originalStatus: 'AVAILABLE', manifest: {} };
const deleted = { ...asset, metadataVersion: 4, originalStatus: 'DELETED' };
const newer = { ...deleted, metadataVersion: 6, title: 'Updated video' };
const replacement = { ...asset, id: 'video-b', metadataVersion: 1, filename: 'replacement.mp4', title: 'Video B' };
const parents = [
  { name: 'media library', Component: MediaLibraryContent, refreshLabel: 'Refresh media', read: 'list', response: value => [value] },
  { name: 'Introduction manager', Component: IntroductionManager, refreshLabel: 'Refresh status', read: 'get', response: value => value },
];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const button = name => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === name || node.textContent.trim() === name);
const click = name => act(async () => {
  const node = button(name);
  assert.ok(node, `Missing button: ${name}`);
  assert.equal(node.disabled, false, `Disabled button: ${name}`);
  Simulate.click(node);
});
let root, api, calls;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root'));
  sessionStorage.clear(); observedAsset = undefined; calls = [];
  api = {
    list: async () => [asset],
    presentation: async () => ({ enabled: true, assetId: asset.id, presentation: { title: 'Introduction' } }),
    presentationJobs: async () => [],
    get: async () => asset,
    checkOriginalDeletion: async id => {
      calls.push(['check', id]);
      return { id, metadataVersion: asset.metadataVersion, deletable: true, reasons: [], originalStatus: 'AVAILABLE' };
    },
    deleteOriginal: async (id, version) => { calls.push(['delete', id, version]); return deleted; },
  };
});
afterEach(async () => { await act(() => root.unmount()); });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

async function mount(parent) {
  await act(async () => root.render(React.createElement(parent.Component, { api, onSelect() {} })));
  // Introduction refresh starts on a zero-delay effect timer.
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  if (parent.read === 'list') await act(async () => Simulate.click(document.querySelector('[aria-label="Media assets"] button')));
  assert.equal(observedAsset, asset);
}

function expectDeleted(expected) {
  assert.equal(observedAsset, expected);
  assert.match(document.querySelector('[aria-label="Original file"]').textContent, /Original deleted\. Playback files retained/);
  assert.equal(button('Delete original'), undefined);
  assert.doesNotMatch(document.body.textContent, /Original stored privately/);
}

test('asset merge compares metadata versions only within one id and accepts clearing', () => {
  const legacy = { ...asset, metadataVersion: undefined };
  const equalVersion = { ...deleted, title: 'Updated title' };
  assert.equal(library.newerMediaAsset(deleted, asset), deleted);
  assert.equal(library.newerMediaAsset(asset, deleted), deleted);
  assert.equal(library.newerMediaAsset(deleted, equalVersion), equalVersion);
  assert.equal(library.newerMediaAsset(deleted, replacement), replacement);
  assert.equal(library.newerMediaAsset(deleted, legacy), deleted);
  assert.equal(library.newerMediaAsset(legacy, deleted), deleted);
  assert.equal(library.newerMediaAsset(null, deleted), deleted);
  assert.equal(library.newerMediaAsset(deleted, null), null);
});

for (const parent of parents) {
  test(`${parent.name}: in-flight old read cannot undo a successful deletion`, async () => {
    if (parent.read === 'list') api.list = async () => [asset, replacement];
    await mount(parent);
    const oldRead = deferred();
    api[parent.read] = async () => { calls.push(['refresh']); return oldRead.promise; };
    await click(parent.refreshLabel);
    assert.deepEqual(calls, [['refresh']]);
    await click('Delete original'); await click('Confirm deletion');
    assert.deepEqual(calls.slice(1), [['check', asset.id], ['delete', asset.id, 2]]);
    expectDeleted(deleted);
    await act(async () => oldRead.resolve(parent.read === 'list' ? [replacement, asset] : asset));
    expectDeleted(deleted);
    if (parent.read === 'list') {
      const rows = document.querySelectorAll('[aria-label="Media assets"] button');
      assert.equal(rows.length, 2);
      assert.match(rows[0].textContent, /Video B/);
      await act(async () => Simulate.click(rows[0]));
      assert.equal(observedAsset, replacement);
      await act(async () => Simulate.click(rows[1]));
      expectDeleted(deleted);
    }
  });

  test(`${parent.name}: delayed mutation result cannot replace a newer refresh`, async () => {
    await mount(parent);
    const read = deferred(), mutation = deferred();
    api[parent.read] = async () => { calls.push(['refresh']); return read.promise; };
    api.deleteOriginal = async (id, version) => { calls.push(['delete', id, version]); return mutation.promise; };
    await click(parent.refreshLabel);
    await click('Delete original'); await click('Confirm deletion');
    assert.deepEqual(calls, [['refresh'], ['check', asset.id], ['delete', asset.id, 2]]);
    await act(async () => read.resolve(parent.response(newer)));
    expectDeleted(newer);
    await act(async () => mutation.resolve(deleted));
    expectDeleted(newer);
  });

  test(`${parent.name}: accepts newer and equal versions, then a lower-version different asset`, async () => {
    await mount(parent);
    await click('Delete original'); await click('Confirm deletion');
    api[parent.read] = async () => parent.response(newer);
    await click(parent.refreshLabel); expectDeleted(newer);
    const equalVersion = { ...newer, filename: 'updated.mp4' };
    api[parent.read] = async () => parent.response(equalVersion);
    await click(parent.refreshLabel); expectDeleted(equalVersion);

    api.presentation = async () => ({ enabled: true, assetId: replacement.id, presentation: { title: 'Replacement' } });
    api[parent.read] = async () => parent.response(replacement);
    await click(parent.refreshLabel);
    if (parent.read === 'list') {
      assert.equal(document.querySelector('[aria-label="Media details"]'), null);
      const rows = document.querySelectorAll('[aria-label="Media assets"] button');
      assert.equal(rows.length, 1);
      await act(async () => Simulate.click(rows[0]));
    }
    assert.equal(observedAsset, replacement);
    assert.ok(button('Delete original'));
    assert.match(document.querySelector('[aria-label="Original file"]').textContent, /replacement\.mp4/);
  });
}
