// The Talk hub and the referral form, rendered in jsdom with the real components.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, beforeEach, afterEach, after } from 'node:test';
import { JSDOM } from 'jsdom';
import * as config from '../src/lib/referral/config.mjs';
import * as fields from '../src/lib/referral/fields.mjs';
import * as roles from '../src/lib/referral/roles.mjs';
import { ADDITIONAL_ROLES, pdf } from './referral-fixtures.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/talk' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
for (const key of ['navigator', 'sessionStorage', 'FileReader', 'File', 'atob', 'requestAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: key === 'requestAnimationFrame' ? fn => setTimeout(fn, 0) : dom.window[key], configurable: true });
}
dom.window.matchMedia = () => ({ matches: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act, Simulate } = require('react-dom/test-utils');
const { transform } = require('next/dist/build/swc');

const router = { isReady: true, query: {}, replaced: [], replace(target) { this.replaced.push(target); } };
const classNames = new Proxy({}, { get: (_target, key) => String(key) });
const stubs = {
  'next/router': { useRouter: () => router },
  'next/dynamic': { __esModule: true, default: () => function Wizard() { return React.createElement('div', { 'data-wizard': '' }); } },
  'next/link': { __esModule: true, default: ({ href, children }) => React.cloneElement(children, { href }) },
};
let onToken = null;
const cache = new Map();
async function load(relative, overrides = {}) {
  const file = path.join(root, relative);
  if (cache.has(file) && !Object.keys(overrides).length) return cache.get(file);
  const { code } = await transform(readFileSync(file, 'utf8'), { filename: file,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' } });
  const needed = [...code.matchAll(/require\("(\.[^"]+)"\)/g)].map(match => match[1]);
  const local = {};
  for (const name of needed) {
    if (name.endsWith('.css')) local[name] = { __esModule: true, default: classNames };
    else if (name.endsWith('config.mjs')) local[name] = config;
    else if (name.endsWith('fields.mjs')) local[name] = fields;
    else if (name.endsWith('roles.mjs')) local[name] = roles;
    else if (overrides[path.basename(name)]) local[name] = overrides[path.basename(name)];
    else local[name] = await load(path.relative(root, path.resolve(path.dirname(file), name.endsWith('.js') ? name : `${name}.js`)));
  }
  const exports = {};
  new Function('require', 'exports', code)(name => local[name] || stubs[name] || require(name), exports);
  if (!Object.keys(overrides).length) cache.set(file, exports);
  return exports;
}
const Verification = { __esModule: true, default: function Verification({ onToken: report, action }) {
  onToken = report; return React.createElement('div', { 'data-verification': action });
} };
const Message = { __esModule: true, default: () => React.createElement('form', { 'data-message-form': '' }) };
const TalkHub = (await load('src/components/talk/TalkHub.js', { MessageForm: Message })).default;
const ContactForm = (await load('src/components/ContactForm.js', { TalkHub: { __esModule: true, default: TalkHub } })).default;
const ReferralWizard = (await load('src/components/talk/ReferralWizard.js', { ContactVerification: Verification })).default;

const nativeFetch = globalThis.fetch;
let container, mount, requests, respond;
const render = element => act(async () => { mount.render(element); });
// What the page's static props say: where a referral can be asked for right now.
const OPEN = { company: 'Goldman Sachs', reason: null };
const $ = selector => container.querySelector(selector);
const all = selector => [...container.querySelectorAll(selector)];
const button = name => all('button').find(el => el.textContent.trim().startsWith(name));
const click = el => act(async () => { Simulate.click(el); await new Promise(resolve => setTimeout(resolve, 5)); });
const type = (id, value) => act(async () => { const el = document.getElementById(id); el.value = value; Simulate.change(el); });
const errors = () => all('[role="alert"]').map(el => el.textContent);
const INTRO = 'Alex Chen is a backend engineer with five years of experience building payment services in Java. At Northwind, Alex led the migration of the ledger service to Kafka and cut settlement delay from hours to minutes.';

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root'); mount = createRoot(container);
  window.sessionStorage.clear(); router.query = {}; router.replaced = []; requests = []; onToken = null;
  // The three calls the form makes: save the answers, PUT the file to the upload URL, confirm.
  respond = (url) => {
    if (url === '/api/referral') return Response.json({ ok: true, reference: 'R-TEST00000001', state: 'awaiting_upload', upload: { url: 'https://storage.example/upload?token=abc' } }, { status: 201 });
    if (url.startsWith('https://storage.example/')) return new Response('{}', { status: 200 });
    return Response.json({ ok: true, reference: 'R-TEST00000001', message: 'Your request was received.' });
  };
  globalThis.fetch = async (url, options = {}) => {
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || null;
    requests.push({ url, method: options.method || 'GET', headers: options.headers || {}, body });
    return respond(url, options);
  };
});
afterEach(async () => { await act(async () => mount.unmount()); globalThis.fetch = nativeFetch; });
after(() => dom.window.close());

test('Contact Me exposes a direct referral link without switching tabs or making requests', async () => {
  for (const referral of [OPEN, { company: null, reason: 'paused' }]) {
    await render(React.createElement(ContactForm, { referral }));
    assert.equal($('#contact-section .m-titles > #tour-contact').textContent, 'Contact Me');
    assert.equal(all('#contact-section .contact-details .numbers-item').length, 1);
    assert.ok($('#contact-section .vertical-line.contact-form-column [data-talk-hub="section"]'));
    const link = all('#contact-section a').find(node => node.textContent === 'Request a referral');
    assert.ok(link);
    assert.equal(link.getAttribute('href'), '/talk?intent=referral');
    assert.equal(link.getAttribute('target'), null);
    assert.equal(all('[role="tab"]')[0].getAttribute('aria-selected'), 'true');
    assert.equal($('[data-wizard]'), null);
    assert.deepEqual(requests, []);
  }
});

test('the home hub offers only message and live chat, with the message form first', async () => {
  await render(React.createElement(TalkHub, { mode: 'section', referral: OPEN }));
  const tabs = all('[role="tab"]');
  assert.deepEqual(tabs.map(tab => tab.querySelector('.intentTitle').textContent), ['Message', 'Live chat']);
  assert.deepEqual(tabs.map(tab => tab.getAttribute('aria-label')), ['Send a message', 'Chat or call live']);
  assert.deepEqual(tabs.map(tab => tab.getAttribute('aria-selected')), ['true', 'false']);
  assert.deepEqual(tabs.map(tab => tab.tabIndex), [0, -1]);
  assert.ok($('#talk-panel-message [data-message-form]'));
  assert.equal($('#talk-panel-referral'), null);
  for (const tab of tabs) assert.equal(document.getElementById(tab.getAttribute('aria-controls')).getAttribute('aria-labelledby'), tab.id);
});

test('the home hub cannot open a removed referral panel through initial intent or query', async () => {
  router.query = { intent: 'referral' };
  await render(React.createElement(TalkHub, { mode: 'section', initialIntent: 'referral', referral: OPEN }));
  assert.equal($('#talk-panel-referral'), null);
  assert.equal($('#talk-panel-message').hidden, false);
  assert.equal($('[data-wizard]'), null);
  assert.deepEqual(router.replaced, [], 'the home page keeps its own address');
  assert.ok($('#talk-panel-message [data-message-form]'));
});

test('the live chat tab sets expectations, opens TalkNest safely and offers the message form instead', async () => {
  await render(React.createElement(TalkHub, { mode: 'section', referral: OPEN }));
  await click(all('[role="tab"]')[1]);
  const link = $('#talk-panel-chat a');
  const url = new URL(link.getAttribute('href'));
  assert.equal(url.origin, 'https://talknest-refresh.onrender.com'); assert.equal(url.searchParams.get('connect'), 'Yuqi Guo');
  assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  assert.match($('#talk-panel-chat').textContent, /calls need both of us there at the same time/);
  await click(button('Send a message instead'));
  assert.equal(all('[role="tab"]')[0].getAttribute('aria-selected'), 'true');
});

test('arrow keys move between the choices', async () => {
  await render(React.createElement(TalkHub, { mode: 'section', referral: OPEN }));
  const list = $('[role="tablist"]');
  await act(async () => Simulate.keyDown(list, { key: 'ArrowRight' }));
  assert.equal(all('[role="tab"]')[1].getAttribute('aria-selected'), 'true');
  await act(async () => Simulate.keyDown(list, { key: 'ArrowLeft' })); await act(async () => Simulate.keyDown(list, { key: 'ArrowLeft' }));
  assert.equal(all('[role="tab"]')[1].getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement.id, 'talk-tab-chat');
  await act(async () => Simulate.keyDown(list, { key: 'Home' }));
  assert.equal(all('[role="tab"]')[0].getAttribute('aria-selected'), 'true');
});

test('/talk?intent=referral opens the form itself and keeps the address in step with the tab', async () => {
  router.query = { intent: 'referral' };
  await render(React.createElement(TalkHub, { mode: 'page', referral: OPEN }));
  assert.deepEqual(all('[role="tab"]').map(tab => tab.querySelector('.intentTitle').textContent), ['Send a message', 'Ask for a referral', 'Chat or call live']);
  assert.equal(all('[role="tab"]')[1].getAttribute('aria-selected'), 'true');
  assert.ok($('#talk-panel-referral [data-wizard]'));
  await click(all('[role="tab"]')[2]);
  assert.deepEqual(router.replaced.at(-1), { pathname: '/talk', query: { intent: 'chat' } });
  await click(all('[role="tab"]')[0]);
  assert.deepEqual(router.replaced.at(-1), { pathname: '/talk', query: {} });
  router.query = { intent: 'nonsense' };
  await render(React.createElement(TalkHub, { mode: 'page', key: 'again', referral: OPEN }));
  assert.equal(all('[role="tab"]')[0].getAttribute('aria-selected'), 'true');
});

async function attach(file) {
  const input = document.getElementById('referral-resume');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { Simulate.change(input); await new Promise(resolve => setTimeout(resolve, 30)); });
}
const resumeFile = () => new dom.window.File([pdf()], 'Alex Chen Resume.pdf', { type: 'application/pdf' });
async function reachIntro() {
  await type('referral-roleTitle', 'Associate, Software Engineering');
  if (!document.getElementById('referral-jobUrl').value) await type('referral-jobUrl', 'https://higher.gs.com/roles/123456');
  await click(button('Continue'));
  await type('referral-name', 'Alex Chen'); await type('referral-email', 'alex@example.com');
  await attach(resumeFile());
  await act(async () => { const radio = document.getElementById('referral-relationship-4'); radio.checked = true; Simulate.change(radio); });
  await click(button('Continue'));
}

test('each step names what is missing before moving on', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await click(button('Continue'));
  assert.deepEqual(errors(), ['Enter the role title as it appears on the posting.', 'Paste the link to the posting.']);
  assert.equal(document.getElementById('referral-roleTitle').getAttribute('aria-invalid'), 'true');
  await type('referral-roleTitle', 'Associate'); await type('referral-jobUrl', 'http://insecure.example/job');
  await click(button('Continue'));
  assert.deepEqual(errors(), ['Use the full https:// link to the posting.']);
  await type('referral-jobUrl', 'https://higher.gs.com/roles/123456');
  await click(button('Continue'));
  assert.match($('h3').textContent, /About you/);
  await type('referral-years', 'five');
  await click(button('Continue'));
  assert.deepEqual(errors().sort(), ['Attach your résumé as a PDF.', 'Choose the option that fits best.', 'Enter a whole number of years, or leave this empty.',
    'Enter an email address you can be reached at.', 'Enter your full name.']);
});

async function addExtraRoles() {
  await type('referral-jobUrl', ['https://higher.gs.com/roles/123456', ...ADDITIONAL_ROLES.map(role => role.jobUrl)].join(', '));
}

test('one links field accepts three comma-separated postings and rejects a fourth or duplicate', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await addExtraRoles();
  assert.equal(button('Add another role'), undefined);
  assert.match(container.textContent, /separated by commas/);
  await type('referral-roleTitle', 'Associate, Software Engineering');
  const links = document.getElementById('referral-jobUrl').value;
  await type('referral-jobUrl', `${links}, https://higher.gs.com/roles/4`);
  await click(button('Continue'));
  assert.match(errors().join(' '), /no more than three/);
  await type('referral-jobUrl', 'https://higher.gs.com/roles/123456, https://higher.gs.com/roles/123456?utm_source=linkedin');
  await click(button('Continue'));
  assert.match(errors().join(' '), /already included/);
  assert.equal(document.activeElement.id, 'referral-jobUrl');
  await type('referral-jobUrl', `https://higher.gs.com/roles/123456， ${ADDITIONAL_ROLES[1].jobUrl}`);
  await click(button('Continue'));
  assert.match($('h3').textContent, /About you/);
  assert.deepEqual(requests, []);
});

