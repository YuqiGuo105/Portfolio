import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { INTRO_SEGMENTS } from '../src/lib/media/introPlan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { createCanvas, loadImage } = require(process.env.CANVAS_MODULE || path.join(bundled, '@napi-rs/canvas'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const lucide = require('lucide-react');
const ffmpeg = process.env.FFMPEG_PATH || path.resolve(root, '../.media-tools/runtime/bin/ffmpeg');
const out = path.join(root, 'public/demos');
const captures = path.join(root, '.media-review/captures');
const proof = path.join(root, '.media-review/proof');
const canvas = createCanvas(1280, 720);
const c = canvas.getContext('2d');
const colors = { ink: '#202c34', muted: '#63737b', line: '#d7e1e4', bg: '#f5f8fa', teal: '#138678', blue: '#2873c9', gold: '#b87c20', plum: '#8051bc' };
const icons = {};
for (const name of ['FileText', 'Database', 'Radio', 'Search', 'BrainCircuit', 'GitMerge', 'Check', 'Send', 'MessageSquare', 'Layers', 'Workflow', 'ArrowRight', 'ShieldCheck', 'CircleCheck']) {
  icons[name] = await loadImage(Buffer.from(renderToStaticMarkup(React.createElement(lucide[name], { size: 72, color: colors.ink, strokeWidth: 1.7 }))));
}
const ease = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
function box(x, y, w, h, fill = '#fff', stroke = colors.line, radius = 8) {
  c.beginPath(); c.roundRect(x, y, w, h, radius); c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.3; c.stroke(); }
}
function text(value, x, y, size = 20, color = colors.ink, weight = 400) {
  c.font = `${weight} ${size}px Arial, sans-serif`; c.fillStyle = color; c.fillText(value, x, y);
}
function lines(value, x, y, width, size = 20, color = colors.ink, weight = 400, limit = 4) {
  c.font = `${weight} ${size}px Arial, sans-serif`;
  let line = ''; let row = 0;
  for (const word of value.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > width && line) {
      text(line, x, y + row * size * 1.45, size, color, weight); row++; line = word;
      if (row >= limit) return;
    } else line = next;
  }
  text(line, x, y + row * size * 1.45, size, color, weight);
}
function icon(name, x, y, size = 30) { c.drawImage(icons[name], x, y, size, size); }
function pill(value, x, y, w, color = colors.teal) { box(x, y, w, 30, `${color}15`, null, 15); text(value, x + 12, y + 20, 13, color, 600); }
function base(title, subtitle, label) {
  c.fillStyle = colors.bg; c.fillRect(0, 0, 1280, 720);
  text('YUQI GUO / ENGINEERING', 40, 36, 12, colors.muted, 600);
  text(title, 40, 84, 32, colors.ink, 700);
  text(subtitle, 40, 114, 16, colors.muted);
  text(label, 40, 694, 12, colors.muted);
}
function progress(t, duration, labels) {
  const w = 1192 / labels.length;
  labels.forEach((label, i) => {
    const x = 44 + i * w;
    box(x, 632, w - 16, 3, colors.line, null, 1);
    box(x, 632, (w - 16) * Math.max(0, Math.min(1, t / duration * labels.length - i)), 3, colors.teal, null, 1);
    text(label, x, 660, 14, t / duration * labels.length >= i ? colors.ink : colors.muted, 500);
  });
}
function cursor(x, y, click) {
  c.save(); c.translate(x, y); c.beginPath(); c.moveTo(0, 0); c.lineTo(3, 24); c.lineTo(9, 17); c.lineTo(18, 16); c.closePath();
  c.fillStyle = colors.ink; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
  if (click > 0) { c.beginPath(); c.arc(4, 6, 10 + click * 22, 0, Math.PI * 2); c.strokeStyle = `rgba(19,134,120,${1 - click})`; c.stroke(); }
  c.restore();
}
function publishScene(t) {
  box(68, 150, 1144, 446);
  box(68, 150, 1144, 48, '#edf2f4'); icon('FileText', 88, 161, 25); text('Content editor', 124, 181, 16, colors.ink, 600);
  pill(t > 2.2 ? 'Published' : 'Draft', 1060, 159, 124, t > 2.2 ? colors.teal : colors.muted);
  text('PROJECT / ARTICLE', 108, 240, 12, colors.muted, 600);
  text('Building reliable content delivery', 108, 285, 30, colors.ink, 600);
  text('An article becomes search results and grounded AI context.', 108, 320, 18, colors.muted);
  for (let i = 0; i < 5; i++) box(108, 357 + i * 25, [610, 572, 625, 400, 520][i], 7, '#dfe6e9', null, 3);
  box(899, 226, 271, 242, '#f7fafb');
  icon('ShieldCheck', 925, 246, 30); text('Publish checks', 966, 268, 18, colors.ink, 600);
  ['Validated content', 'Version recorded', 'Indexing queued'].forEach((item, i) => {
    icon(t > 2.2 + i * 0.35 ? 'CircleCheck' : 'Layers', 924, 303 + i * 47, 23);
    text(item, 959, 322 + i * 47, 15, colors.muted);
  });
  box(1000, 504, 170, 52, t > 2.2 ? colors.teal : colors.ink, null);
  text(t > 2.2 ? 'Published' : 'Publish article', 1020, 537, 18, '#fff', 600);
  const p = ease((t - 0.5) / 1.5); cursor(775 + p * 304, 466 + p * 66, t > 2.1 && t < 2.7 ? (t - 2.1) / 0.6 : 0);
  if (t > 2.8) { icon('Radio', 109, 512, 28); text('Article saved. Indexing continues asynchronously.', 151, 533, 17, colors.teal, 500); }
}
function connector(points, start, t, color = colors.teal) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = t >= start ? `${color}85` : colors.line; c.lineWidth = 2; c.stroke();
  if (t < start) return;
  const distances = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
  const total = distances.reduce((a, b) => a + b, 0);
  for (let n = 0; n < 2; n++) {
    let distance = ((t - start + n * 1.2) % 2.4) / 2.4 * total;
    for (let i = 0; i < distances.length; i++) {
      if (distance <= distances[i]) {
        const p = distance / distances[i]; const x = points[i][0] + (points[i + 1][0] - points[i][0]) * p; const y = points[i][1] + (points[i + 1][1] - points[i][1]) * p;
        box(x - 7, y - 5, 14, 10, color, '#fff', 2); break;
      }
      distance -= distances[i];
    }
  }
}
function service({ x, y, w, h, name, detail, iconName, color, ready }) {
  box(x, y, w, h, '#fff', ready ? color : colors.line);
  box(x + 16, y + 16, 42, 42, `${color}12`, null); icon(iconName, x + 23, y + 23, 28);
  text(name, x + 16, y + 88, 18, colors.ink, 600);
  text(detail, x + 16, y + 115, 13, colors.muted);
  if (ready) { c.beginPath(); c.arc(x + w - 20, y + 25, 4, 0, Math.PI * 2); c.fillStyle = color; c.fill(); }
}
function pipelineScene(t) {
  const ready = t > 5;
  connector([[260, 306], [322, 306]], 5, t);
  connector([[552, 306], [604, 306]], 6.4, t, colors.blue);
  connector([[704, 375], [704, 418]], 7.8, t, colors.gold);
  connector([[804, 480], [868, 480], [868, 280], [926, 280]], 9.3, t, colors.blue);
  connector([[804, 480], [926, 480]], 9.3, t, colors.plum);
  service({ x: 40, y: 236, w: 220, h: 140, name: 'Published article', detail: 'Content API', iconName: 'FileText', color: colors.teal, ready });
  service({ x: 322, y: 236, w: 230, h: 140, name: 'Postgres + Outbox', detail: 'One atomic transaction', iconName: 'Database', color: colors.blue, ready: t > 6 });
  service({ x: 604, y: 236, w: 200, h: 140, name: 'Outbox relay', detail: 'Publish / acknowledge', iconName: 'Send', color: colors.gold, ready: t > 7.5 });
  service({ x: 604, y: 418, w: 200, h: 140, name: 'Apache Kafka', detail: 'Independent topics', iconName: 'Radio', color: colors.gold, ready: t > 8.5 });
  service({ x: 926, y: 210, w: 310, h: 140, name: 'Search indexer', detail: 'Version guard > OpenSearch', iconName: 'Search', color: colors.blue, ready: t > 10.5 });
  service({ x: 926, y: 410, w: 310, h: 140, name: 'RAG indexer', detail: 'Chunks > embeddings > pgvector', iconName: 'BrainCircuit', color: colors.plum, ready: t > 11.5 });
  pill('WRITE', 40, 177, 77); pill('COMMIT', 322, 177, 94, colors.blue); pill('DELIVER', 604, 177, 102, colors.gold); pill('INDEX', 926, 155, 80, colors.plum);
  if (t > 12) {
    icon('ShieldCheck', 43, 447, 32); text('Durable event', 91, 469, 18, colors.ink, 600);
    text('Retry safely. Apply each version once.', 43, 507, 16, colors.muted);
  }
}
function resultScene(t) {
  box(44, 154, 480, 428);
  icon('Search', 67, 177, 26); text('Portfolio search', 107, 198, 20, colors.ink, 600);
  box(68, 221, 432, 48, '#f6f8fa'); text('reliable content delivery', 86, 252, 17);
  const p = ease((t - 16) / 0.7);
  c.save(); c.globalAlpha = p;
  box(68, 291, 432, 218, '#fff', colors.blue);
  pill('PROJECT', 88, 309, 91, colors.blue);
  lines('Building reliable content delivery', 88, 371, 380, 24, colors.ink, 600);
  lines('Article publishing, durable events and independently rebuilt indexes.', 88, 447, 370, 17, colors.muted);
  text('OpenSearch', 68, 553, 14, colors.blue, 600); c.restore();
  box(550, 154, 686, 428);
  icon('BrainCircuit', 574, 177, 28); text('Mr. Pot / grounded answer', 616, 198, 20, colors.ink, 600);
  box(575, 222, 636, 55, '#eef4f6', null); text('How does a published article reach the AI?', 593, 256, 18);
  const answer = ['The article and its publish event commit together.', 'Kafka then feeds two independent indexing paths.', 'The RAG worker chunks and embeds the content.', 'Mr. Pot retrieves those passages to ground its answer.'];
  answer.forEach((line, i) => {
    const count = Math.floor(Math.max(0, Math.min(1, (t - 17 - i * 0.9) / 0.7)) * line.length);
    text(line.slice(0, count), 577, 320 + i * 36, 17, colors.ink);
  });
  if (t > 21) { pill('[1] Building reliable content delivery', 576, 488, 305, colors.plum); text('Retrieved source / article version', 578, 548, 14, colors.muted); }
}
function contentFrame(t) {
  base('Content Intelligence Platform', 'Publish once. Power search and grounded AI.', 'Architecture animation / illustrative content and response');
  const a = ease((t - 4.4) / 0.6); const b = ease((t - 15.4) / 0.6);
  if (a < 1) { c.save(); c.globalAlpha = 1 - a; publishScene(t); c.restore(); }
  if (a > 0 && b < 1) { c.save(); c.globalAlpha = a * (1 - b); pipelineScene(t); c.restore(); }
  if (b > 0) { c.save(); c.globalAlpha = b; resultScene(t); c.restore(); }
  progress(t, 24, ['Publish', 'Commit + relay', 'Kafka + indexing', 'Search + AI']);
}
const prImages = [];
for (const name of ['rxjava-8399', 'adk-1381', 'adk-923', 'kubernetes-4868', 'kubernetes-4751', 'kubernetes-4746', 'alibaba-4491', 'langextract-385']) {
  prImages.push(await loadImage(await fs.readFile(path.join(captures, `pr-${name}.jpg`))));
}
function openSourceFrame(t) {
  c.fillStyle = '#fff'; c.fillRect(0, 0, 1280, 720);
  const index = Math.min(prImages.length - 1, Math.floor(t / 0.75));
  function shot(i, alpha) {
    const img = prImages[i]; const scale = Math.min(1280 / img.width, 720 / img.height);
    c.save(); c.globalAlpha = alpha;
    c.drawImage(img, (1280 - img.width * scale) / 2, (720 - img.height * scale) / 2, img.width * scale, img.height * scale);
    c.restore();
  }
  if (index > 0 && t % 0.75 < 0.08) { shot(index - 1, 1); shot(index, ease((t % 0.75) / 0.08)); }
  else shot(index, 1);
}
const talkImages = [];
for (let i = 1; i <= 5; i++) talkImages.push(await loadImage(await fs.readFile(path.join(captures, `talk-live-0${i}.jpg`))));
function talkFrame(t) {
  c.fillStyle = '#f6f7fb'; c.fillRect(0, 0, 1280, 720);
  const boundaries = [0, 2.6, 4.8, 7.6, 11];
  let index = boundaries.findLastIndex(value => value <= t);
  function shot(i, alpha) {
    c.save(); c.globalAlpha = alpha;
    const img = talkImages[i]; const scale = Math.min(1280 / img.width, 720 / img.height);
    c.drawImage(img, (1280 - img.width * scale) / 2, (720 - img.height * scale) / 2, img.width * scale, img.height * scale); c.restore();
  }
  if (index > 0 && t - boundaries[index] < 0.25) { shot(index - 1, 1); shot(index, ease((t - boundaries[index]) / 0.25)); }
  else shot(index, 1);
}
const encode = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.status}`);
}
async function render(id, seconds, draw) {
  const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '24', '-c:v', 'png', '-i', '-', ...encode, path.join(out, `${id}.mp4`)], { stdio: ['pipe', 'inherit', 'inherit'] });
  const completion = once(encoder, 'close');
  for (let frame = 0; frame < seconds * 24; frame++) {
    draw(frame / 24);
    if (!encoder.stdin.write(await canvas.encode('png'))) await once(encoder.stdin, 'drain');
  }
  encoder.stdin.end();
  const [code] = await completion; if (code !== 0) throw new Error(`render failed: ${id}`);
  run(['-ss', id === 'content-intelligence' ? '7' : '0', '-i', path.join(out, `${id}.mp4`), '-t', '6', '-vf', 'scale=960:540', ...encode, path.join(out, `${id}-hover.mp4`)]);
  run(['-ss', id === 'content-intelligence' ? '13' : '1', '-i', path.join(out, `${id}.mp4`), '-frames:v', '1', '-c:v', 'libwebp', '-quality', '90', path.join(out, `${id}.webp`)]);
  console.log(`Rendered ${id}: ${seconds}s`);
}
await fs.mkdir(proof, { recursive: true });
for (const [name, draw, time] of [['content-pipeline', contentFrame, 13], ['content-ai', contentFrame, 22], ['open-source-overview', openSourceFrame, 5], ['talk-live', talkFrame, 1]]) {
  draw(time); await fs.writeFile(path.join(proof, `${name}.png`), await canvas.encode('png'));
}
if (process.argv.includes('--stills')) process.exit(0);
const manifestOnly = process.argv.includes('--manifest-only');
const only = process.argv.find(arg => arg.startsWith('--only='))?.split('=')[1];
if (!manifestOnly) {
  if (!only || only === 'content-intelligence') await render('content-intelligence', 24, contentFrame);
  if (!only || only === 'open-source') await render('open-source', 6, openSourceFrame);
  if (!only || only === 'talknest') await render('talknest', 14, talkFrame);
}

// Existing platform and subscription footage is not edited or regenerated.
const ids = ['platform-walkthrough', 'open-source', 'content-intelligence', 'talknest', 'notifications'];
const input = INTRO_SEGMENTS.flatMap(segment => ['-i', path.join(out, `${segment.source}.mp4`)]);
const filters = INTRO_SEGMENTS.map((segment, i) => `[${i}:v]trim=start=${segment.start}:end=${segment.end},setpts=${segment.seconds / (segment.end - segment.start)}*(PTS-STARTPTS),scale=1280:720,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=1,trim=duration=${segment.seconds}[v${i}]`);
filters.push(INTRO_SEGMENTS.map((_, i) => `[v${i}]`).join('') + `concat=n=${INTRO_SEGMENTS.length}:v=1:a=0[out]`);
if (!manifestOnly) {
  run([...input, '-filter_complex_threads', '2', '-filter_complex', filters.join(';'), '-map', '[out]', ...encode, path.join(out, 'yuqi-intro.mp4')]);
  const stamp = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}.000`;
  let elapsed = 0;
  const cues = INTRO_SEGMENTS.map(segment => {
    const start = elapsed; elapsed += segment.seconds;
    return `${stamp(start)} --> ${stamp(elapsed)}\n${segment.caption}`;
  });
  await fs.writeFile(path.join(out, 'yuqi-intro.vtt'), `WEBVTT\n\n${cues.join('\n\n')}\n`);
}

const renditions = {};
for (const id of [...ids, 'yuqi-intro']) {
  renditions[id] = [];
  for (const height of [720, 480, 360]) {
    const file = height === 720 && id !== 'platform-walkthrough' ? `${id}.mp4` : `${id}-${height}.mp4`;
    if (!manifestOnly && (!only || id === only || id === 'yuqi-intro') && !(height === 720 && id !== 'platform-walkthrough')) run(['-i', path.join(out, `${id}.mp4`), '-vf', `scale=-2:${height}`, ...encode, path.join(out, file)]);
    renditions[id].push({ height, src: `/demos/${file}`, bytes: (await fs.stat(path.join(out, file))).size });
  }
}
await fs.writeFile(path.join(root, 'src/lib/media/local-renditions.mjs'), '// Generated by scripts/render-media-revisions.mjs.\nexport default ' + JSON.stringify(renditions, null, 2) + ';\n');
console.log(JSON.stringify(renditions, null, 2));
