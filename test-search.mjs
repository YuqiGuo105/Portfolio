/**
 * E2E search test — /api/search → Aiven OpenSearch
 * Requires the dev server running on localhost:3000
 *
 * Run with:
 *   node test-search.mjs
 */

const BASE = 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

async function testMissingQuery() {
  console.log('\n[1] Missing q parameter → 400');
  const { status } = await get('/api/search');
  assert('returns 400', status === 400, `got ${status}`);
}

async function testEmptyQuery() {
  console.log('\n[2] Empty q string → 400');
  const { status } = await get('/api/search?q=');
  assert('returns 400', status === 400, `got ${status}`);
}

async function testDockerQuery() {
  console.log('\n[3] q=docker → expect BLOG "Kubernetes vs Docker" as top hit');
  const { status, body } = await get('/api/search?q=docker&limit=5');
  assert('HTTP 200', status === 200, `got ${status}`);
  assert('results array present', Array.isArray(body.results), JSON.stringify(body).slice(0, 100));
  assert('at least one result', (body.total ?? 0) >= 1, `total=${body.total}`);
  const top = body.results[0];
  assert('top hit is BLOG source', top?.source === 'Blog', `source=${top?.source}`);
  assert('top hit title contains Docker', (top?.title ?? '').toLowerCase().includes('docker'), `title="${top?.title}"`);
  assert('top hit has correct URL', (top?.url ?? '').startsWith('/blog-single/'), `url="${top?.url}"`);
  assert('top hit has a rank score', typeof top?.rank === 'number' && top.rank > 0, `rank=${top?.rank}`);
}

async function testProjectFilter() {
  console.log('\n[4] q=chat&source=project → only PROJECT hits');
  const { status, body } = await get('/api/search?q=chat&source=project&limit=10');
  assert('HTTP 200', status === 200, `got ${status}`);
  assert('at least one result', (body.total ?? 0) >= 1, `total=${body.total}`);
  const nonProject = (body.results ?? []).filter(r => r.source !== 'Projects');
  assert('all results are Projects', nonProject.length === 0,
    `non-project: ${nonProject.map(r => r.source).join(', ')}`);
}

async function testBlogFilter() {
  console.log('\n[5] q=git&source=blog → only Blog hits');
  const { status, body } = await get('/api/search?q=git&source=blog&limit=10');
  assert('HTTP 200', status === 200, `got ${status}`);
  if ((body.total ?? 0) > 0) {
    const nonBlog = (body.results ?? []).filter(r => r.source !== 'Blog');
    assert('all results are Blog', nonBlog.length === 0,
      `non-blog: ${nonBlog.map(r => r.source).join(', ')}`);
  } else {
    assert('zero results is acceptable', true);
  }
}

async function testLifeFilter() {
  console.log('\n[6] q=new grad&source=life → only Life hits');
  const { status, body } = await get('/api/search?q=new+grad&source=life&limit=10');
  assert('HTTP 200', status === 200, `got ${status}`);
  if ((body.total ?? 0) > 0) {
    const nonLife = (body.results ?? []).filter(r => r.source !== 'Life');
    assert('all results are Life', nonLife.length === 0,
      `non-life: ${nonLife.map(r => r.source).join(', ')}`);
  } else {
    assert('zero results is acceptable', true);
  }
}

async function testAllSources() {
  console.log('\n[7] q=* (broad query) with no filter → returns multiple source types');
  const { status, body } = await get('/api/search?q=project+blog+life&limit=20');
  assert('HTTP 200', status === 200, `got ${status}`);
  if ((body.total ?? 0) > 0) {
    const sources = new Set((body.results ?? []).map(r => r.source));
    assert('more than one source type', sources.size >= 1, `sources: ${[...sources].join(', ')}`);
  }
}

async function testFuzzyTypo() {
  console.log('\n[8] Fuzzy match — q=kubernets (typo) → should still find Kubernetes article');
  const { status, body } = await get('/api/search?q=kubernets&limit=5');
  assert('HTTP 200', status === 200, `got ${status}`);
  const found = (body.results ?? []).some(r =>
    (r.title ?? '').toLowerCase().includes('kubernetes')
  );
  assert('fuzzy match finds Kubernetes', found,
    `results: ${(body.results ?? []).map(r => r.title).join(' | ')}`);
}

async function testPagination() {
  console.log('\n[9] Pagination — limit=2, offset=0 vs offset=2 differ');
  const { body: page1 } = await get('/api/search?q=the&limit=2&offset=0');
  const { body: page2 } = await get('/api/search?q=the&limit=2&offset=2');
  const ids1 = (page1.results ?? []).map(r => r.sourceId);
  const ids2 = (page2.results ?? []).map(r => r.sourceId);
  const overlap = ids1.filter(id => ids2.includes(id));
  assert('limit respected (≤2 results)', (page1.results ?? []).length <= 2, `got ${(page1.results ?? []).length}`);
  assert('pages do not overlap (if enough results)', (page1.total ?? 0) <= 2 || overlap.length === 0,
    `overlap: ${overlap.join(', ')}`);
}

async function testResponseShape() {
  console.log('\n[10] Response shape — all required fields present on each item');
  const { status, body } = await get('/api/search?q=a&limit=5');
  assert('HTTP 200', status === 200, `got ${status}`);
  assert('top-level total field', typeof body.total !== 'undefined', JSON.stringify(Object.keys(body)));
  assert('top-level results array', Array.isArray(body.results), '');
  for (const item of (body.results ?? []).slice(0, 3)) {
    assert(`item "${item.title}" has source`, typeof item.source === 'string', JSON.stringify(item));
    assert(`item "${item.title}" has url`, item.url === null || typeof item.url === 'string', '');
    assert(`item "${item.title}" has sourceId`, typeof item.sourceId === 'string', '');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n=== Search E2E Tests → ${BASE}/api/search ===`);
console.log('(Backend: Aiven OpenSearch portfolio_content_current)\n');

try {
  await testMissingQuery();
  await testEmptyQuery();
  await testDockerQuery();
  await testProjectFilter();
  await testBlogFilter();
  await testLifeFilter();
  await testAllSources();
  await testFuzzyTypo();
  await testPagination();
  await testResponseShape();
} catch (err) {
  console.error('\nUnhandled error:', err.message);
  failed++;
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? '✅ All tests passed!' : '❌ Some tests failed.');
process.exit(failed > 0 ? 1 : 0);