test('only a PDF of 2 MB or less can be attached', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await type('referral-roleTitle', 'Associate'); await type('referral-jobUrl', 'https://higher.gs.com/roles/1');
  await click(button('Continue'));
  await attach(new dom.window.File(['hello'], 'resume.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  assert.match(errors().join(' '), /must be a PDF file/);
  await attach(new dom.window.File(['not really a pdf'], 'resume.pdf', { type: 'application/pdf' }));
  assert.match(errors().join(' '), /is not a PDF/);
  await attach(new dom.window.File([new Uint8Array(config.RESUME_MAX_BYTES + 1)], 'big.pdf', { type: 'application/pdf' }));
  assert.match(errors().join(' '), /The limit is 2 MB/);
  await attach(resumeFile());
  assert.deepEqual(errors(), []); assert.match(container.textContent, /Alex Chen Resume\.pdf/);
});

test('the introduction must be about the applicant, with the template filled in', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachIntro();
  assert.match($('h3').textContent, /in third person/);
  assert.match(container.textContent, /Write Alex is a backend engineer who… rather than I am a backend engineer who…/);
  // The applicant writes it. Nothing on this step calls a model or any other service.
  assert.equal(all('button').some(el => /draft|generate|AI/i.test(el.textContent)), false);
  assert.match(container.textContent, /Write it yourself or paste one you already have\. I pass it on exactly as you wrote it\./);
  assert.deepEqual(requests, []);
  await type('referral-intro', `I am a backend engineer. ${'My team and I build payment services. '.repeat(6)}`);
  assert.match(container.textContent, /This reads as first person \(I, My\)/);
  await click(button('Continue'));
  assert.deepEqual(errors(), ['Rewrite this about yourself by name: “Alex is…”, not “I am…”.']);
  await type('referral-intro', '');
  await click(button('Start from a fill-in template'));
  assert.match(document.getElementById('referral-intro').value, /^Alex Chen is a \[current title\]/);
  await click(button('Continue'));
  assert.deepEqual(errors(), ['Replace the parts in [brackets] with your own details.']);
  await type('referral-intro', INTRO);
  assert.match(container.textContent, /Reads as third person\./);
});

