import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

// Run after next build. All authentication/service traffic stays in this process.
const require = createRequire(import.meta.url);
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-only-key',
  WRITER_API_URL: 'https://admin.example.test',
});
const calls = [];
let identity = 'ADMIN';
globalThis.fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  if (url === 'https://auth.example.test/auth/v1/user') {
    return Response.json(identity === 'expired' ? { message: 'Expired', code: 'bad_jwt' }
      : { id: 'fixture-user', email: 'admin@example.test' }, { status: identity === 'expired' ? 401 : 200 });
  }
  if (url === 'https://admin.example.test/api/admin/users/me') return Response.json({ role: identity });
  if (url === 'https://admin.example.test/v3/api-docs') return Response.json({ openapi: '3.0.1', info: { title: 'Fixture', version: '1' }, paths: {} });
  throw new Error('Unexpected network destination in compiled documentation test');
};
const { default: handler } = await require('../.next/server/pages/api/admin/api-docs.js');
function response() {
  return { code: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const anonymous = response();
await handler({ method: 'GET', headers: {} }, anonymous);
assert.equal(anonymous.code, 401);
assert.equal(calls.length, 0);
const request = { method: 'GET', headers: { authorization: 'Bearer fixture-session' } };
const admin = response();
await handler(request, admin);
assert.equal(admin.code, 200);
assert.equal(admin.body.spec.info.title, 'Fixture');
assert.equal(admin.body.stylesheet, await readFile(require.resolve('swagger-ui-dist/swagger-ui.css'), 'utf8'));
assert.match(admin.headers['Cache-Control'], /no-store/);
for (const [role, status] of [['EDITOR', 403], ['expired', 401]]) {
  identity = role;
  calls.length = 0;
  const denied = response();
  await handler(request, denied);
  assert.equal(denied.code, status);
  assert.equal(denied.body.spec, undefined);
  assert.equal(calls.some(url => url.endsWith('/v3/api-docs')), false);
}
console.log('PASS production bundle: private auth, embedded Swagger CSS, administrator role, expired-session denial');
