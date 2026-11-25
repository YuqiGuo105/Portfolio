import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, after, afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { cardShareContent, SHARE_EVENT } from '../src/lib/share/open.mjs';
import { publicProfile } from '../src/lib/share/model.mjs';
import * as chatPagePolicy from '../src/lib/chatPagePolicy.mjs';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'http://localhost:3150/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage; globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = require('react'), { createRoot } = require('react-dom/client'), { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');
async function loadComponent(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { code } = await transform(source, {
    filename: 'Component.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' },
  });
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name.endsWith('.css')) return { __esModule: true, default: {} };
    if (name === 'next/link') return { __esModule: true, default: ({ children, href }) => React.cloneElement(children, { href }) };
    if (name === 'next/dynamic') return { __esModule: true, default: () => () => null };
    if (name === 'next/router') return { useRouter: () => ({ pathname: '/' }) };
    if (name.endsWith('SocialLinks')) return { __esModule: true, default: () => null };
    if (name.endsWith('/talk/links')) return { referralHref: '/talk?intent=referral' };
    if (name.endsWith('chatPagePolicy.mjs')) return chatPagePolicy;
    if (name.endsWith('TalkHub')) return { __esModule: true, default: () => React.createElement('form', null, React.createElement('input', { name: 'message', defaultValue: 'Unsent draft' })) };
    return require(name);
  }, exports);
  return exports.default;
}
const Header = await loadComponent('../src/layout/Header.js');
const ContactForm = await loadComponent('../src/components/ContactForm.js');
let root;
const render = async (Component, props) => {
  if (!root) root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Component, props)));
};
afterEach(async () => { if (root) await act(() => root.unmount()); root = null; });
after(() => dom.window.close());

test('home and card entry points share only public profile fields and use the same destination', () => {
  const profile = { ...publicProfile({ title: 'Backend Engineer', company: 'Example' }), phone: 'private', email: 'private', code: 'private' };
  const content = cardShareContent(profile);
  assert.equal(content.url, '/card'); assert.equal(content.kind, 'card');
  assert.equal(content.role, 'Backend Engineer at Example');
  assert.equal(content.image, profile.photo); assert.equal(content.title, profile.name);
  assert.equal(JSON.stringify(content).includes('private'), false);
  assert.equal(cardShareContent(publicProfile(null)).role, 'Software Engineer');
});

test('the homepage links Contact Me to a standalone card without loading the sharing dialog', () => {
  const home = readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/layout/Layout.js', import.meta.url), 'utf8');
  assert.match(home, /<ContactForm referral=\{referral\} shareCardHref="\/card"/);
  assert.doesNotMatch(home, /onShareCard|openShare|cardShareContent/);
  assert.doesNotMatch(layout, /onShareCard/);
  assert.doesNotMatch(home, /<Layout onShareCard/);
});

test('Share card is a normal page link outside the form, not a modal or submit action', async () => {
  const events = []; let submits = 0;
  const capture = event => events.push(event.detail);
  window.addEventListener(SHARE_EVENT, capture);
  try {
    await render(ContactForm, { shareCardHref: '/card' });
    const share = document.querySelector('#contact-section a[href="/card"]');
    document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); submits++; });
    assert.equal(share.textContent, 'Share card');
    assert.equal(share.getAttribute('aria-haspopup'), null);
    assert.equal(share.tagName, 'A');
    assert.equal(share.closest('form'), null);
    await act(async () => Simulate.click(share));
    assert.equal(events.length, 0);
    assert.equal(window.location.pathname, '/'); assert.equal(submits, 0);
    assert.equal(document.querySelector('input').value, 'Unsent draft');
    // The contact section no longer prints a personal phone number or email address.
    assert.equal(document.querySelector('#contact-section a[href^="tel:"]'), null);
    assert.equal(document.querySelector('#contact-section a[href^="mailto:"]'), null);
  } finally { window.removeEventListener(SHARE_EVENT, capture); }
});

test('header retains the existing actions without any card-sharing action', async () => {
  let searches = 0;
  await render(Header, { onOpenSearch() { searches++; } });
  assert.equal(document.querySelector('[data-nav-action="share"]'), null);
  assert.ok(document.querySelector('[data-nav-action="search"]'));
  assert.ok(document.querySelector('[data-nav-action="theme"]'));
  assert.ok(document.querySelector('[data-nav-action="menu"]'));
  await act(async () => Simulate.click(document.querySelector('[data-nav-action="search"]')));
  assert.equal(searches, 1);
});