const submitForm = () => act(async () => { Simulate.submit($('form')); await new Promise(resolve => setTimeout(resolve, 30)); });
const agree = () => act(async () => { const box = document.getElementById('referral-consent'); box.checked = true; Simulate.change(box); });
async function reachReview() { await reachIntro(); await type('referral-intro', INTRO); await click(button('Continue')); }

test('arriving at the review does not send anything; sending needs consent and verification', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachReview();
  assert.match($('h3').textContent, /Check it, then send/);
  // Regression: the click on "Continue" must not also submit the form it turns into.
  assert.deepEqual(requests, []); assert.deepEqual(errors(), []);
  assert.equal($('[data-verification]').getAttribute('data-verification'), 'referral_submit');
  assert.match(container.textContent, /an AI model \(Google Gemini\) may read them to screen the request/);
  assert.match(container.textContent, /the résumé file for up to 30 days, or until the request is closed/);
  await submitForm();
  assert.deepEqual(errors(), ['Please confirm how your details will be used.']); assert.deepEqual(requests, []);
  await agree(); await submitForm();
  assert.deepEqual(errors(), ['Please complete the verification before sending.']); assert.deepEqual(requests, []);
});

test('sending saves the answers, uploads the file straight to storage, then confirms', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachReview(); await agree();
  await act(async () => onToken('token-1'));
  await submitForm();
  assert.deepEqual(requests.map(item => `${item.method} ${item.url.split('?')[0]}`), ['POST /api/referral', 'PUT https://storage.example/upload', 'POST /api/referral/complete']);
  const sent = requests[0].body;
  assert.match(sent.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(sent.turnstileToken, 'token-1'); assert.equal(sent.consent, true); assert.equal(sent.relationship, 'not_yet');
  assert.equal(sent.company, 'Goldman Sachs', 'the form says which company it was showing');
  assert.equal(sent.intro, INTRO, 'the introduction is sent exactly as typed'); assert.equal(sent.years, '');
  // The answers are small; the file itself never goes to the site's own API.
  assert.deepEqual(sent.resume, { name: 'Alex Chen Resume.pdf', size: pdf().length, type: 'application/pdf' });
  assert.ok(JSON.stringify(sent).length < 4000);
  assert.equal(requests[1].headers['Content-Type'], 'application/pdf'); assert.equal(requests[1].headers['x-upsert'], 'false');
  assert.equal(requests[1].body.name, 'Alex Chen Resume.pdf'); assert.equal(requests[1].body.size, pdf().length);
  assert.deepEqual(requests[2].body, { idempotencyKey: sent.idempotencyKey });
  // What the form sends is exactly what the server accepts.
  assert.equal(fields.referralFields(sent).email, 'alex@example.com'); assert.equal(fields.idempotencyKey(sent.idempotencyKey), sent.idempotencyKey);
  assert.match(container.textContent, /Request received/); assert.match(container.textContent, /R-TEST00000001/);
  assert.match(container.textContent, /A referral is not guaranteed/);
  assert.equal(window.sessionStorage.getItem('talk:referral:v1'), null); assert.equal(window.sessionStorage.getItem('talk:referral:key:v1'), null);
});

