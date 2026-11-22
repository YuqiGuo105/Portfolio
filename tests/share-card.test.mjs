import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { publicProfile } from '../src/lib/share/model.mjs';
import { shareUrl } from '../src/lib/share/link.mjs';
import { qrMatrix, qrSvg } from '../src/lib/share/qr.mjs';
import { buildVCard, vcardForQr } from '../src/lib/share/vcard.mjs';
import { POSTER, wrapLines } from '../src/lib/share/poster.mjs';

test('public cards never expose contact settings or private work-history text', () => {
  const profile = publicProfile({ title: 'Engineer', company: 'Example', phone: '+15551231234', email: 'private@example.com', team: 'private team' });
  const card = buildVCard(profile);
  assert.match(card, /FN:Yuqi Guo/);
  assert.match(card, /ORG:Example/);
  assert.match(card, /URL:https:\/\/www.yuqi.site/);
  assert.doesNotMatch(card, /TEL[;:]|EMAIL[;:]|private/);
  assert.equal(Buffer.byteLength(vcardForQr(profile)) < 1500, true);
});

test('card share URLs stay on the site and QR SVGs retain a four-module margin', () => {
  for (const via of ['qr', 'link', 'image', 'system']) {
    const url = shareUrl('/card', via);
    assert.equal(url, `https://www.yuqi.site/card?via=${via}`);
    const matrix = qrMatrix(url);
    assert.ok(matrix.size > 20);
    assert.match(qrSvg(url, { quiet: 4 }), new RegExp(`viewBox="0 0 ${matrix.size + 8} ${matrix.size + 8}"`));
  }
});

test('poster dimensions and long text wrapping remain bounded', () => {
  assert.deepEqual([POSTER.width, POSTER.height], [1080, 1350]);
  const lines = wrapLines(s => s.length * 10, 'A long role at an engineering company', 80, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines.every(line => line.length <= 8));
});

test('the release uses a lazy public-card-only host without article or private-share hooks', () => {
  const host = readFileSync(new URL('../src/components/share/ShareHost.js', import.meta.url), 'utf8');
  assert.match(host, /dynamic\(\(\) => import\("\.\/ShareSheet"\)/);
  assert.match(host, /event.detail\?\.kind === "card"/);
  assert.doesNotMatch(host, /selectionchange|setInterval|ShareRail/);
  const card = readFileSync(new URL('../pages/card/index.js', import.meta.url), 'utf8');
  assert.match(card, /getStaticProps/);
  assert.match(card, /revalidate: rows.length \? 300 : 30/);
});
