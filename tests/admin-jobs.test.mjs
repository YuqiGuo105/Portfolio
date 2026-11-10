import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ADMIN_API_DOCS_PATH } from '../src/lib/adminApiDocs.mjs';
import { createAdminDocsHandler } from '../src/lib/adminDocsHandler.mjs';

test('API documentation links stay within the login-protected admin workspace', () => {
  assert.equal(ADMIN_API_DOCS_PATH, '/admin/api-docs');
  const page = readFileSync(new URL('../pages/admin/api-docs.js', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/components/admin/AdminLayout.js', import.meta.url), 'utf8');
  assert.match(page, /<AdminLayout>/);
  assert.match(layout, /href: ADMIN_API_DOCS_PATH.*adminOnly: true/);
  assert.doesNotMatch(layout, /const ADMIN_SERVICE_SWAGGER/);
});

test('Swagger cannot send private definitions to an external validator or run API operations', () => {
  const viewer = readFileSync(new URL('../src/components/admin/AdminSwaggerViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /supportedSubmitMethods: \[\]/);
  assert.match(viewer, /validatorUrl: null/);
  assert.match(viewer, /persistAuthorization: false/);
  assert.match(viewer, /requestInterceptor: \(\) => \{ throw new Error/);
});

test('operation descriptions share the flexible title column rather than the arrow column', () => {
  const page = readFileSync(new URL('../pages/admin/jobs.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/components/admin/JobsPage.module.css', import.meta.url), 'utf8');
  assert.match(page, /className=\{styles.operationCopy\}>\s*<span className=\{ui.actionTitle\}>\{title\}<\/span>\s*<span className=\{ui.actionText\}>\{text\}<\/span>/);
  assert.match(css, /grid-template-columns: 36px minmax\(0, 1fr\)/);
  assert.match(page, /href=\{ADMIN_API_DOCS_PATH\}/);
  assert.doesNotMatch(page, /access_token|X-Admin-Secret|Authorization:/);
});

function response() {
  return { code: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.code = value; return this; },
    json(value) { this.body = value; return this; },
  };
}
const request = { method: 'GET', headers: { authorization: 'Bearer fixture-session' } };
const env = { WRITER_API_URL: 'https://admin.example', NODE_ENV: 'production' };
const spec = { openapi: '3.0.1', info: { title: 'Private API', version: '1' }, paths: {} };

test('denied identities cannot fetch the OpenAPI definition or its assets', async () => {
  for (const code of [401, 403, 503]) {
    const res = response();
    await createAdminDocsHandler({ env,
      requireAdmin: async (_req, out) => { out.status(code).json({ error: 'denied' }); return null; },
      fetchImpl: () => assert.fail('Must not contact the service'),
      getStylesheet: () => assert.fail('Must not read assets'),
    })(request, res);
    assert.equal(res.code, code);
    assert.match(res.headers['Cache-Control'], /no-store/);
    assert.equal(res.headers.Vary, 'Authorization');
  }
});

test('verified admin reads a fixed upstream with their own token, never a shared secret or query token', async () => {
  const res = response();
  await createAdminDocsHandler({ env, requireAdmin: async () => ({ roles: 'ADMIN' }),
    getStylesheet: async () => '.swagger-ui {}',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://admin.example/v3/api-docs');
      assert.deepEqual(options.headers, { Authorization: 'Bearer fixture-session', Accept: 'application/json' });
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      return { ok: true, json: async () => spec };
    },
  })({ ...request, query: { url: 'https://attacker.example', token: 'ignored' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.spec, spec);
});

test('upstream authorization failures and outages remain fail-closed and sanitized', async () => {
  for (const status of [401, 403, 500, 302]) {
    const res = response();
    await createAdminDocsHandler({ env, requireAdmin: async () => ({}),
      getStylesheet: () => assert.fail('No assets after an upstream failure'),
      fetchImpl: async () => ({ ok: false, status, text: async () => 'secret diagnostic' }),
    })(request, res);
    assert.equal(res.code, [401, 403].includes(status) ? status : 502);
    assert.doesNotMatch(JSON.stringify(res.body), /secret diagnostic/);
  }
});

test('documentation diagnostics identify the failure stage without credentials or document content', async () => {
  const logs = [];
  const res = response();
  await createAdminDocsHandler({ env, requireAdmin: async () => ({}),
    logFailure: entry => logs.push(entry),
    fetchImpl: async () => { throw new TypeError('Bearer fixture-session secret diagnostic'); },
  })(request, res);
  assert.equal(res.code, 502);
  assert.deepEqual(logs, [{ event: 'admin_api_docs_failure', stage: 'upstream_request',
    reason: 'TypeError', upstreamStatus: null, upstreamOrigin: 'https://admin.example' }]);
  assert.doesNotMatch(JSON.stringify([logs, res.body]), /fixture-session|secret diagnostic/);
});

test('documentation proxy rejects write methods and unsafe configured origins', async () => {
  const dependencies = { requireAdmin: async () => ({}), fetchImpl: () => assert.fail('No upstream request') };
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = response();
    await createAdminDocsHandler({ ...dependencies, env })({ ...request, method }, res);
    assert.equal(res.code, 405);
    assert.equal(res.headers.Allow, 'GET');
  }
  for (const url of ['http://admin.example', 'https://user:pass@admin.example', 'file:///secret', '']) {
    const res = response();
    await createAdminDocsHandler({ ...dependencies, env: { ...env, WRITER_API_URL: url } })(request, res);
    assert.equal(res.code, 503);
  }
  const res = response();
  await createAdminDocsHandler({ ...dependencies, env })({ ...request, headers: {} }, res);
  assert.equal(res.code, 401);
});

test('the real jobs page keeps its admin gate and the local preview is unavailable in production', () => {
  const page = readFileSync(new URL('../pages/admin/jobs.js', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('../pages/admin/jobs-preview.js', import.meta.url), 'utf8');
  assert.match(page, /<AdminLayout><JobsAuditWorkspace \/><\/AdminLayout>/);
  assert.match(preview, /NODE_ENV === 'development'.*notFound: true/);
});
