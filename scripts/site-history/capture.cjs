// Screenshot one historic build of the homepage, served by `next dev` on PORT (see README.md).
// Usage: node capture.cjs <port> <sha> <yyyy-mm-dd> <outDir>
// Inputs live in $SITE_HISTORY_DATA (default ./data): tables.json (public Supabase rows, filtered here to
// what was published by the commit date), storage/ and extra/ (images by URL), fonts.css plus
// node_modules/@fontsource (Google Fonts served locally). Contact details are blurred before capture.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [port, sha, date, outDir] = process.argv.slice(2);
const HERE = process.env.SITE_HISTORY_DATA || path.join(__dirname, 'data');
const tables = JSON.parse(fs.readFileSync(path.join(HERE, 'tables.json'), 'utf8'));
const storageIndex = JSON.parse(fs.readFileSync(path.join(HERE, 'storage/index.json'), 'utf8'));
const fontsCss = fs.readFileSync(path.join(HERE, 'fonts.css'), 'utf8');
const extra = JSON.parse(fs.readFileSync(path.join(HERE, 'extra/index.json'), 'utf8'));
const cutoff = new Date(date + 'T23:59:59Z');
const PLACEHOLDER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAJYgPq0JFzKQAAAABJRU5ErkJggg==', 'base64');

function existedBy(table, row) {
  const pick = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
  let when = null;
  if (table === 'Projects') when = pick(row.published_at);
  else if (table === 'Blogs') when = pick(row.date);
  else if (table === 'life_blogs') when = pick(row.published_at || row.created_at);
  else if (table === 'experience') when = pick(String(row.date || '').split(' - ')[0].replace(/^(\w{3}) (\d{4})$/, '$1 1, $2'));
  return !when || when <= cutoff;
}

function answer(url, accept) {
  const u = new URL(url);
  const table = decodeURIComponent(u.pathname.split('/rest/v1/')[1] || '');
  let rows = (tables[table] || []).filter((r) => existedBy(table, r));
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = /^(eq|neq|is|gt|gte|lt|lte|ilike|like|in)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((r) => {
      const val = r[k];
      if (op === 'eq') return String(val) === raw;
      if (op === 'neq') return String(val) !== raw;
      if (op === 'is') return raw === 'null' ? val == null : String(val) === raw;
      if (op === 'in') return raw.replace(/[()]/g, '').split(',').includes(String(val));
      return true;
    });
  }
  const order = u.searchParams.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    rows = [...rows].sort((a, b) => (String(a[col]) > String(b[col]) ? 1 : -1) * (dir === 'desc' ? -1 : 1));
  }
  const offset = Number(u.searchParams.get('offset') || 0);
  const limit = Number(u.searchParams.get('limit') || rows.length);
  rows = rows.slice(offset, offset + limit);
  if ((accept || '').includes('vnd.pgrst.object')) return rows[0] || null;
  return rows;
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' });
  await ctx.route(/iyvhmpdfrnznxgyvvkvx\.supabase\.co/, async (route) => {
    const req = route.request();
    const url = req.url();
    if (extra[url]) return route.fulfill({ status: 200, contentType: extra[url].type, body: fs.readFileSync(path.join(HERE, 'extra', extra[url].file)) });
    if (url.includes('/rest/v1/')) {
      const body = answer(url, req.headers()['accept']);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Array.isArray(body) ? body.length : 1}/*`, 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    }
    if (url.includes('/storage/v1/object/')) {
      const p = decodeURIComponent(new URL(url).pathname);
      const hit = Object.entries(storageIndex).find(([k]) => decodeURIComponent(k) === p);
      if (hit) return route.fulfill({ status: 200, contentType: 'image/webp', body: fs.readFileSync(path.join(HERE, 'storage', hit[1])) });
      return route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });
  await ctx.route(/skillicons\.dev/, (r) => { const hit = extra[r.request().url()]; return hit ? r.fulfill({ status: 200, contentType: hit.type, body: fs.readFileSync(path.join(HERE, 'extra', hit.file)) }) : r.abort(); });
  await ctx.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fontsCss }));
  await ctx.route(/local-fonts\.invalid/, (r) => {
    const rel = new URL(r.request().url()).pathname.slice(1).split('/');
    return r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(path.join(HERE, 'node_modules/@fontsource', rel[0], 'files', rel[1])) });
  });
  // Third-party scripts (analytics, reCAPTCHA, GitHub, weather…) cannot load here; fail fast instead of hanging.
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|local-fonts\.invalid|iyvhmpdfrnznxgyvvkvx|fonts\.googleapis|skillicons\.dev|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForTimeout(7000);
  const hide = `nextjs-portal, #__next-build-watcher, .cursor, [class*=SubscribeDialog_overlay], .launch-button, [data-nextjs-toast] { display: none !important; }`;
  await page.addStyleTag({ content: hide });
  for (const name of ['Not now', 'No thanks', 'Close', 'Dismiss']) {
    const b = page.getByRole('button', { name, exact: true });
    if (await b.count()) await b.first().click({ timeout: 1500 }).catch(() => {});
  }
  // Walk down the page so scroll-triggered animations and lazy sections render, then return to the top.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 700) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(250); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: hide });
  // Old versions printed a phone number and email in Contact Me; blur any contact details before capturing.
  const redacted = await page.evaluate(() => {
    const re = /(\+?1?[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{4})|([\w.+-]+@[\w-]+\.[\w.]+)/;
    let n = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) if (re.test(walker.currentNode.nodeValue)) hits.push(walker.currentNode.parentElement);
    for (const el of hits) { if (el && !el.closest('script,style')) { el.style.filter = 'blur(6px)'; n++; } }
    document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], input[type=email]').forEach((el) => { if (el.innerText.trim()) { el.style.filter = 'blur(6px)'; n++; } });
    return n;
  });
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, `${sha}-cover.png`) });
  await page.screenshot({ path: path.join(outDir, `${sha}-full.png`), fullPage: true });
  const title = await page.title();
  fs.writeFileSync(path.join(outDir, `${sha}.json`), JSON.stringify({ sha, date, title, height, redacted, errors: errors.slice(0, 8) }, null, 1));
  console.log(JSON.stringify({ sha, date, height, redacted, errors: errors.length }));
  await browser.close();
})().catch((e) => { console.error('CAPTURE FAILED', e.message); process.exit(1); });
