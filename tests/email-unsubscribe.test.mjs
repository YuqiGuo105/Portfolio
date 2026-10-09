import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { transform } = require('next/dist/build/swc');
const source = readFileSync(new URL('../pages/api/subscriptions/email-unsubscribe.js', import.meta.url), 'utf8');
const { code } = await transform(source, { filename: 'email-unsubscribe.js', jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' }, module: { type: 'commonjs' } });
let calls = [];
const exports = {};
new Function('require', 'exports', code)(() => ({
  forward: async (...args) => calls.push(args),
  methodGuard: (req, res, allowed) => allowed.includes(req.method) || (res.status(405).json({ error: 'method' }), false),
}), exports);
const token = 'v1.00000000-0000-0000-0000-000000000001.' + 'a'.repeat(64);
function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; }, redirect(n, url) { this.statusCode = n; this.url = url; } }; }

test('mail scanner GET redirects to confirmation without mutating preferences', async () => {
  calls = []; const res = response();
  await exports.default({ method: 'GET', query: { token } }, res);
  assert.equal(calls.length, 0);
  assert.equal(res.statusCode, 303);
  assert.equal(res.url, '/subscriptions/unsubscribe#token=' + token);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('one-click POST accepts the standard form and never forwards tokens in query strings', async () => {
  calls = []; const res = response();
  await exports.default({ method: 'POST', query: { token }, body: 'List-Unsubscribe=One-Click' }, res);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0].body, { token });
  assert.equal(calls[0][2].forwardQuery, false);
});

test('invalid links and malformed POST bodies never reach the service', async () => {
  calls = [];
  for (const req of [
    { method: 'POST', query: { token: 'bad' }, body: 'List-Unsubscribe=One-Click' },
    { method: 'POST', query: { token }, body: {} },
    { method: 'DELETE', query: { token } },
  ]) {
    const res = response(); await exports.default(req, res);
    assert.ok([400, 405].includes(res.statusCode));
  }
  assert.equal(calls.length, 0);
});
