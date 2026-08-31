import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('manifest uses a bounded Manifest V3 permission surface', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ['https://www.yuqi.site/*']);
  assert.ok(!manifest.permissions.includes('webRequest'));
  assert.ok(!manifest.permissions.includes('cookies'));
});

test('extension source contains no embedded privileged credential', async () => {
  const files = ['manifest.json', 'background.js', 'sidepanel.js', 'sidepanel.html'];
  const source = (await Promise.all(files.map((file) => readFile(resolve(root, file), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /serviceRoleKey|ADMIN_SECRET|SUPABASE_JWT_SECRET|AVNS_/i);
});

test('background navigation is restricted to named first-party routes', async () => {
  const source = await readFile(resolve(root, 'background.js'), 'utf8');
  assert.match(source, /https:\/\/www\.yuqi\.site/);
  assert.match(source, /Unsupported route/);
  assert.doesNotMatch(source, /optional_host_permissions/);
});