test('three roles survive reload, appear in review and share one submission and resume', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await addExtraRoles();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
  const links = document.getElementById('referral-jobUrl').value;
  assert.equal(JSON.parse(window.sessionStorage.getItem('talk:referral:v1')).jobUrl, links);
  await act(async () => mount.unmount()); mount = createRoot(container);
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  assert.equal(document.getElementById('referral-jobUrl').value, links);
  await reachReview();
  for (const role of ADDITIONAL_ROLES) assert.ok(container.textContent.includes(role.jobUrl));
  assert.deepEqual(requests, []);
  await agree(); await act(async () => onToken('token-three-roles')); await submitForm();
  assert.deepEqual(requests.map(item => item.method), ['POST', 'PUT', 'POST']);
  assert.deepEqual(requests[0].body.additionalRoles.map(role => role.jobUrl), ADDITIONAL_ROLES.map(role => role.jobUrl));
  assert.deepEqual(requests[0].body.additionalRoles.map(role => role.roleTitle), ['Opening 2', 'Opening 3']);
  assert.equal(fields.referralFields(requests[0].body).additionalRoles.length, 2);
  assert.match(container.textContent, /Request received/);
});

test('a server error on the third role returns to that field without dropping other roles', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await addExtraRoles(); await reachReview(); await agree();
  respond = () => Response.json({ error: 'Check this posting.', code: 'invalid_field', field: 'additionalRoles.1.jobUrl' }, { status: 400 });
  await act(async () => onToken('token-three-roles')); await submitForm();
  assert.match($('h3').textContent, /Which roles/);
  assert.deepEqual(errors(), ['Check this posting.']);
  assert.equal(document.activeElement.id, 'referral-jobUrl');
  assert.ok(document.getElementById('referral-jobUrl').value.includes(ADDITIONAL_ROLES[0].jobUrl));
  assert.equal(document.getElementById('referral-roleTitle').value, 'Associate, Software Engineering');
});

