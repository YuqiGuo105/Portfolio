import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
const { code } = await transform(readFileSync(new URL('../src/components/ParallaxPortrait.js', import.meta.url), 'utf8'), {
  filename: 'ParallaxPortrait.jsx',
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' },
  module: { type: 'commonjs' },
});
const exports = {};
new Function('require', 'exports', code)(require, exports);
const ParallaxPortrait = exports.default;

let root, frames, nextFrame, observers, listeners, registrations, requests, permissionCalls, permissionImpl;
const watched = new Set(['deviceorientation', 'devicemotion', 'pointermove', 'mouseout', 'blur', 'touchend', 'click']);
const button = () => document.querySelector('.pp-frame button');
const frame = () => document.querySelector('.pp-frame');
const active = (type, scope = 'window') => listeners.get(`${scope}:${type}`)?.size || 0;
const sensorRegistrations = () => registrations.filter(({ type }) => type === 'deviceorientation' || type === 'devicemotion');
const fire = (target, type, properties = {}) => act(() => {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, properties);
  target.dispatchEvent(event);
});
const orientation = (beta, gamma) => fire(window, 'deviceorientation', { beta, gamma });
const respond = async (value, index = 0) => act(async () => requests[index].resolve(value));
const reject = async (index = 0) => act(async () => requests[index].reject(new Error('Permission unavailable')));
const unmount = () => act(() => root.render(null));

function genericTaps() {
  for (const target of [document, document.body, document.getElementById('other'), frame(), document.querySelector('.pp-bg')]) {
    for (const type of ['touchstart', 'touchend', 'pointerup', 'click', 'scroll']) fire(target, type);
  }
}

function advanceFrames(count = 1) {
  act(() => {
    for (let i = 0; i < count && frames.size; i += 1) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    }
  });
}

function mount({ touch = true, permission = 'prompt', reduced = false, debug = false } = {}) {
  window.history.replaceState({}, '', debug ? '/?tiltdebug' : '/');
  window.matchMedia = query => ({ matches: query === '(prefers-reduced-motion: reduce)' ? reduced : touch });
  window.DeviceOrientationEvent = class {};
  if (permission === 'prompt') {
    window.DeviceOrientationEvent.requestPermission = function () {
      assert.equal(this, window.DeviceOrientationEvent);
      permissionCalls += 1;
      return permissionImpl();
    };
  } else if (permission === 'unsupported') delete window.DeviceOrientationEvent;
  act(() => root.render(React.createElement(React.StrictMode, null, React.createElement(ParallaxPortrait, { alt: 'Portrait' }))));
  frame().getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 300 });
}

