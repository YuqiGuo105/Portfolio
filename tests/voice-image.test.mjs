// The relay's image copies a fixed list of files. A module the relay imports and the image does
// not carry stops the relay at start, and the text gateway for chat lives in the same service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');

function imported(entry) {
  const seen = new Set(), queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1] || match[2])));
    }
  }
  return [...seen].sort();
}

test('every module the voice relay imports is copied into its image and uploaded with its build', () => {
  const needed = imported('services/voice/server.mjs');
  assert.ok(needed.includes('src/lib/voice/publicGuide.mjs') && needed.includes('src/lib/siteGuide.mjs'), 'the walk follows imports out of the service folder');
  const copied = new Set();
  for (const line of read('services/voice/Dockerfile').split('\n').filter(text => text.startsWith('COPY '))) {
    const parts = line.slice(5).trim().split(/\s+/); parts.pop();
    for (const file of parts) copied.add(file);
  }
  const uploaded = new Set(read('services/voice/.gcloudignore').split('\n').filter(text => text.startsWith('!')).map(text => text.slice(1)));
  for (const file of needed) {
    assert.ok(copied.has(file), `${file} is imported by the relay but missing from services/voice/Dockerfile`);
    assert.ok(uploaded.has(file), `${file} is imported by the relay but excluded by services/voice/.gcloudignore`);
  }
});