test('an older multi-role draft keeps its links and titles in the comma-separated form', async () => {
  window.sessionStorage.setItem('talk:referral:v1', JSON.stringify({ roleTitle: 'Associate', jobUrl: 'https://higher.gs.com/roles/123456', additionalRoles: ADDITIONAL_ROLES }));
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  assert.equal(roles.postingLinks(document.getElementById('referral-jobUrl').value).length, 3);
  await reachReview(); await agree(); await act(async () => onToken('token-legacy')); await submitForm();
  assert.deepEqual(requests[0].body.additionalRoles, ADDITIONAL_ROLES);
});

test('a failed upload is retried on its own, with the same key and no second verification', async () => {
  let uploads = 0;
  const ok = respond;
  respond = (url, options) => (url.startsWith('https://storage.example/') && (uploads += 1) <= 2 ? new Response('{}', { status: 500 }) : ok(url, options));
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachReview(); await agree();
  await act(async () => onToken('token-1'));
  await submitForm();
  // One refreshed link was tried before giving up; the answers stay saved.
  assert.match(errors().join(' '), /The résumé could not be uploaded\. Press “Send request” to try again; your answers are saved\./);
  assert.deepEqual(requests.map(item => item.method + ' ' + item.url.split('?')[0]), ['POST /api/referral', 'PUT https://storage.example/upload', 'POST /api/referral', 'PUT https://storage.example/upload']);
  const key = requests[0].body.idempotencyKey;
  assert.equal(requests[2].body.idempotencyKey, key);
  // The verification token was single-use and has been cleared; the retry must not ask for another.
  requests.length = 0;
  await submitForm();
  assert.deepEqual(requests.map(item => item.method + ' ' + item.url.split('?')[0]), ['PUT https://storage.example/upload', 'POST /api/referral/complete']);
  assert.deepEqual(requests[1].body, { idempotencyKey: key });
  assert.match(container.textContent, /Request received/);
});