beforeEach(t => {
  document.body.innerHTML = '<button id="other">Another action</button><div id="root"></div>';
  frames = new Map(); nextFrame = 0; observers = []; listeners = new Map(); registrations = []; requests = []; permissionCalls = 0;
  permissionImpl = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  // Track native subscriptions, not just resulting transforms: sensor access itself must be opt-in.
  for (const [scope, target] of [['window', window], ['document', document]]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    t.mock.method(target, 'addEventListener', (type, callback, options) => {
      if (watched.has(type)) {
        const key = `${scope}:${type}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(callback);
        registrations.push({ scope, type, options });
      }
      return add(type, callback, options);
    });
    t.mock.method(target, 'removeEventListener', (type, callback, options) => {
      listeners.get(`${scope}:${type}`)?.delete(callback);
      return remove(type, callback, options);
    });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  root = createRoot(document.getElementById('root'));
});

afterEach(t => {
  act(() => root.unmount());
  try {
    for (const [key, callbacks] of listeners) assert.equal(callbacks.size, 0, `${key} leaked after unmount`);
    assert.equal(frames.size, 0, 'animation frames leaked after unmount');
    assert.ok(observers.every(observer => observer.disconnected));
    assert.equal(document.querySelector('pre'), null);
  } finally {
    t.mock.timers.reset();
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
    delete globalThis.IntersectionObserver;
  }
});
after(() => dom.window.close());

test('mount and generic taps never request permission or register sensors, including after the old delay', t => {
  mount();
  assert.equal(permissionCalls, 0);
  assert.deepEqual(sensorRegistrations(), []);
  assert.ok(button());
  genericTaps();
  act(() => t.mock.timers.tick(5000));
  genericTaps();
  orientation(20, 10); orientation(40, 25);
  assert.equal(permissionCalls, 0);
  assert.deepEqual(sensorRegistrations(), []);
  assert.equal(active('touchend', 'document'), 0);
  assert.equal(active('click', 'document'), 0);
  assert.equal(frame().style.transform, '');
  assert.equal(frames.size, 0);
  assert.ok(button());
});

test('only the portrait button requests permission synchronously; grant installs one listener and enables tilt', async () => {
  mount();
  fire(button(), 'touchend');
  assert.equal(permissionCalls, 0);
  fire(button(), 'click');
  assert.equal(permissionCalls, 1);
  fire(button(), 'click'); genericTaps();
  assert.equal(permissionCalls, 1);
  assert.deepEqual(sensorRegistrations(), []);
  await respond('granted');
  assert.equal(button(), null);
  assert.equal(active('deviceorientation'), 1);
  assert.equal(sensorRegistrations().length, 1);
  assert.equal(sensorRegistrations()[0].options.passive, true);
  genericTaps();
  assert.equal(permissionCalls, 1);
  orientation(null, 12); orientation(12, null);
  assert.equal(frames.size, 0);
  orientation(20, 10); advanceFrames();
  assert.equal(frame().style.transform, '');
  orientation(29, 19); advanceFrames();
  assert.equal(frame().style.transform, 'perspective(1100px) rotateY(0.36deg) rotateX(-0.36deg)');
  assert.match(document.querySelector('.pp-bg').style.transform, /^skewX\(0\.148deg\) scale/);
});

test('denial keeps sensors off and generic taps cannot request again', async () => {
  mount();
  fire(button(), 'click');
  await respond('denied');
  assert.equal(button(), null);
  genericTaps();
  orientation(20, 10); orientation(40, 30);
  assert.equal(permissionCalls, 1);
  assert.deepEqual(sensorRegistrations(), []);
  assert.equal(frames.size, 0);
  assert.equal(frame().style.transform, '');
});

for (const failure of ['rejection', 'synchronous throw']) {
  test(`${failure} leaves sensors off and retries only from another button activation`, async () => {
    mount({ debug: true });
    const pendingPermission = permissionImpl;
    if (failure === 'synchronous throw') permissionImpl = () => { throw new Error('Permission unavailable'); };
    fire(button(), 'click');
    if (failure === 'rejection') await reject();
    assert.ok(button());
    assert.match(document.querySelector('pre').textContent, /permission: error:/);
    assert.deepEqual(sensorRegistrations(), []);
    genericTaps();
    assert.equal(permissionCalls, 1);
    permissionImpl = pendingPermission;
    fire(button(), 'click');
    assert.equal(permissionCalls, 2);
    await respond('granted', requests.length - 1);
    assert.equal(button(), null);
    assert.equal(active('deviceorientation'), 1);
  });
}

test('Android without requestPermission still waits for the portrait button before listening', () => {
  mount({ permission: 'automatic' });
  assert.ok(button());
  genericTaps();
  orientation(20, 10); orientation(40, 25);
  assert.deepEqual(sensorRegistrations(), []);
  assert.equal(frames.size, 0);
  fire(button(), 'click');
  assert.equal(permissionCalls, 0);
  assert.equal(button(), null);
  assert.equal(active('deviceorientation'), 1);
  orientation(20, 10); orientation(29, 19); advanceFrames();
  assert.equal(frame().style.transform, 'perspective(1100px) rotateY(0.36deg) rotateX(-0.36deg)');
});

test('a browser without orientation support stays static without an unusable opt-in button', () => {
  mount({ permission: 'unsupported' });
  assert.equal(button(), null);
  genericTaps(); orientation(20, 10);
  assert.equal(permissionCalls, 0);
  assert.deepEqual(sensorRegistrations(), []);
  assert.equal(frames.size, 0);
});

test('unmount before opt-in removes the button callback, observer and debug box without requesting permission', t => {
  mount({ debug: true });
  const oldFrame = frame();
  const enable = oldFrame.__enableMotion;
  unmount();
  assert.equal(oldFrame.__enableMotion, undefined);
  act(() => { enable(); t.mock.timers.tick(5000); });
  fire(document, 'touchend'); fire(document, 'click');
  assert.equal(permissionCalls, 0);
  assert.deepEqual(sensorRegistrations(), []);
  assert.ok(observers.every(observer => observer.disconnected));
  assert.equal(document.querySelector('pre'), null);
});

for (const outcome of ['granted', 'denied', 'rejected']) {
  test(`a pending ${outcome} response after unmount cannot activate sensors or affect a remounted portrait`, async () => {
    mount({ debug: true });
    const oldFrame = frame();
    const oldDebug = document.querySelector('pre');
    fire(button(), 'click');
    unmount();
    const debugText = oldDebug.textContent;
    assert.equal(oldFrame.__enableMotion, undefined);
    mount();
    if (outcome === 'rejected') await reject();
    else await respond(outcome);
    assert.equal(oldDebug.textContent, debugText);
    assert.equal(permissionCalls, 1);
    assert.deepEqual(sensorRegistrations(), []);
    assert.ok(button());
    fire(button(), 'click');
    await respond('granted', 1);
    assert.equal(active('deviceorientation'), 1);
    assert.equal(sensorRegistrations().length, 1);
  });
}

test('unmount after grant removes the sensor listener and cancels an active animation', async () => {
  mount({ debug: true });
  fire(button(), 'click'); await respond('granted');
  orientation(20, 10); orientation(29, 19); advanceFrames();
  assert.equal(frames.size, 1);
  const oldFrame = frame();
  const oldTransform = oldFrame.style.transform;
  unmount();
  assert.equal(active('deviceorientation'), 0);
  assert.equal(frames.size, 0);
  assert.equal(oldFrame.__enableMotion, undefined);
  orientation(40, 30); advanceFrames();
  assert.equal(frames.size, 0);
  assert.equal(oldFrame.style.transform, oldTransform);
});

for (const reduced of [false, true]) {
  test(`desktop keeps page-wide mouse motion, touch exclusion and recentering (reduced motion: ${reduced})`, () => {
    mount({ touch: false, reduced });
    assert.equal(button(), null);
    assert.equal(active('pointermove'), 1);
    assert.equal(active('mouseout', 'document'), 1);
    assert.equal(active('blur'), 1);
    genericTaps(); orientation(20, 10); orientation(40, 30);
    assert.equal(permissionCalls, 0);
    assert.deepEqual(sensorRegistrations(), []);
    fire(document.body, 'pointermove', { pointerType: 'touch', clientX: 900, clientY: 700 });
    assert.equal(frames.size, 0);
    fire(document.body, 'pointermove', { pointerType: 'mouse', clientX: 900, clientY: 700 });
    advanceFrames();
    const angle = reduced ? '0.21' : '0.42';
    assert.equal(frame().style.transform, `perspective(1800px) rotateY(${angle}deg) rotateX(-${angle}deg)`);
    advanceFrames(150);
    fire(document.body, 'mouseout', { relatedTarget: frame() });
    assert.equal(frames.size, 0);
    assert.notEqual(frame().style.transform, '');
    fire(window, 'blur'); advanceFrames(150);
    assert.equal(frame().style.transform, '');
    assert.equal(document.querySelector('.pp-bg').style.transform, '');
    fire(document.body, 'pointermove', { pointerType: 'mouse', clientX: 900, clientY: 700 });
    advanceFrames();
    fire(document.body, 'mouseout', { relatedTarget: null }); advanceFrames(150);
    assert.equal(frame().style.transform, '');
    fire(document.body, 'pointermove', { pointerType: 'mouse', clientX: 900, clientY: 700 });
    assert.equal(frames.size, 1);
    unmount();
    fire(document.body, 'pointermove', { pointerType: 'mouse', clientX: 0, clientY: 0 });
    assert.equal(frames.size, 0);
  });
}
