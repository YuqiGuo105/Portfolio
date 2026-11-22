// The picture a visitor can save and send: what is being shared, who it is from, and a QR code
// back to it. Drawn on a canvas in the visitor's browser, so making one costs the site nothing.
import { qrMatrix } from './qr.mjs';

export const POSTER = { width: 1080, height: 1350, pad: 84 };
const INK = '#1c2528', PAPER = '#f7f5f2', ACCENT = '#245449', MUTED = '#5b6b66';
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;

// Breaks text into lines no wider than maxWidth. Latin text breaks between words, CJK between
// characters, and a word longer than a line is split. A last line that does not fit ends in "…".
export function wrapLines(measure, text, maxWidth, maxLines = Infinity) {
  const tokens = String(text ?? '').replace(/\s+/g, ' ').trim().match(/\s|[⺀-鿿가-힯豈-﫿＀-￯]|[^\s⺀-鿿가-힯豈-﫿＀-￯]+/g) || [];
  const lines = [];
  let line = '';
  const push = () => { lines.push(line.trimEnd()); line = ''; };
  for (const token of tokens) {
    if (token === ' ') { if (line) line += ' '; continue; }
    if (measure(line + token) <= maxWidth) { line += token; continue; }
    if (line.trim()) push();
    if (measure(token) <= maxWidth) { line = token; continue; }
    for (const char of token) { // one word wider than the line
      if (line && measure(line + char) > maxWidth) push();
      line += char;
    }
  }
  if (line.trim()) push();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(`${last}…`) > maxWidth) last = [...last].slice(0, -1).join('');
  kept[maxLines - 1] = `${last.replace(/[\s,;:.，。；：]+$/, '')}…`;
  return kept;
}

// The site's two typefaces, loaded from its own files so the picture looks the same everywhere.
let fontsReady;
export function loadPosterFonts() {
  if (fontsReady) return fontsReady;
  const face = (family, file, weight) => new FontFace(family, `url(/assets/fonts/share/${file})`, { weight: String(weight) }).load().then(loaded => { document.fonts.add(loaded); });
  fontsReady = Promise.all([
    face('Share Serif', 'sorts-mill-goudy-latin-400-normal.woff', 400),
    face('Share Sans', 'rubik-latin-400-normal.woff', 400),
    face('Share Sans', 'rubik-latin-500-normal.woff', 500),
  ]).then(() => true, () => false);
  return fontsReady;
}

const SERIF = '"Share Serif", "Sorts Mill Goudy", "Songti SC", "Noto Serif CJK SC", Georgia, serif';
const SANS = '"Share Sans", "Rubik", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif';
const sizeFor = (text, steps) => { const length = [...String(text)].reduce((sum, char) => sum + (CJK.test(char) ? 2 : 1), 0); return (steps.find(([max]) => length <= max) || steps[steps.length - 1])[1]; };
export const displayUrl = url => { try { const parsed = new URL(url); return `${parsed.host.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`; } catch { return String(url || ''); } };

// content: { kind: 'page' | 'quote' | 'card' | 'answer', label, title, text, source, url, qrUrl, name, role }
export function drawPoster(ctx, content) {
  const { width, height, pad } = POSTER;
  const inner = width - pad * 2;
  const set = (font, color) => { ctx.font = font; ctx.fillStyle = color; };
  const measure = text => ctx.measureText(text).width;
  const block = (text, font, color, y, lineHeight, maxLines, x = pad, maxWidth = inner) => {
    set(font, color);
    const lines = wrapLines(measure, text, maxWidth, maxLines);
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
    return y + lines.length * lineHeight;
  };
  ctx.textBaseline = 'top';
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, width, height);

  // What this is.
  ctx.fillStyle = ACCENT; ctx.fillRect(pad, 104, 56, 5);
  set(`500 30px ${SANS}`, ACCENT);
  ctx.fillText(content.label || 'yuqi.site', pad + 76, 90);

  const footTop = height - pad - 250;
  let y = 196;
  if (content.kind === 'quote') {
    const size = sizeFor(content.text, [[90, 68], [170, 58], [240, 50], [Infinity, 44]]);
    const lineHeight = Math.round(size * 1.3);
    const maxLines = Math.floor((footTop - 150 - y) / lineHeight);
    const end = block(content.text, `400 ${size}px ${SERIF}`, INK, y, lineHeight, maxLines, pad + 38, inner - 38);
    ctx.fillStyle = ACCENT; ctx.fillRect(pad, y + 6, 6, end - y - 16);
    if (content.source) block(content.source, `400 30px ${SANS}`, MUTED, end + 30, 42, 2, pad + 38, inner - 38);
  } else if (content.kind === 'card') {
    y = block(content.title, `400 124px ${SERIF}`, INK, y + 20, 132, 2);
    if (content.text) y = block(content.text, `400 40px ${SANS}`, INK, y + 26, 54, 3);
    if (content.source) block(content.source, `400 32px ${SANS}`, MUTED, y + 22, 46, 4);
  } else if (content.kind === 'answer') {
    y = block(content.title, `500 40px ${SANS}`, ACCENT, y, 54, 3);
    const lineHeight = 62;
    block(content.text, `400 46px ${SERIF}`, INK, y + 36, lineHeight, Math.floor((footTop - 60 - y - 36) / lineHeight));
  } else {
    const size = sizeFor(content.title, [[26, 116], [48, 96], [84, 78], [Infinity, 64]]);
    y = block(content.title, `400 ${size}px ${SERIF}`, INK, y, Math.round(size * 1.1), 5);
    if (content.text) block(content.text, `400 36px ${SANS}`, MUTED, y + 34, 52, Math.max(0, Math.min(5, Math.floor((footTop - 40 - y - 34) / 52))));
  }

  // Where it leads, and who it is from.
  ctx.fillStyle = INK; ctx.fillRect(pad, footTop, inner, 2);
  const box = 216, quiet = 4, top = footTop + 34;
  const { size, dark } = qrMatrix(content.qrUrl || content.url, 'M');
  const cell = Math.floor(box / (size + quiet * 2));
  const drawn = cell * (size + quiet * 2);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(pad, top, drawn, drawn);
  ctx.fillStyle = INK;
  for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) if (dark(row, column)) ctx.fillRect(pad + (column + quiet) * cell, top + (row + quiet) * cell, cell, cell);
  const x = pad + drawn + 40, column = inner - drawn - 40;
  set(`500 32px ${SANS}`, INK); ctx.fillText(content.kind === 'card' ? 'Open contact card' : 'Scan to open', x, top + 4);
  block(displayUrl(content.url), `400 28px ${SANS}`, MUTED, top + 52, 38, 2, x, column);
  set(`500 30px ${SANS}`, INK); ctx.fillText(content.name || 'Yuqi Guo', x, top + drawn - 78);
  set(`400 26px ${SANS}`, MUTED); ctx.fillText(wrapLines(measure, content.role || 'Software Engineer', column, 1)[0] || '', x, top + drawn - 38);
}

export async function posterCanvas(content) {
  await loadPosterFonts();
  const canvas = document.createElement('canvas');
  canvas.width = POSTER.width; canvas.height = POSTER.height;
  drawPoster(canvas.getContext('2d'), content);
  return canvas;
}

export const canvasBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The picture could not be made'))), 'image/png'));

export const fileName = (title, suffix = 'share') => `${String(title || 'yuqi-site').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 48) || 'yuqi-site'}-${suffix}.png`;