test('an upload that already got through counts as done, and a dropped connection keeps everything', async () => {
  const ok = respond;
  respond = (url, options) => (url.startsWith('https://storage.example/') ? new Response('{"message":"The resource already exists"}', { status: 409 }) : ok(url, options));
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachReview(); await agree();
  await act(async () => onToken('token-1'));
  await submitForm();
  assert.match(container.textContent, /Request received/);

  await act(async () => mount.unmount()); mount = createRoot(container); window.sessionStorage.clear(); requests.length = 0;
  respond = () => { throw new TypeError('Failed to fetch'); };
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachReview(); await agree();
  await act(async () => onToken('token-2'));
  await submitForm();
  assert.deepEqual(errors(), ['The connection dropped. Press “Send request” to try again; everything you entered is still here.']);
  assert.equal(document.getElementById('referral-consent').checked, true);
});

test('a problem the server finds takes the applicant back to that field with everything kept', async () => {
  respond = () => Response.json({ error: 'This field does not look right.', code: 'invalid_field', field: 'jobUrl' }, { status: 400 });
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachReview(); await agree();
  await act(async () => onToken('token-1'));
  await submitForm();
  assert.match($('h3').textContent, /Which role/); assert.deepEqual(errors(), ['This field does not look right.']);
  assert.equal(document.getElementById('referral-roleTitle').value, 'Associate, Software Engineering');
  respond = () => Response.json({ error: 'Too many requests from this network. Please try again later.', code: 'rate_limited' }, { status: 429 });
  await click(button('Continue')); await click(button('Continue')); await click(button('Continue'));
  // The used token was cleared, so a fresh verification is required before another attempt.
  await submitForm();
  assert.deepEqual(errors(), ['Please complete the verification before sending.']);
  await act(async () => onToken('token-2'));
  await submitForm();
  assert.deepEqual(errors(), ['Too many requests from this network. Please try again later.']);
  assert.equal(requests.length, 2);
});

test('changing an answer after the form was accepted sends a new request, not a stale one', async () => {
  let uploads = 0;
  const ok = respond;
  respond = (url, options) => (url.startsWith('https://storage.example/') && (uploads += 1) <= 2 ? new Response('{}', { status: 500 }) : ok(url, options));
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachReview(); await agree();
  await act(async () => onToken('token-1'));
  await submitForm();
  const firstKey = requests[0].body.idempotencyKey;
  await click(all('button').filter(el => el.textContent.startsWith('Edit'))[0]);
  await type('referral-roleTitle', 'Vice President, Software Engineering');
  await click(button('Continue')); await click(button('Continue')); await click(button('Continue'));
  requests.length = 0;
  await submitForm();
  assert.deepEqual(errors(), ['Please complete the verification before sending.'], 'a new request needs its own verification');
  await act(async () => onToken('token-2'));
  await submitForm();
  assert.equal(requests[0].url, '/api/referral'); assert.notEqual(requests[0].body.idempotencyKey, firstKey);
  assert.equal(requests[0].body.roleTitle, 'Vice President, Software Engineering');
  assert.match(container.textContent, /Request received/);
});

test('typed answers survive a reload in the same tab', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await type('referral-roleTitle', 'Associate, Software Engineering');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
  assert.equal(JSON.parse(window.sessionStorage.getItem('talk:referral:v1')).roleTitle, 'Associate, Software Engineering');
  await act(async () => mount.unmount());
  mount = createRoot(container);
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  assert.equal(document.getElementById('referral-roleTitle').value, 'Associate, Software Engineering');
});

// ── Following the current employer ──────────────────────────────────────────

test('the standalone hub names whichever company the page was given, on the tab and the form', async () => {
  const referral = { company: 'Northwind Labs', reason: null };
  await render(React.createElement(TalkHub, { mode: 'page', referral }));
  assert.equal(all('[role="tab"]')[1].querySelector('.intentHint').textContent, 'At Northwind Labs. About five minutes.');
  await click(all('[role="tab"]')[1]);
  assert.ok($('#talk-panel-referral [data-wizard]'));
  assert.doesNotMatch(container.textContent, /Goldman/);

  await render(React.createElement(ReferralWizard, { company: 'Northwind Labs' }));
  assert.match($('#referral-step-title').textContent, /Which roles at Northwind Labs\?/);
  assert.doesNotMatch(container.textContent, /Goldman/);
});

test('between jobs or when paused the referral tab says so and offers the message form; nothing can be sent', async () => {
  for (const [referral, text] of [
    [{ company: null, reason: 'no_employer' }, /between roles, so there is no company I can refer you to/],
    [{ company: null, reason: 'paused' }, /not taking referral requests at the moment/],
    [{ company: null, reason: 'unknown' }, /could not check where I can refer you/],
    [null, /not taking referral requests at the moment/],
  ]) {
    router.query = { intent: 'referral' };
    await render(React.createElement(TalkHub, { mode: 'page', key: JSON.stringify(referral), referral }));
    assert.equal(all('[role="tab"]')[1].querySelector('.intentHint').textContent, 'Not open right now.');
    assert.match($('#talk-panel-referral').textContent, /Referral requests are closed right now/);
    assert.match($('#talk-panel-referral').textContent, text);
    assert.equal($('[data-wizard]'), null); assert.equal($('[data-referral-form]'), null);
    await click($('#talk-panel-referral button'));
    assert.equal(all('[role="tab"]')[0].getAttribute('aria-selected'), 'true', 'the offered way out is the message form');
    assert.ok($('#talk-panel-message [data-message-form]'));
  }
  assert.deepEqual(requests, []);
});

test('when the server says the employer changed, the applicant is told to reload and keeps what they wrote', async () => {
  await render(React.createElement(ReferralWizard, { company: 'Goldman Sachs' }));
  await reachReview(); await agree();
  await act(async () => onToken('token-1'));
  respond = () => Response.json({ code: 'company_changed', company: 'Northwind Labs', error: 'This form was opened before my employer changed. Nothing was sent; reload the page to see where I can refer you now.' }, { status: 409 });
  await submitForm();
  assert.match(container.textContent, /opened before my employer changed/);
  assert.doesNotMatch(container.textContent, /Request received/);
  assert.ok(container.textContent.includes(INTRO), 'what they wrote is still on the page');
});
