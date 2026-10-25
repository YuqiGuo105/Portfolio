#!/usr/bin/env node
/**
 * README architecture views.
 *
 * Sources (edit these, never the generated SVGs):
 *   docs/architecture/platform-system-flow.json   detailed topology (nodes + edges)
 *   docs/architecture/platform-overview.json      container view; each element `covers` topology nodes
 *   docs/architecture/platform-sequences.json     UML 2 sequence diagrams (messages, notes, combined fragments)
 *
 * Outputs (served by the site from /diagrams/ and embedded in the README):
 *   public/diagrams/overview{,-dark}.svg          container view with the Kafka event backbone
 *   public/diagrams/flow-<key>{,-dark}.svg        one UML sequence diagram per workflow
 *   README.md block between <!-- architecture:start --> and <!-- architecture:end -->
 *
 * Notation (all connectors are solid; the arrowhead carries the meaning):
 *   person = actor · card = container (upper compartment: name + technology, lower: mechanisms) ·
 *   cylinder = data store, drawn next to the service that owns it and labelled by technology only ·
 *   pipe = Kafka topic · grey card = external system · folded note = UML note ·
 *   blue frame = services on Google Cloud Run; its ribbon carries the scaling contract and the Kubernetes exit path (ADR-001)
 *   filled arrowhead = synchronous call · open purple arrowhead = asynchronous message · blue = data access
 *   Sequence diagrams follow UML 2: dashed open arrow = reply, framed alt/opt/loop/par/break/critical fragments.
 *
 * Usage:
 *   node scripts/render-architecture-views.mjs           render + refresh README
 *   node scripts/render-architecture-views.mjs --check   validate and fail if outputs are stale
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCH_DIR = path.join(ROOT, "docs", "architecture");
const ICON_DIR = path.join(ARCH_DIR, "icons");
const OUT_DIR = path.join(ROOT, "public", "diagrams");
const OUT_URL = "public/diagrams";
const README_PATH = path.join(ROOT, "README.md");
const SOURCES = {
  topology: path.join(ARCH_DIR, "platform-system-flow.json"),
  overview: path.join(ARCH_DIR, "platform-overview.json"),
  sequences: path.join(ARCH_DIR, "platform-sequences.json"),
};
const README_START = "<!-- architecture:start -->";
const README_END = "<!-- architecture:end -->";
const SITE_URL = "https://www.yuqi.site";

/* ------------------------------------------------------------------ themes */

const THEMES = {
  light: {
    name: "light",
    canvas: "#ffffff",
    text: "#17212a",
    detail: "#33424e",
    muted: "#56656f",
    faint: "#86939e",
    node: "#ffffff",
    border: "#c3ced7",
    divider: "#e1e7ec",
    external: "#f3f5f7",
    externalBorder: "#a7b3be",
    note: "#fff8dc",
    noteBorder: "#d9c37a",
    labelBg: "#ffffff",
    labelBorder: "#d3dbe2",
    lifeline: "#c3ccd5",
    shadow: "#1f2d38",
    shadowOpacity: 0.09,
    bandFill: 0.035,
    bandStroke: 0.32,
    tint: 0.11,
    tierFill: "#f6f8fa",
    tierAlt: "#fbfcfd",
    gutter: "#eaeef2",
    tileText: "#ffffff",
    chipBg: "#f3f6f8",
    chipBorder: "#d5dde3",
    runtime: "#326ce5",
    runtimeFill: "#f3f7ff",
    brands: {
      postgresql: "#2f62c9",
      redis: "#c8372d",
      opensearch: "#0a6bc4",
      kubernetes: "#326ce5",
    },
    accents: {
      blue: "#1769aa",
      green: "#14805e",
      orange: "#b56b13",
      purple: "#7255a5",
      red: "#ba4a52",
      cyan: "#087f95",
      slate: "#435363",
    },
    edges: {
      request: "#33424e",
      event: "#7356a6",
      data: "#1778a8",
      return: "#6f7e8a",
    },
  },
  dark: {
    name: "dark",
    canvas: "#0d1117",
    text: "#e6edf3",
    detail: "#c5d0da",
    muted: "#9da9b5",
    faint: "#6e7b88",
    node: "#151b23",
    border: "#384350",
    divider: "#28313b",
    external: "#1b222b",
    externalBorder: "#596574",
    note: "#2a2614",
    noteBorder: "#8a7a3c",
    labelBg: "#0d1117",
    labelBorder: "#2c3640",
    lifeline: "#3a4552",
    shadow: "#000000",
    shadowOpacity: 0.35,
    bandFill: 0.055,
    bandStroke: 0.4,
    tint: 0.2,
    tierFill: "#111821",
    tierAlt: "#0e141c",
    gutter: "#18212c",
    tileText: "#0d1117",
    chipBg: "#18202a",
    chipBorder: "#323d49",
    runtime: "#7aa2ff",
    runtimeFill: "#111a2b",
    brands: {
      postgresql: "#82a8ff",
      redis: "#ff7d72",
      opensearch: "#5aa9f0",
      kubernetes: "#7aa2ff",
    },
    accents: {
      blue: "#60a5fa",
      green: "#4ade80",
      orange: "#fbbf6a",
      purple: "#c4b5fd",
      red: "#fb7185",
      cyan: "#67e8f9",
      slate: "#a3b1bf",
    },
    edges: {
      request: "#c9d4de",
      event: "#a78bfa",
      data: "#38bdf8",
      return: "#8b98a5",
    },
  },
};

/** Connectors are solid; only UML replies keep the standard dashed line. */
const EDGE_STYLE = {
  request: { width: 1.6, dash: "", head: "filled" },
  event: { width: 1.7, dash: "", head: "open" },
  data: { width: 1.6, dash: "", head: "filled" },
  return: { width: 1.4, dash: "5 4", head: "open" },
};

/** UML 2 interaction operators used by the sequence diagrams. */
const FRAGMENTS = {
  alt: { accent: "blue", meaning: "alternatives" },
  opt: { accent: "cyan", meaning: "optional" },
  loop: { accent: "green", meaning: "repeat" },
  par: { accent: "purple", meaning: "parallel" },
  break: { accent: "red", meaning: "exit early" },
  critical: { accent: "orange", meaning: "atomic region" },
};

const FONT = `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];

/* ----------------------------------------------------------------- helpers */

const esc = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const round = (value) => Math.round(value * 10) / 10;
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const workflowMark = (index) => CIRCLED[index] || `${index + 1}.`;
const tintOpacity = (theme, scale = 1) => round(theme.tint * scale * 100) / 100;

/** Approximate rendered width of a string (Inter-like metrics). Used for pills, knockouts and wrapping. */
function textWidth(text, size, { bold = false, tracking = 0, mono = false } = {}) {
  if (mono) return [...String(text)].length * size * 0.6;
  let units = 0;
  for (const ch of String(text)) {
    if (" ".includes(ch)) units += 0.28;
    else if (".,:;'|!·".includes(ch)) units += 0.3;
    else if ("ijlIft()[]/\\-".includes(ch)) units += 0.36;
    else if ("mwMW@%".includes(ch)) units += 0.88;
    else if (ch >= "A" && ch <= "Z") units += 0.68;
    else if (ch >= "0" && ch <= "9") units += 0.6;
    else if ("→←≤≥".includes(ch)) units += 0.9;
    else units += 0.56;
  }
  return units * size * (bold ? 1.06 : 1) + tracking * [...String(text)].length;
}

function wrapText(text, size, maxWidth, options = {}) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(candidate, size, options) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Largest font size from `sizes` at which `text` fits `maxWidth`. */
function fitSize(text, maxWidth, sizes, options = {}) {
  return sizes.find((size) => textWidth(text, size, options) <= maxWidth) ?? sizes.at(-1);
}

const GENERIC_ICONS = {
  user: `<circle cx="12" cy="7" r="4"/><path d="M4.5 21c.8-5 3.3-7 7.5-7s6.7 2 7.5 7"/>`,
  shield: `<path d="M12 3l8 3v5c0 5.2-3 8.4-8 10-5-1.6-8-4.8-8-10V6z"/><path d="M8.5 12l2.2 2.2 4.8-5"/>`,
  web: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.3 4.2 6.3 4.2 9S15 17.7 12 21M12 3C9 6.3 7.8 9.3 7.8 12S9 17.7 12 21"/>`,
  browser: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9 6.5h.01"/>`,
  file: `<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>`,
  server: `<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>`,
  check: `<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/>`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M4 7l8 6 8-6"/>`,
  database: `<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>`,
  users: `<circle cx="9" cy="8" r="3.4"/><path d="M2.8 19.5c.6-3.8 2.8-5.6 6.2-5.6s5.6 1.8 6.2 5.6"/><path d="M15.2 4.9a3.3 3.3 0 0 1 0 6.3M17.4 14.2c2.2.6 3.4 2.3 3.8 5.3"/>`,
  bot: `<rect x="4.5" y="8" width="15" height="11.5" rx="3.2"/><path d="M12 4.2v3.8M9.2 13.3h.01M14.8 13.3h.01M2.5 12.5v3M21.5 12.5v3M9.5 16.6h5"/>`,
  search: `<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.4 15.4L20.5 20.5"/>`,
  tool: `<path d="M14.6 5.2a4.3 4.3 0 0 0-5.6 5.6L3.8 16a2 2 0 0 0 2.8 2.8L11.8 13.6a4.3 4.3 0 0 0 5.6-5.6l-2.6 2.6-2.3-.5-.5-2.3z"/>`,
  bell: `<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 2H4.4z"/><path d="M10 20.8a2.2 2.2 0 0 0 4 0"/>`,
  chart: `<path d="M4 20.5h16"/><path d="M7 17V12M12 17V7M17 17v-7"/>`,
  alert: `<path d="M12 3.8l9 15.9H3z"/><path d="M12 10v4.4M12 17.2h.01"/>`,
  briefcase: `<rect x="3" y="7.5" width="18" height="12.5" rx="2.2"/><path d="M9 7.5V5.6c0-.6.5-1.1 1.1-1.1h3.8c.6 0 1.1.5 1.1 1.1v1.9M3 12.8h18"/>`,
  layers: `<path d="M12 3.6l8.5 4.4L12 12.4 3.5 8z"/><path d="M3.5 12.2l8.5 4.4 8.5-4.4M3.5 16.2l8.5 4.4 8.5-4.4"/>`,
  bucket: `<ellipse cx="12" cy="6.2" rx="8" ry="2.6"/><path d="M4 6.2l1.7 12.3c.3 1.4 3 2.4 6.3 2.4s6-1 6.3-2.4L20 6.2"/>`,
  coin: `<circle cx="12" cy="12" r="8.6"/><path d="M14.7 9.3c-.5-.9-1.5-1.4-2.7-1.4-1.5 0-2.7.8-2.7 1.9s1.2 1.7 2.7 2 2.7.9 2.7 2-1.2 2-2.7 2c-1.3 0-2.3-.6-2.8-1.5M12 6.3v1.6M12 16.1v1.6"/>`,
  pipeline: `<circle cx="6" cy="5.8" r="2.3"/><circle cx="6" cy="18.2" r="2.3"/><circle cx="18" cy="9" r="2.3"/><path d="M6 8.1v7.8M18 11.3c0 3.6-3.3 4.5-9.7 5.5"/>`,
  refresh: `<path d="M19.6 10.6A7.8 7.8 0 0 0 6 6.6L4.3 8.3M4.3 3.9v4.4h4.4M4.4 13.4A7.8 7.8 0 0 0 18 17.4l1.7-1.7M19.7 20.1v-4.4h-4.4"/>`,
  key: `<circle cx="8" cy="15.5" r="4.6"/><path d="M11.4 12.1L20.2 3.3M16.6 6.9l2.6 2.6M14.3 9.2l2 2"/>`,
  chat: `<path d="M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5V17H4.5A1.5 1.5 0 0 1 3 15.5V6a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M7.5 9.3h9M7.5 12.7h6"/>`,
  edit: `<path d="M15.8 4.4a2.2 2.2 0 0 1 3.1 3.1L8.4 18l-4.4 1.3L5.3 15z"/><path d="M13.8 6.4l3.1 3.1"/>`,
  pulse: `<path d="M3 12.5h4.2l2.4-6.2 4.4 11.4 2.5-5.2H21"/>`,
};

function genericIcon(name, x, y, size, color) {
  const scale = size / 24;
  return `<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale * 1000) / 1000})" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${GENERIC_ICONS[name] || GENERIC_ICONS.server}</g>`;
}

const iconCache = new Map();
function brandIcon(brand, x, y, size, color, fallback = "server") {
  const file = path.join(ICON_DIR, `${brand}.svg`);
  if (!brand || !fs.existsSync(file)) return genericIcon(fallback, x, y, size, color);
  if (!iconCache.has(file)) iconCache.set(file, fs.readFileSync(file, "utf8"));
  const source = iconCache.get(file);
  const box = source.match(/viewBox=["']([^"']+)["']/)?.[1]?.trim().split(/\s+/).map(Number);
  const [minX, minY, vbW, vbH] = box?.length === 4 ? box : [0, 0, 24, 24];
  const scale = size / Math.max(vbW, vbH);
  const offsetX = (size - vbW * scale) / 2 - minX * scale;
  const offsetY = (size - vbH * scale) / 2 - minY * scale;
  const body = source
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>[\s\S]*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<path\b/g, `<path fill="${color}"`);
  return `<g transform="translate(${round(x + offsetX)} ${round(y + offsetY)}) scale(${round(scale * 1000) / 1000})">${body}</g>`;
}

function nodeIcon(node, x, y, size, color) {
  return node.brand ? brandIcon(node.brand, x, y, size, color, node.icon) : genericIcon(node.icon || "server", x, y, size, color);
}

/* ------------------------------------------------------------------ shapes */

/** C4 / UML person: head + shoulders. (cx, top) is the top centre; total height ≈ 1.1 * size. */
function personShape(cx, top, size, theme, accent) {
  const r = size * 0.22;
  const headY = top + r + 1;
  const bodyTop = headY + r + size * 0.06;
  const half = size * 0.42;
  const bottom = top + size * 1.08;
  const fill = tintOpacity(theme, 1.4);
  return `<g>
    <circle cx="${round(cx)}" cy="${round(headY)}" r="${round(r)}" fill="${accent}" fill-opacity="${fill}" stroke="${accent}" stroke-width="1.6"/>
    <path d="M ${round(cx - half)} ${round(bottom)} V ${round(bodyTop + half * 0.7)} Q ${round(cx - half)} ${round(bodyTop)} ${round(cx - half * 0.35)} ${round(bodyTop)} H ${round(cx + half * 0.35)} Q ${round(cx + half)} ${round(bodyTop)} ${round(cx + half)} ${round(bodyTop + half * 0.7)} V ${round(bottom)} Z" fill="${accent}" fill-opacity="${fill}" stroke="${accent}" stroke-width="1.6" stroke-linejoin="round"/>
  </g>`;
}

/** UML actor stick figure, used as a sequence-diagram participant head. */
function stickFigure(cx, top, theme) {
  return `<g fill="none" stroke="${theme.text}" stroke-width="1.6" stroke-linecap="round">
    <circle cx="${round(cx)}" cy="${round(top + 7)}" r="6.5" fill="${theme.node}"/>
    <path d="M ${round(cx)} ${round(top + 13.5)} V ${round(top + 29)} M ${round(cx - 11)} ${round(top + 19)} H ${round(cx + 11)} M ${round(cx)} ${round(top + 29)} L ${round(cx - 9)} ${round(top + 41)} M ${round(cx)} ${round(top + 29)} L ${round(cx + 9)} ${round(top + 41)}"/>
  </g>`;
}

/** Vertical database cylinder with an optional inner ring at `ringY` (a compartment line). */
function cylinderShape(x, y, w, h, theme, accent, { ry = 7, ringY } = {}) {
  const body = `M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry} V ${y + h - ry} A ${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z`;
  const ring = ringY === undefined ? "" : `<path d="M ${x} ${ringY} A ${w / 2} ${ry} 0 0 0 ${x + w} ${ringY}" fill="none" stroke="${theme.divider}" stroke-width="1.1"/>`;
  return `<g>
    <path d="${body}" fill="${theme.node}" stroke="${accent}" stroke-width="1.3" filter="url(#shadow)"/>
    ${ring}
    <ellipse cx="${round(x + w / 2)}" cy="${y + ry}" rx="${round(w / 2)}" ry="${ry}" fill="${accent}" fill-opacity="${tintOpacity(theme, 1.2)}" stroke="${accent}" stroke-width="1.3"/>
  </g>`;
}

/** Horizontal pipe = Kafka topic, optionally labelled inside. */
function pipeShape(x, y, w, h, theme, accent, { label, labelSize = 10, opaque = true } = {}) {
  const rx = Math.min(8, h / 3);
  const body = `M ${round(x + rx)} ${round(y)} H ${round(x + w - rx)} A ${rx} ${round(h / 2)} 0 0 1 ${round(x + w - rx)} ${round(y + h)} H ${round(x + rx)} A ${rx} ${round(h / 2)} 0 0 1 ${round(x + rx)} ${round(y)} Z`;
  const size = label ? Math.min(labelSize, fitSize(label, w - 2 * rx - 14, [labelSize, 9.5, 9, 8.5], { mono: true })) : labelSize;
  return `<g>
    ${opaque ? `<path d="${body}" fill="${theme.node}"/>` : ""}
    <path d="${body}" fill="${accent}" fill-opacity="${tintOpacity(theme, 0.9)}" stroke="${accent}" stroke-width="1.3"/>
    <ellipse cx="${round(x + w - rx)}" cy="${round(y + h / 2)}" rx="${rx}" ry="${round(h / 2)}" fill="${theme.node}" stroke="${accent}" stroke-width="1.3"/>
    ${label ? `<text x="${round(x + rx + 4)}" y="${round(y + h / 2 + size * 0.36)}" class="topic-in" style="font-size:${size}px">${esc(label)}</text>` : ""}
  </g>`;
}

function noteShape(x, y, w, h, theme) {
  const fold = 11;
  return `<g>
    <path d="M ${round(x)} ${round(y)} H ${round(x + w - fold)} L ${round(x + w)} ${round(y + fold)} V ${round(y + h)} H ${round(x)} Z" fill="${theme.note}" stroke="${theme.noteBorder}" stroke-width="1.2"/>
    <path d="M ${round(x + w - fold)} ${round(y)} V ${round(y + fold)} H ${round(x + w)}" fill="none" stroke="${theme.noteBorder}" stroke-width="1.2"/>
  </g>`;
}

function svgDocument({ width, height, title, desc, theme, body }) {
  const markers = Object.entries(theme.edges).map(([kind, color]) => {
    const style = EDGE_STYLE[kind];
    const shape = style.head === "open"
      ? `<path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`
      : `<path d="M 0 1 L 9 5 L 0 9 z" fill="${color}"/>`;
    return `<marker id="arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8.5" markerHeight="8.5" markerUnits="userSpaceOnUse" orient="auto-start-reverse">${shape}</marker>`;
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title>
<desc id="desc">${esc(desc)}</desc>
<defs>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="135%">
    <feDropShadow dx="0" dy="1.2" stdDeviation="1.6" flood-color="${theme.shadow}" flood-opacity="${theme.shadowOpacity}"/>
  </filter>
  ${markers}
</defs>
<style>
  text { font-family: ${FONT}; fill: ${theme.text}; }
  .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 1.6px; fill: ${theme.muted}; }
  .h1 { font-size: 28px; font-weight: 750; }
  .sub { font-size: 14px; fill: ${theme.muted}; }
  .band-title { font-size: 12px; font-weight: 750; letter-spacing: 1.3px; }
  .stereo { font-size: 9.5px; font-weight: 600; fill: ${theme.faint}; }
  .chip { font-size: 11.5px; font-weight: 650; }
  .card-title { font-size: 14.5px; font-weight: 700; }
  .card-meta { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; letter-spacing: .3px; fill: ${theme.muted}; }
  .card-detail { font-size: 11.5px; font-weight: 500; fill: ${theme.detail}; }
  .port { font-size: 11px; font-weight: 650; fill: ${theme.muted}; }
  .label { font-size: 11px; font-weight: 600; fill: ${theme.muted}; }
  .legend { font-size: 11.5px; font-weight: 600; fill: ${theme.muted}; }
  .foot { font-size: 11px; fill: ${theme.faint}; }
  .note { font-size: 11.5px; fill: ${theme.text}; }
  .topic-in { font-family: ${MONO}; font-size: 10px; font-weight: 600; fill: ${theme.text}; }
  .panel-title { font-size: 13px; font-weight: 750; }
  .panel-sub { font-size: 8.5px; font-weight: 750; letter-spacing: 1px; fill: ${theme.muted}; }
  .panel-note { font-size: 10.5px; font-weight: 550; fill: ${theme.detail}; }
  .stat-num { font-size: 21px; font-weight: 750; }
  .stat-label { font-size: 9px; font-weight: 700; letter-spacing: 1px; fill: ${theme.muted}; }
  .head-title { font-size: 12.5px; font-weight: 700; }
  .head-meta { font-family: ${MONO}; font-size: 9px; font-weight: 600; fill: ${theme.muted}; }
  .msg { font-size: 12.5px; font-weight: 620; }
  .msg-detail { font-size: 10.5px; font-weight: 500; fill: ${theme.muted}; }
  .seq-num { font-size: 9.5px; font-weight: 750; fill: ${theme.canvas}; }
  .frag-op { font-size: 11px; font-weight: 800; letter-spacing: .4px; }
  .frag-guard { font-size: 11px; font-weight: 600; fill: ${theme.muted}; }
  .frame { font-size: 13px; font-weight: 750; }
  .tier-title { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; fill: ${theme.muted}; }
  .tier-host { font-size: 8.5px; font-weight: 600; letter-spacing: .3px; fill: ${theme.faint}; }
  .node-title { font-size: 13px; font-weight: 700; }
  .node-meta { font-size: 8.8px; font-weight: 700; letter-spacing: .7px; fill: ${theme.muted}; }
  .module { font-size: 10.5px; font-weight: 600; fill: ${theme.detail}; }
  .tag { font-size: 7.8px; font-weight: 800; letter-spacing: .7px; }
  .route { font-family: ${MONO}; font-size: 10px; font-weight: 650; fill: ${theme.muted}; }
  .topic { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; fill: ${theme.edges.event}; }
  .edge-note { font-size: 10.5px; font-weight: 600; fill: ${theme.muted}; }
  .store-title { font-size: 11.5px; font-weight: 700; }
  .store-meta { font-size: 8.5px; font-weight: 700; letter-spacing: .7px; fill: ${theme.muted}; }
  .bar-chip { font-size: 10.5px; font-weight: 600; fill: ${theme.detail}; }
  .adr-title { font-size: 13px; font-weight: 750; }
  .adr-key { font-size: 9px; font-weight: 800; letter-spacing: .9px; fill: ${theme.muted}; }
  .adr-text { font-size: 11px; font-weight: 500; fill: ${theme.detail}; }
  .lane-title { font-size: 15px; font-weight: 750; }
  .lane-sub { font-size: 11px; font-weight: 500; fill: ${theme.muted}; }
  .lane-num { font-size: 12px; font-weight: 800; fill: ${theme.tileText}; }
</style>
<rect width="${width}" height="${height}" fill="${theme.canvas}"/>
${body}
</svg>
`;
}

/* ------------------------------------------------------- geometry + routing */

const center = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const isHorizontal = (side) => side === "left" || side === "right";

function sidePoint(box, side, along) {
  if (side === "left") return { x: box.x, y: along ?? box.y + box.h / 2 };
  if (side === "right") return { x: box.x + box.w, y: along ?? box.y + box.h / 2 };
  if (side === "top") return { x: along ?? box.x + box.w / 2, y: box.y };
  return { x: along ?? box.x + box.w / 2, y: box.y + box.h };
}

function defaultSides(a, b) {
  const ca = center(a);
  const cb = center(b);
  const horizontalGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  if (horizontalGap > 0) return ca.x <= cb.x ? ["right", "left"] : ["left", "right"];
  return ca.y <= cb.y ? ["bottom", "top"] : ["top", "bottom"];
}

/**
 * Ports align across boxes of different sizes so most connectors stay straight.
 * `along` / `alongTo` pin a straight connector to a fraction of the source / target side;
 * `fromAlong` / `toAlong` pin each end independently (the router adds the elbows).
 */
function alignedPorts(a, b, fromSide, toSide, link = {}) {
  const at = (box, side, fraction) => (isHorizontal(side) ? box.y + box.h * fraction : box.x + box.w * fraction);
  if (link.along !== undefined || link.alongTo !== undefined) {
    const value = link.along !== undefined ? at(a, fromSide, link.along) : at(b, toSide, link.alongTo);
    return [sidePoint(a, fromSide, value), sidePoint(b, toSide, value)];
  }
  if (link.fromAlong !== undefined || link.toAlong !== undefined) {
    const start = link.fromAlong !== undefined ? sidePoint(a, fromSide, at(a, fromSide, link.fromAlong)) : sidePoint(a, fromSide);
    const end = link.toAlong !== undefined ? sidePoint(b, toSide, at(b, toSide, link.toAlong)) : sidePoint(b, toSide);
    return [start, end];
  }
  let along;
  if (isHorizontal(fromSide) && isHorizontal(toSide)) {
    const lo = Math.max(a.y, b.y) + 6;
    const hi = Math.min(a.y + a.h, b.y + b.h) - 6;
    if (lo <= hi) {
      const target = a.h > b.h ? center(b).y : center(a).y;
      along = Math.min(hi, Math.max(lo, target));
    }
    return [sidePoint(a, fromSide, along), sidePoint(b, toSide, along)];
  }
  if (!isHorizontal(fromSide) && !isHorizontal(toSide)) {
    const lo = Math.max(a.x, b.x) + 6;
    const hi = Math.min(a.x + a.w, b.x + b.w) - 6;
    if (lo <= hi) {
      const target = a.w > b.w ? center(b).x : center(a).x;
      along = Math.min(hi, Math.max(lo, target));
    }
    return [sidePoint(a, fromSide, along), sidePoint(b, toSide, along)];
  }
  return [sidePoint(a, fromSide), sidePoint(b, toSide)];
}

function orthogonalPoints(start, fromSide, end, toSide, { midX, midY } = {}) {
  if (isHorizontal(fromSide) && isHorizontal(toSide)) {
    if (Math.abs(start.y - end.y) < 0.5) return [start, end];
    const x = midX ?? (start.x + end.x) / 2;
    return [start, { x, y: start.y }, { x, y: end.y }, end];
  }
  if (!isHorizontal(fromSide) && !isHorizontal(toSide)) {
    if (Math.abs(start.x - end.x) < 0.5) return [start, end];
    const y = midY ?? (start.y + end.y) / 2;
    return [start, { x: start.x, y }, { x: end.x, y }, end];
  }
  if (isHorizontal(fromSide)) return [start, { x: end.x, y: start.y }, end];
  return [start, { x: start.x, y: end.y }, end];
}

function roundedPath(points, radius = 9) {
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const inLength = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const inPoint = { x: corner.x - ((corner.x - prev.x) / inLength) * r, y: corner.y - ((corner.y - prev.y) / inLength) * r };
    const outPoint = { x: corner.x + ((next.x - corner.x) / outLength) * r, y: corner.y + ((next.y - corner.y) / outLength) * r };
    d += ` L ${round(inPoint.x)} ${round(inPoint.y)} Q ${round(corner.x)} ${round(corner.y)} ${round(outPoint.x)} ${round(outPoint.y)}`;
  }
  const last = points.at(-1);
  return `${d} L ${round(last.x)} ${round(last.y)}`;
}

function longestSegmentMidpoint(points) {
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    return { length: Math.hypot(end.x - start.x, end.y - start.y), x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }).sort((left, right) => right.length - left.length)[0];
}

function labelPill(text, x, y, theme) {
  const width = textWidth(text, 11, { bold: true }) + 14;
  return `<g><rect x="${round(x - width / 2)}" y="${round(y - 9.5)}" width="${round(width)}" height="19" rx="9.5" fill="${theme.labelBg}" stroke="${theme.labelBorder}"/>
    <text x="${round(x)}" y="${round(y + 3.8)}" text-anchor="middle" class="label">${esc(text)}</text></g>`;
}

/** Kafka topic drawn on a connector (a hop that leaves the backbone column). */
function pipeLabel(topic, x, y, theme) {
  const width = textWidth(topic, 10, { mono: true }) + 30;
  return pipeShape(round(x - width / 2), round(y - 11), round(width), 22, theme, theme.edges.event, { label: topic });
}

function connector(points, kind, theme, { label, pipe, labelAt, labelSegment, labelOffset = {}, extraWidth = 0, layer } = {}) {
  const base = EDGE_STYLE[kind] || EDGE_STYLE.request;
  const width = base.width + extraWidth;
  const color = theme.edges[kind] || theme.edges.request;
  const d = roundedPath(points);
  let decoration = "";
  if (label || pipe) {
    const segment = Number.isInteger(labelSegment) && points[labelSegment + 1]
      ? { x: (points[labelSegment].x + points[labelSegment + 1].x) / 2, y: (points[labelSegment].y + points[labelSegment + 1].y) / 2 }
      : null;
    const spot = labelAt || segment || longestSegmentMidpoint(points);
    const x = spot.x + (labelOffset.dx || 0);
    const y = spot.y + (labelOffset.dy || 0);
    decoration = pipe ? pipeLabel(pipe, x, y, theme) : labelPill(label, x, y, theme);
  }
  const halo = `<path d="${d}" fill="none" stroke="${theme.canvas}" stroke-width="${width + 4}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".9"/>`;
  const stroke = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${base.dash ? `stroke-dasharray="${base.dash}"` : ""} stroke-linejoin="round" marker-end="url(#arrow-${kind})"/>`;
  // `layer` splits the knockout halo from the stroke, so connectors that share a trunk can be drawn halos-first.
  if (layer === "halo") return halo;
  if (layer === "stroke") return `${stroke}${decoration}`;
  return `<g>
    ${halo}
    ${stroke}
    ${decoration}
  </g>`;
}

/* -------------------------------------------------------------- validation */

function indexTopology(topology) {
  const nodes = new Map(topology.nodes.map((node) => [node.id, node]));
  const edges = new Map();
  for (const edge of topology.edges) edges.set(`${edge.from}->${edge.to}`, edge);
  return { nodes, edges };
}

const OVERVIEW_KINDS = new Set(["client", "service", "kafka", "store", "external", "ref", "handoff"]);
const ACCENT_NAMES = new Set(Object.keys(THEMES.light.accents));

/** Every lane node (lane-relative coordinates), tagged with its lane. */
function overviewNodes(overview) {
  return overview.lanes.flatMap((lane) => lane.nodes.map((node) => ({ ...node, laneId: lane.id })));
}

function validateOverview(overview, topo, catalog, problems) {
  const owner = new Map();
  const nodes = overviewNodes(overview);
  const shared = (overview.sharedStores || []).map((store) => ({ ...store, kind: "store", laneId: `shared:${store.id}` }));
  // A zone can stand for a deployment as a whole, e.g. the Next.js app and its Vercel API routes behind the client UIs.
  const zones = overview.zones.filter((zone) => zone.covers).map((zone) => ({ ...zone, laneId: `zone:${zone.id}` }));
  const items = [...nodes, ...shared, ...zones, ...(overview.platform?.items || [])];
  const byId = new Map();
  for (const item of items) {
    if (byId.has(item.id)) problems.push(`overview: duplicate id "${item.id}"`);
    byId.set(item.id, item);
    for (const covered of item.covers || []) {
      if (!topo.nodes.has(covered)) problems.push(`overview: "${item.id}" covers unknown topology node "${covered}"`);
      if (owner.has(covered)) problems.push(`overview: topology node "${covered}" is covered by both "${owner.get(covered)}" and "${item.id}"`);
      owner.set(covered, item.id);
    }
    for (const resource of item.resources || []) {
      const parent = topo.nodes.get(resource.node);
      const exists = parent?.resources?.some((candidate) => candidate.title === resource.title);
      if (!exists) problems.push(`overview: "${item.id}" references missing resource "${resource.title}" on topology node "${resource.node}"`);
    }
  }

  const sequenceKeys = new Set(catalog.sequences.map((sequence) => sequence.key));
  const numbers = new Set();
  for (const lane of overview.lanes) {
    if (numbers.has(lane.number)) problems.push(`overview: lane number ${lane.number} is used twice`);
    numbers.add(lane.number);
    if (lane.sequence && !sequenceKeys.has(lane.sequence)) problems.push(`overview: lane "${lane.id}" points at unknown sequence "${lane.sequence}"`);
    if (!ACCENT_NAMES.has(lane.accent)) problems.push(`overview: lane "${lane.id}" needs an accent (${[...ACCENT_NAMES].join(", ")})`);
  }

  // `ref` cards and `handoff` chips stand for an element of another lane; `same` repeats a client.
  const base = (item) => (item?.ref || item?.same ? byId.get(item.ref || item.same) : item);
  for (const node of nodes) {
    if (!OVERVIEW_KINDS.has(node.kind)) problems.push(`overview: "${node.id}" has unknown kind "${node.kind}"`);
    for (const field of ["x", "y", "w", "h"]) {
      if (typeof node[field] !== "number") problems.push(`overview: "${node.id}" needs a numeric "${field}"`);
    }
    if (node.kind === "kafka") {
      for (const covered of node.covers || []) {
        if (topo.nodes.get(covered)?.shape !== "queue") problems.push(`overview: Kafka "${node.id}" covers "${covered}", which is not a queue in the topology`);
      }
    }
    if ((node.kind === "ref" || node.kind === "handoff") && !node.ref) problems.push(`overview: ${node.kind} "${node.id}" needs a "ref"`);
    const target = node.ref || node.same;
    if (target) {
      const resolved = byId.get(target);
      if (!resolved) problems.push(`overview: "${node.id}" refers to unknown element "${target}"`);
      else if (resolved.ref || resolved.same) problems.push(`overview: "${node.id}" must refer to a primary element, not "${target}"`);
      else if (resolved.laneId === node.laneId) problems.push(`overview: "${node.id}" refers to "${target}" in its own lane; draw a link instead`);
      if (node.kind === "handoff" && resolved && resolved.kind !== "kafka") problems.push(`overview: handoff "${node.id}" must point at a Kafka element`);
      if (node.covers || node.resources) problems.push(`overview: "${node.id}" refers to "${target}" and must not cover topology nodes itself`);
    }
  }
  for (const id of topo.nodes.keys()) {
    if (!owner.has(id)) problems.push(`overview: topology node "${id}" is not covered by any overview element (add it to a "covers" list)`);
  }

  const scope = (item) => {
    const resolved = base(item);
    return new Set([...(resolved?.covers || []), ...(resolved?.resources || []).map((resource) => resource.node)]);
  };
  const checkTopology = (where, link) => {
    if (!EDGE_STYLE[link.kind]) problems.push(`${where} has unknown kind "${link.kind}"`);
    // A declarative link documents a verified path the topology models differently; it must say why.
    if (link.declarative !== undefined) {
      if (typeof link.declarative !== "string" || !link.declarative.trim()) problems.push(`${where} needs a reason in "declarative"`);
      return;
    }
    if (link.edges) {
      for (const key of link.edges) {
        if (!topo.edges.has(key)) problems.push(`${where} maps to missing topology edge "${key}"`);
      }
      return;
    }
    const from = base(byId.get(link.from));
    const to = base(byId.get(link.to));
    const fromScope = scope(byId.get(link.from));
    const toScope = scope(byId.get(link.to));
    // Elements that model nothing in the topology (third-party APIs) take declarative links.
    if (!fromScope.size || !toScope.size) return;
    // Links to stores are backed by the store's owning service.
    if (to?.resources && [...fromScope].some((id) => toScope.has(id))) return;
    if (from?.resources && [...toScope].some((id) => fromScope.has(id))) return;
    const matched = [...topo.edges.values()].some((edge) =>
      (fromScope.has(edge.from) && toScope.has(edge.to)) || (fromScope.has(edge.to) && toScope.has(edge.from)));
    if (!matched) problems.push(`${where} has no matching topology edge (add "edges": [...] or fix the topology)`);
  };
  for (const lane of overview.lanes) {
    const own = new Set(lane.nodes.map((node) => node.id));
    for (const link of lane.links) {
      const where = `overview lane "${lane.id}": link ${link.from} -> ${link.to}`;
      if (!own.has(link.from) || !own.has(link.to)) {
        problems.push(`${where} must connect two nodes of the same lane (use "crossLinks" between lanes)`);
        continue;
      }
      checkTopology(where, link);
    }
  }
  const laneIds = new Set(overview.lanes.map((lane) => lane.id));
  const laneOrder = overview.lanes.map((lane) => lane.id);
  for (const store of overview.sharedStores || []) {
    const [a, b] = store.between || [];
    if (!laneIds.has(a) || !laneIds.has(b) || Math.abs(laneOrder.indexOf(a) - laneOrder.indexOf(b)) !== 1) {
      problems.push(`overview: shared store "${store.id}" must sit "between" two neighbouring lanes`);
    }
  }
  for (const link of overview.crossLinks || []) {
    const where = `overview cross link ${link.from} -> ${link.to}`;
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) {
      problems.push(`${where} references an unknown element`);
      continue;
    }
    if (from.laneId === to.laneId) problems.push(`${where} connects two nodes of the same lane; put it in the lane's "links"`);
    for (const point of link.points || []) {
      if (point.length !== 3 || !laneIds.has(point[1])) problems.push(`${where} needs points as [x, laneId, y] with a known lane`);
    }
    if (link.label && !laneIds.has(link.label.lane)) problems.push(`${where} label needs a known "lane"`);
    checkTopology(where, link);
  }
  if (overview.systemMap) {
    for (const node of overview.systemMap.nodes) {
      if (!laneIds.has(node.lane)) problems.push(`overview system map: unknown lane "${node.lane}"`);
    }
    const mapped = new Set(overview.systemMap.nodes.map((node) => node.lane));
    for (const link of overview.systemMap.links) {
      if (!mapped.has(link.from) || !mapped.has(link.to)) problems.push(`overview system map: link ${link.from} -> ${link.to} needs both lanes on the map`);
      if (!EDGE_STYLE[link.kind]) problems.push(`overview system map: link ${link.from} -> ${link.to} has unknown kind "${link.kind}"`);
      if (link.shared !== undefined) {
        const store = (overview.sharedStores || []).find((item) => item.id === link.shared);
        if (!store) problems.push(`overview system map: link ${link.from} -> ${link.to} names unknown shared store "${link.shared}"`);
        else if (![link.from, link.to].every((id) => store.between.includes(id))) problems.push(`overview system map: shared store "${link.shared}" does not sit between ${link.from} and ${link.to}`);
        if (link.points.length !== 2 || link.points[0][1] !== link.points[1][1]) problems.push(`overview system map: shared link ${link.from} -> ${link.to} must be one horizontal segment`);
      }
    }
  }
  return owner;
}

function participantScope(participant) {
  return [participant.node, participant.resource?.node, ...(participant.covers || [])].filter(Boolean);
}

function validateSequences(catalog, topo, problems, warnings) {
  const keys = new Set();
  for (const sequence of catalog.sequences) {
    const where = `sequence ${sequence.key || "?"}`;
    if (!sequence.key) problems.push("sequences: every sequence needs a key");
    if (keys.has(sequence.key)) problems.push(`${where}: duplicate key`);
    keys.add(sequence.key);
    for (const field of ["title", "summary", "result"]) {
      if (!sequence[field]) problems.push(`${where}: missing "${field}"`);
    }
    const participants = new Map();
    for (const participant of sequence.participants || []) {
      if (participants.has(participant.id)) problems.push(`${where}: duplicate participant "${participant.id}"`);
      participants.set(participant.id, participant);
      if (participant.node && !topo.nodes.has(participant.node)) problems.push(`${where}: participant "${participant.id}" references unknown node "${participant.node}"`);
      if (participant.resource) {
        const parent = topo.nodes.get(participant.resource.node);
        if (!parent?.resources?.some((resource) => resource.title === participant.resource.title)) {
          problems.push(`${where}: participant "${participant.id}" references missing resource "${participant.resource.title}" on "${participant.resource.node}"`);
        }
      }
      for (const covered of participant.covers || []) {
        if (topo.nodes.get(covered)?.shape !== "queue") problems.push(`${where}: participant "${participant.id}" covers "${covered}", which is not a queue`);
      }
      if (!participant.node && !participant.resource && !participant.covers && participant.kind !== "external") {
        problems.push(`${where}: participant "${participant.id}" must reference a node, resource or topics, or be kind "external"`);
      }
    }
    const used = new Set();
    const known = (id, context) => {
      if (!participants.has(id)) problems.push(`${where}: ${context} references unknown participant "${id}"`);
      used.add(id);
    };
    const walk = (steps, context) => {
      if (!Array.isArray(steps) || !steps.length) {
        problems.push(`${where}: ${context} has no steps`);
        return;
      }
      steps.forEach((step, index) => {
        const label = `${context} step ${index + 1}`;
        if (step.fragment) {
          if (!FRAGMENTS[step.fragment]) problems.push(`${where}: ${label} uses unknown fragment "${step.fragment}"`);
          if (step.operands) {
            if (!["alt", "par"].includes(step.fragment)) problems.push(`${where}: ${label} "${step.fragment}" takes a guard and steps, not operands`);
            step.operands.forEach((operand, operandIndex) => {
              if (!operand.guard) problems.push(`${where}: ${label} operand ${operandIndex + 1} needs a guard`);
              walk(operand.steps, `${label} [${operand.guard}]`);
            });
          } else {
            if (["alt", "par"].includes(step.fragment)) problems.push(`${where}: ${label} "${step.fragment}" needs at least two operands`);
            if (!step.guard) problems.push(`${where}: ${label} "${step.fragment}" needs a guard`);
            walk(step.steps, `${label} [${step.guard}]`);
          }
        } else if (step.note || step.ref) {
          if (!(step.over || []).length) problems.push(`${where}: ${label} ${step.ref ? "ref" : "note"} needs "over"`);
          (step.over || []).forEach((id) => known(id, `${label} ${step.ref ? "ref" : "note"}`));
        } else if (step.self) {
          known(step.self, label);
          if (!step.label) problems.push(`${where}: ${label} needs a label`);
        } else {
          known(step.from, label);
          known(step.to, label);
          if (!step.label) problems.push(`${where}: ${label} needs a label`);
          const from = participants.get(step.from);
          const to = participants.get(step.to);
          // Replies retrace the call chain and proxies (e.g. the edge rewrite) forward without owning an edge.
          if (from && to && !step.reply && !from.proxy && !to.proxy) {
            const a = participantScope(from);
            const b = participantScope(to);
            const linked = (x, y) => topo.edges.has(`${x}->${y}`) || topo.edges.has(`${y}->${x}`);
            const backed = a.some((x) => b.includes(x))
              || a.some((x) => b.some((y) => linked(x, y)))
              || a.some((x) => b.some((y) => [...topo.nodes.keys()].some((k) => linked(x, k) && linked(k, y))));
            const external = from.kind === "external" && !from.node || to.kind === "external" && !to.node;
            if (!backed && !external) warnings.push(`${where}: ${label} ${step.from} -> ${step.to} has no topology edge`);
          }
        }
      });
    };
    walk(sequence.steps, "");
    for (const id of participants.keys()) {
      if (!used.has(id)) warnings.push(`${where}: participant "${id}" is never used`);
    }
  }
}

/* ---------------------------------------------------------------- overview */

const storeAccent = (theme, brand, accent) => theme.brands[brand] || theme.accents[accent] || theme.accents.blue;

/** Classic database cylinder: top disc, one ring, brand mark (or a generic icon) in the body. */
function dbCylinder(x, y, w, h, theme, accent, brand, { ry = 7, icon = "database" } = {}) {
  const body = `M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry} V ${y + h - ry} A ${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z`;
  const ringY = y + ry + 10;
  const iconSize = Math.min(21, w * 0.42);
  const iconY = ringY + ry + (y + h - ry - (ringY + ry) - iconSize) / 2 + 1;
  return `<g>
    <path d="${body}" fill="${theme.node}" filter="url(#shadow)"/>
    <path d="${body}" fill="${accent}" fill-opacity="${tintOpacity(theme, 0.75)}" stroke="${accent}" stroke-width="1.3"/>
    <path d="M ${x} ${ringY} A ${w / 2} ${ry} 0 0 0 ${x + w} ${ringY}" fill="none" stroke="${accent}" stroke-opacity=".55" stroke-width="1.1"/>
    <ellipse cx="${round(x + w / 2)}" cy="${y + ry}" rx="${round(w / 2)}" ry="${ry}" fill="${theme.node}"/>
    <ellipse cx="${round(x + w / 2)}" cy="${y + ry}" rx="${round(w / 2)}" ry="${ry}" fill="${accent}" fill-opacity="${tintOpacity(theme, 2.2)}" stroke="${accent}" stroke-width="1.3"/>
    ${brand ? brandIcon(brand, x + (w - iconSize) / 2, iconY, iconSize, accent, icon) : genericIcon(icon, x + (w - iconSize) / 2, iconY, iconSize, accent)}
  </g>`;
}

/** Rounded card with an icon tile, a title and a small-caps caption. Returns the markup. */
function drawCardBase(node, theme, { tileFill, tileStroke, iconColor, cardFill, cardStroke, external = false }) {
  const brands = node.brands || (node.brand ? [node.brand] : []);
  const tile = Math.min(32, node.h - 18);
  const tileW = brands.length > 1 ? tile + 20 : tile;
  const tileX = node.x + 10;
  const tileY = node.y + (node.modules ? 10 : (node.h - tile) / 2);
  const iconSize = Math.round(tile * 0.56);
  const icons = brands.length
    ? brands.map((brand, index) => brandIcon(brand, tileX + (tileW - brands.length * iconSize - (brands.length - 1) * 4) / 2 + index * (iconSize + 4), tileY + (tile - iconSize) / 2, iconSize, iconColor, node.icon)).join("")
    : genericIcon(node.icon || "server", tileX + (tileW - iconSize) / 2, tileY + (tile - iconSize) / 2, iconSize, iconColor);
  const textX = tileX + tileW + 10;
  const available = node.x + node.w - textX - 8;
  const titleSize = fitSize(node.title, available, [13, 12.5, 12, 11.5, 11], { bold: true });
  const metaSize = fitSize(node.meta || "", available, [8.8, 8.4, 8, 7.6], { bold: true, tracking: 0.7 });
  const titleY = node.modules ? node.y + 24 : node.y + node.h / 2 - 1.5;
  return [
    `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="9" fill="${cardFill}" stroke="${cardStroke}" stroke-width="1.1" filter="url(#shadow)"/>`,
    `<rect x="${tileX}" y="${round(tileY)}" width="${tileW}" height="${tile}" rx="8" fill="${tileFill}" ${tileStroke ? `stroke="${tileStroke}"` : ""}/>`,
    icons,
    `<text x="${round(textX)}" y="${round(titleY)}" class="node-title" style="font-size:${titleSize}px">${esc(node.title)}</text>`,
    `<text x="${round(textX)}" y="${round(titleY + 13.5)}" class="node-meta" style="font-size:${metaSize}px">${esc(node.meta || "")}</text>`,
    external ? `<text x="${node.x + node.w - 7}" y="${node.y + 10}" text-anchor="end" class="stereo" style="font-size:7.5px">«external»</text>` : "",
  ].join("");
}

/** Pattern tags sit on the top border: right-aligned, or from `tagX` when an arrow needs that corner. */
function drawTags(node, theme, accent) {
  const tags = (node.tags || []).map((tag) => ({ tag, width: textWidth(tag, 7.8, { bold: true, tracking: 0.7 }) + 12 }));
  const total = tags.reduce((sum, item) => sum + item.width + 5, -5);
  let cursor = node.tagX ?? node.x + node.w - 8 - total;
  const parts = [];
  for (const { tag, width } of tags) {
    parts.push(`<rect x="${round(cursor)}" y="${node.y - 7.5}" width="${round(width)}" height="15" rx="7.5" fill="${theme.canvas}" stroke="${accent}" stroke-width="1.1"/>`);
    parts.push(`<text x="${round(cursor + width / 2)}" y="${node.y + 3}" text-anchor="middle" class="tag" style="fill:${accent}">${esc(tag)}</text>`);
    cursor += width + 5;
  }
  return parts.join("");
}

/** Client UI card: lighter than a service (a line icon instead of a filled tile) so the backend stays the focus. */
const CLIENT_CARD = { icon: 18, pad: 12, gap: 10, right: 8, title: 12, meta: [8, 7.6] };
function clientText(node) {
  const textX = node.x + CLIENT_CARD.pad + CLIENT_CARD.icon + CLIENT_CARD.gap;
  return { textX, available: node.x + node.w - textX - CLIENT_CARD.right };
}

function drawClient(node, theme) {
  const { textX, available } = clientText(node);
  const cy = node.y + node.h / 2;
  const metaSize = fitSize(node.meta || "", available, CLIENT_CARD.meta, { bold: true, tracking: 0.7 });
  return `<g>
    <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="9" fill="${theme.node}" stroke="${theme.border}" stroke-width="1.1" filter="url(#shadow)"/>
    ${nodeIcon(node, node.x + CLIENT_CARD.pad, cy - CLIENT_CARD.icon / 2, CLIENT_CARD.icon, theme.muted)}
    <text x="${textX}" y="${round(cy - 1.5)}" class="node-title" style="font-size:${CLIENT_CARD.title}px">${esc(node.title)}</text>
    <text x="${textX}" y="${round(cy + 11)}" class="node-meta" style="font-size:${metaSize}px">${esc(node.meta || "")}</text>
  </g>`;
}

/** Third-party card: grey fill; the EXTERNAL column header names the stereotype. */
function drawExternalCard(node, theme) {
  return `<g>${drawCardBase(node, theme, { tileFill: theme.node, tileStroke: theme.externalBorder, iconColor: theme.text, cardFill: theme.external, cardStroke: theme.externalBorder })}</g>`;
}

function storeLabelBox(node) {
  const w = Math.max(textWidth(node.title, 11.5, { bold: true }), textWidth(node.meta || "", 8.5, { bold: true, tracking: 0.7 })) + 4;
  if (node.label === "right") return { x: node.x + node.w + 6, y: node.y + node.h / 2 - 13, w, h: 28 };
  if (node.label === "left") return { x: node.x - 6 - w, y: node.y + node.h / 2 - 13, w, h: 28 };
  return { x: node.x + node.w / 2 - w / 2, y: node.y + node.h + 4, w, h: 28 };
}

function drawStore(node, theme) {
  const accent = storeAccent(theme, node.brand, node.accent);
  const parts = [dbCylinder(node.x, node.y, node.w, node.h, theme, accent, node.brand, { icon: node.icon || "database" })];
  if (node.label === "right" || node.label === "left") {
    const x = node.label === "right" ? node.x + node.w + 8 : node.x - 8;
    const anchor = node.label === "right" ? "start" : "end";
    parts.push(`<text x="${x}" y="${round(node.y + node.h / 2 - 1)}" text-anchor="${anchor}" class="store-title">${esc(node.title)}</text>`);
    parts.push(`<text x="${x}" y="${round(node.y + node.h / 2 + 12)}" text-anchor="${anchor}" class="store-meta">${esc(node.meta || "")}</text>`);
  } else {
    const cx = node.x + node.w / 2;
    parts.push(`<text x="${round(cx)}" y="${node.y + node.h + 15}" text-anchor="middle" class="store-title">${esc(node.title)}</text>`);
    parts.push(`<text x="${round(cx)}" y="${node.y + node.h + 27}" text-anchor="middle" class="store-meta">${esc(node.meta || "")}</text>`);
  }
  return `<g>${parts.join("")}</g>`;
}

function overviewLinkPoints(link, boxes) {
  const a = boxes.get(link.from);
  const b = boxes.get(link.to);
  if (!a || !b) throw new Error(`overview: link ${link.from} -> ${link.to} references an unknown element`);
  if (link.x !== undefined) {
    const down = b.y >= a.y + a.h - 1;
    return down
      ? [{ x: link.x, y: a.y + a.h }, { x: link.x, y: b.y }]
      : [{ x: link.x, y: a.y }, { x: link.x, y: b.y + b.h }];
  }
  if (link.y !== undefined) {
    const right = b.x >= a.x + a.w - 1;
    return right
      ? [{ x: a.x + a.w, y: link.y }, { x: b.x, y: link.y }]
      : [{ x: a.x, y: link.y }, { x: b.x + b.w, y: link.y }];
  }
  const via = (link.via || []).map(([x, y]) => ({ x, y }));
  if (!via.length) throw new Error(`overview: link ${link.from} -> ${link.to} needs "x", "y" or "via"`);
  const exit = (box, toward) => (toward.x >= box.x && toward.x <= box.x + box.w
    ? { x: toward.x, y: toward.y < box.y ? box.y : box.y + box.h }
    : { x: toward.x < box.x ? box.x : box.x + box.w, y: toward.y });
  return [exit(a, via[0]), ...via, exit(b, via.at(-1))];
}

function linkLabel(label, theme) {
  if (!label) return "";
  const anchor = label.anchor || "start";
  if (label.style === "pill") return labelPill(label.text, label.x, label.y, theme);
  const cls = { route: "route", topic: "topic" }[label.style] || "edge-note";
  return `<text x="${label.x}" y="${label.y}" text-anchor="${anchor}" class="${cls}">${esc(label.text)}</text>`;
}

/** ADR-001 as a decision record with a Cloud Run → Kubernetes mapping table. Returns { h, render(height) }. */
function layoutAdr(adr, x, y, w, theme) {
  const accent = theme.runtime;
  const pad = 18;
  const keyW = 78;
  const parts = [];
  const top = y + 16;
  parts.push(brandIcon("kubernetes", x + pad, top - 1, 24, accent, "layers"));
  const idW = textWidth(adr.id, 9, { bold: true, tracking: 0.8 }) + 16;
  const idX = x + pad + 34;
  parts.push(`<rect x="${round(idX)}" y="${top + 2}" width="${round(idW)}" height="18" rx="9" fill="${accent}" fill-opacity="${tintOpacity(theme, 1.2)}" stroke="${accent}" stroke-opacity=".5"/>`);
  parts.push(`<text x="${round(idX + idW / 2)}" y="${top + 14.5}" text-anchor="middle" class="tag" style="fill:${accent};font-size:9px">${esc(adr.id)}</text>`);
  parts.push(`<text x="${round(idX + idW + 10)}" y="${top + 16}" class="adr-title">${esc(adr.title)}</text>`);
  if (adr.status) {
    const statusW = textWidth(adr.status, 8.5, { bold: true, tracking: 0.7 }) + 18;
    parts.push(`<rect x="${round(x + w - pad - statusW)}" y="${top + 2}" width="${round(statusW)}" height="18" rx="9" fill="${theme.canvas}" stroke="${theme.border}"/>`);
    parts.push(`<text x="${round(x + w - pad - statusW / 2)}" y="${top + 14.5}" text-anchor="middle" class="tag" style="fill:${theme.muted};font-size:8.5px">${esc(adr.status)}</text>`);
  }

  let cursor = y + 62;
  for (const [key, text] of adr.rows || []) {
    const lines = wrapText(text, 11, w - 2 * pad - keyW);
    parts.push(`<text x="${x + pad}" y="${cursor}" class="adr-key">${esc(key.toUpperCase())}</text>`);
    lines.forEach((line, index) => parts.push(`<text x="${x + pad + keyW}" y="${round(cursor + index * 15)}" class="adr-text">${esc(line)}</text>`));
    cursor += lines.length * 15 + 6;
  }

  const tableX = x + pad;
  const tableW = w - 2 * pad;
  const arrowW = 28;
  const colW = (tableW - arrowW) / 2;
  cursor += 2;
  const headH = 24;
  parts.push(`<rect x="${tableX}" y="${cursor}" width="${tableW}" height="${headH}" rx="6" fill="${accent}" fill-opacity="${tintOpacity(theme, 0.9)}"/>`);
  (adr.columns || []).forEach((column, index) => {
    const cx = tableX + index * (colW + arrowW) + 10;
    const color = index ? accent : theme.text;
    parts.push(brandIcon(column.brand, cx, cursor + 5, 14, color, "cloud"));
    parts.push(`<text x="${round(cx + 21)}" y="${cursor + 16}" class="adr-key" style="fill:${color}">${esc(column.title)}</text>`);
  });
  cursor += headH;
  (adr.mapping || []).forEach(([left, right], index) => {
    const leftLines = wrapText(left, 11, colW - 18);
    const rightLines = wrapText(right, 11, colW - 18, { bold: true });
    const rowH = Math.max(leftLines.length, rightLines.length) * 15 + 7;
    if (index % 2 === 1) parts.push(`<rect x="${tableX}" y="${cursor}" width="${tableW}" height="${rowH}" fill="${theme.chipBg}"/>`);
    leftLines.forEach((line, i) => parts.push(`<text x="${tableX + 10}" y="${round(cursor + 15 + i * 15)}" class="adr-text">${esc(line)}</text>`));
    parts.push(`<text x="${round(tableX + colW + arrowW / 2)}" y="${round(cursor + 15)}" text-anchor="middle" class="adr-text" style="fill:${accent};font-weight:700">→</text>`);
    rightLines.forEach((line, i) => parts.push(`<text x="${round(tableX + colW + arrowW + 10)}" y="${round(cursor + 15 + i * 15)}" class="adr-text" style="fill:${theme.text};font-weight:600">${esc(line)}</text>`));
    cursor += rowH;
  });
  parts.push(`<path d="M ${tableX} ${cursor} H ${tableX + tableW}" stroke="${theme.divider}"/>`);

  if (adr.revisit) {
    cursor += 20;
    const lines = wrapText(adr.revisit, 11, w - 2 * pad - keyW);
    parts.push(`<text x="${x + pad}" y="${cursor}" class="adr-key">REVISIT</text>`);
    lines.forEach((line, index) => parts.push(`<text x="${x + pad + keyW}" y="${round(cursor + index * 15)}" class="adr-text">${esc(line)}</text>`));
    cursor += (lines.length - 1) * 15;
  }
  const h = cursor - y + 16;
  return {
    h,
    render: (height) => `<g>
      <rect x="${x}" y="${y}" width="${w}" height="${round(height)}" rx="10" fill="${theme.node}" stroke="${theme.border}" filter="url(#shadow)"/>
      <rect x="${x + 0.6}" y="${y + 0.6}" width="3" height="${round(height - 1.2)}" rx="1.5" fill="${accent}"/>
      ${parts.join("")}
    </g>`,
  };
}

/** Platform concerns with generic icons; descriptions wrap. Returns { h, render(height) }. */
function layoutPlatform(platform, x, y, w, theme) {
  const keyX = x + 40;
  const textX = x + 138;
  const textW = x + w - 16 - textX;
  const parts = [`<text x="${x + 16}" y="${y + 30}" class="tier-title" style="font-size:11px">${esc(platform.title.toUpperCase())}</text>`];
  let cursor = y + 60;
  for (const item of platform.items) {
    const lines = wrapText(item.meta, 11, textW);
    parts.push(genericIcon(item.icon || "server", x + 16, cursor - 11.5, 15, theme.text));
    parts.push(`<text x="${keyX}" y="${cursor}" class="adr-key" style="fill:${theme.text}">${esc(item.title.toUpperCase())}</text>`);
    lines.forEach((line, index) => parts.push(`<text x="${textX}" y="${round(cursor + index * 15)}" class="adr-text">${esc(line)}</text>`));
    cursor += lines.length * 15 + 10;
  }
  const h = cursor - y + 2;
  return {
    h,
    render: (height) => `<g>
      <rect x="${x}" y="${y}" width="${w}" height="${round(height)}" rx="10" fill="${theme.node}" stroke="${theme.border}" filter="url(#shadow)"/>
      ${parts.join("")}
    </g>`,
  };
}

/** Lane colour: one accent per system so each lane reads as its own system. */
const laneAccent = (theme, lane) => theme.accents[lane?.accent] || theme.accents.slate;

function drawLaneService(node, theme, accent) {
  return `<g>${drawCardBase(node, theme, { tileFill: accent, iconColor: theme.tileText, cardFill: theme.node, cardStroke: theme.border })}${drawTags(node, theme, accent)}</g>`;
}

/** A lane's Kafka: a horizontal pipe with the topics this system produces or consumes. */
function drawKafka(node, theme) {
  const accent = theme.edges.event;
  const { x, y, w, h } = node;
  const rx = 10;
  const body = `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${h / 2} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${h / 2} 0 0 1 ${x + rx} ${y} Z`;
  const topics = node.topics || [];
  const titleY = y + (topics.length > 1 ? 18 : 21);
  const lines = topics.map((topic, index) => `<text x="${x + 15}" y="${round(titleY + 13.5 + index * 11)}" class="topic-in" style="font-size:${fitSize(topic, w - 2 * rx - 22, [9.5, 9, 8.5, 8], { mono: true })}px">${esc(topic)}</text>`);
  return `<g>
    <path d="${body}" fill="${theme.node}" filter="url(#shadow)"/>
    <path d="${body}" fill="${accent}" fill-opacity="${tintOpacity(theme, 1.1)}" stroke="${accent}" stroke-width="1.3"/>
    <ellipse cx="${x + w - rx}" cy="${y + h / 2}" rx="${rx}" ry="${h / 2}" fill="${theme.node}" stroke="${accent}" stroke-width="1.3"/>
    ${brandIcon("apachekafka", x + 15, titleY - 10.5, 13, theme.text)}
    <text x="${x + 33}" y="${round(titleY)}" class="node-title" style="font-size:12.5px">${esc(node.title || "Kafka")}</text>
    ${lines.join("")}
  </g>`;
}

function laneBadge(cx, cy, r, number, accent, size = 10) {
  return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="${accent}"/>
    <text x="${round(cx)}" y="${round(cy + size * 0.36)}" text-anchor="middle" class="lane-num" style="font-size:${size}px">${number}</text>`;
}

/** Reference to a service that lives in another lane: no shadow, numbered badge, lane name. */
function drawRef(node, theme, target) {
  const accent = laneAccent(theme, target.lane);
  const cy = node.y + node.h / 2;
  const title = node.title || target.title;
  const textX = node.x + 34;
  return `<g>
    <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="9" fill="${theme.node}" stroke="${accent}" stroke-opacity=".7" stroke-width="1.2"/>
    ${laneBadge(node.x + 17, cy, 9, target.lane.number, accent, 10)}
    <text x="${textX}" y="${round(cy - 1.5)}" class="node-title" style="font-size:${fitSize(title, node.x + node.w - textX - 6, [12, 11.5, 11], { bold: true })}px">${esc(title)}</text>
    <text x="${textX}" y="${round(cy + 10.5)}" class="node-meta" style="font-size:7.6px">${esc((node.meta || `IN ${target.lane.title}`).toUpperCase())}</text>
  </g>`;
}

/** Hand-off chip: an event this lane emits that another lane consumes. */
function drawHandoff(node, theme, target) {
  const accent = laneAccent(theme, target.lane);
  const cy = node.y + node.h / 2;
  const textW = textWidth(node.text, 9.5, { mono: true });
  return `<g>
    <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${node.h / 2}" fill="${theme.node}" stroke="${theme.edges.event}" stroke-opacity=".75" stroke-width="1.2"/>
    <text x="${node.x + 12}" y="${round(cy + 3.3)}" class="topic-in" style="font-size:9.5px">${esc(node.text)}</text>
    <text x="${round(node.x + 20 + textW)}" y="${round(cy + 3.8)}" class="legend" style="fill:${theme.muted}">→</text>
    ${laneBadge(node.x + node.w - 15, cy, 8, target.lane.number, accent, 9.5)}
  </g>`;
}

/** A link's labels: `label`, plus `labels` when one connector carries two (the API route and what it does). */
const labelsOf = (link) => [link.label, ...(link.labels || [])].filter(Boolean);

/** Lanes stack under the zone header; node and link y coordinates in the JSON are relative to their lane. */
function layoutOverview(overview) {
  const lanes = [];
  const nodes = [];
  const links = [];
  let top = overview.layout.lanesTop;
  for (const lane of overview.lanes) {
    const placed = { ...lane, top };
    lanes.push(placed);
    for (const node of lane.nodes) nodes.push({ ...node, y: top + node.y, lane: placed });
    lane.links.forEach((link) => links.push({
      ...link,
      lane: placed,
      y: link.y === undefined ? undefined : top + link.y,
      via: link.via?.map(([x, y]) => [x, top + y]),
      label: link.label ? { ...link.label, y: top + link.label.y } : undefined,
      labels: link.labels?.map((label) => ({ ...label, y: top + label.y })),
    }));
    top += lane.h + overview.layout.laneGap;
  }
  const laneTop = new Map(lanes.map((lane) => [lane.id, lane.top]));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const sharedStores = (overview.sharedStores || []).map((store) => {
    const [upper, lower] = store.between.map((id) => laneById.get(id)).sort((p, q) => p.top - q.top);
    const boundary = (upper.top + upper.h + lower.top) / 2;
    return { ...store, kind: "store", y: round(boundary - store.h / 2), lanes: [upper, lower] };
  });
  const crossLinks = (overview.crossLinks || []).map((link) => ({
    ...link,
    points: link.points.map(([x, laneId, y]) => ({ x, y: laneTop.get(laneId) + y })),
    label: link.label ? { ...link.label, y: laneTop.get(link.label.lane) + link.label.y } : undefined,
  }));
  return { lanes, nodes, links, crossLinks, sharedStores, bottom: top - overview.layout.laneGap };
}

/** System map: every lane as one node, with the shared data, events and calls between them. */
function drawSystemMap(map, overview, theme) {
  const lanes = new Map(overview.lanes.map((lane) => [lane.id, lane]));
  const { width } = overview.canvas;
  const parts = [`<rect x="16" y="${map.y}" width="${width - 32}" height="${map.h}" rx="10" fill="${theme.tierFill}" stroke="${theme.divider}"/>`];
  parts.push(`<text x="30" y="${map.y + 23}" class="tier-title" style="font-size:10.5px">${esc(map.title)}</text>`);
  // Plain strokes (no knockout halo): the tool-gateway branches share one trunk.
  for (const link of map.links) {
    const style = EDGE_STYLE[link.kind];
    const points = link.points.map(([x, y]) => ({ x, y }));
    // A shared store has no direction (both systems use it), so its line carries a store glyph instead of an arrowhead.
    const head = link.shared ? "" : `marker-end="url(#arrow-${link.kind})"`;
    parts.push(`<path d="${roundedPath(points)}" fill="none" stroke="${theme.edges[link.kind]}" stroke-width="${style.width + 0.1}" ${style.dash ? `stroke-dasharray="${style.dash}"` : ""} stroke-linejoin="round" ${head}/>`);
  }
  for (const link of map.links.filter((item) => item.shared)) {
    const store = overview.sharedStores.find((item) => item.id === link.shared);
    const [[x1, y1], [x2, y2]] = link.points;
    parts.push(miniStore((x1 + x2) / 2, (y1 + y2) / 2, theme, storeAccent(theme, store.brand, store.accent), theme.tierFill));
  }
  for (const node of map.nodes) {
    const lane = lanes.get(node.lane);
    const accent = laneAccent(theme, lane);
    const cy = node.y + node.h / 2;
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="9" fill="${theme.node}" stroke="${accent}" stroke-opacity=".75" stroke-width="1.3" filter="url(#shadow)"/>`);
    parts.push(laneBadge(node.x + 20, cy, 11, lane.number, accent, 11.5));
    parts.push(`<text x="${node.x + 38}" y="${round(cy - 1.5)}" class="node-title" style="font-size:${fitSize(lane.title, node.w - 46, [13, 12.5, 12], { bold: true })}px">${esc(lane.title)}</text>`);
    parts.push(`<text x="${node.x + 38}" y="${round(cy + 11)}" class="node-meta" style="font-size:7.8px">${esc(node.meta || "")}</text>`);
  }
  for (const link of map.links) parts.push(linkLabel(link.label, theme));
  return `<g>${parts.join("")}</g>`;
}

/** A small database glyph on a system-map line: the two systems share this store rather than call each other. */
function miniStore(cx, cy, theme, accent, background) {
  const w = 16;
  const h = 20;
  const ry = 3.5;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const body = `M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry} V ${y + h - ry} A ${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z`;
  return `<g>
    <rect x="${round(x - 5)}" y="${round(y - 3)}" width="${w + 10}" height="${h + 6}" fill="${background}"/>
    <path d="${body}" fill="${theme.node}"/>
    <path d="${body}" fill="${accent}" fill-opacity="${tintOpacity(theme, 0.9)}" stroke="${accent}" stroke-width="1.2"/>
    <path d="M ${x} ${y + ry + 5.5} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry + 5.5}" fill="none" stroke="${accent}" stroke-opacity=".6"/>
    <ellipse cx="${round(cx)}" cy="${round(y + ry)}" rx="${w / 2}" ry="${ry}" fill="${theme.node}"/>
    <ellipse cx="${round(cx)}" cy="${round(y + ry)}" rx="${w / 2}" ry="${ry}" fill="${accent}" fill-opacity="${tintOpacity(theme, 2.2)}" stroke="${accent}" stroke-width="1.2"/>
  </g>`;
}

/** Column headers: clients, the Vercel edge, the Cloud Run backend (with the Kubernetes exit path) and third parties. */
function drawZoneHeader(overview, theme) {
  const { width } = overview.canvas;
  const { zoneTop: top, zoneH: h } = overview.layout;
  const mid = top + h / 2;
  const parts = [`<rect x="16" y="${top}" width="${width - 32}" height="${h}" rx="8" fill="${theme.tierFill}"/>`];
  for (const zone of overview.zones) {
    if (zone.runtime) parts.push(`<rect x="${zone.x}" y="${top}" width="${zone.w}" height="${h}" fill="${theme.runtimeFill}"/>`);
  }
  for (const zone of overview.zones.slice(1)) parts.push(`<path d="M ${zone.x} ${top + 1} V ${top + h - 1}" stroke="${theme.divider}"/>`);
  parts.push(`<rect x="16" y="${top}" width="${width - 32}" height="${h}" rx="8" fill="none" stroke="${theme.divider}"/>`);
  for (const zone of overview.zones) {
    if (zone.runtime) {
      const runtime = zone.runtime;
      const tileX = zone.x + 14;
      parts.push(`<rect x="${tileX}" y="${round(mid - 11)}" width="22" height="22" rx="6" fill="${theme.runtime}"/>`);
      parts.push(brandIcon(runtime.brand, tileX + 4.5, mid - 6.5, 13, theme.tileText, "cloud"));
      parts.push(`<text x="${tileX + 30}" y="${round(mid - 1.5)}" class="node-title" style="font-size:12.5px">${esc(runtime.title)}</text>`);
      parts.push(`<text x="${tileX + 30}" y="${round(mid + 10.5)}" class="node-meta" style="font-size:7.8px;fill:${theme.runtime}">${esc(runtime.meta)}</text>`);
      if (zone.badge) {
        const badge = zone.badge;
        const textW = Math.max(textWidth(badge.title, 12.5, { bold: true }), textWidth(badge.meta, 7.8, { bold: true, tracking: 0.7 }));
        const badgeX = zone.x + zone.w - 14 - textW - 30;
        parts.push(brandIcon(badge.brand, badgeX, mid - 11, 22, theme.runtime, "layers"));
        parts.push(`<text x="${round(badgeX + 30)}" y="${round(mid - 1.5)}" class="node-title" style="font-size:12.5px;fill:${theme.runtime}">${esc(badge.title)}</text>`);
        parts.push(`<text x="${round(badgeX + 30)}" y="${round(mid + 10.5)}" class="node-meta" style="font-size:7.8px">${esc(badge.meta)}</text>`);
      }
      continue;
    }
    const start = zone.align === "start";
    const x = start ? zone.x + 14 : zone.x + zone.w / 2;
    parts.push(`<text x="${round(x)}" y="${round(zone.meta ? mid - 1.5 : mid + 3.5)}" text-anchor="${start ? "start" : "middle"}" class="tier-title">${esc(zone.title)}</text>`);
    if (zone.meta) parts.push(`<text x="${round(x)}" y="${round(mid + 10.5)}" text-anchor="${start ? "start" : "middle"}" class="tier-host">${esc(zone.meta)}</text>`);
  }
  return `<g>${parts.join("")}</g>`;
}

/** The purpose text in a lane header: wrapped lines, and how many of them fit above the lane's bottom edge. */
const LANE_SUMMARY = { size: 11, top: 60, step: 15, bottom: 14 };
function laneSummary(lane, headerW) {
  return {
    lines: wrapText(lane.summary, LANE_SUMMARY.size, headerW - 28),
    capacity: Math.floor((lane.h - LANE_SUMMARY.top - LANE_SUMMARY.bottom) / LANE_SUMMARY.step) + 1,
  };
}

/** One system: a bordered lane with a coloured header (number, name, one-line purpose) and the zone columns. */
function drawLaneFrame(lane, overview, theme) {
  const accent = laneAccent(theme, lane);
  const { width } = overview.canvas;
  const x = 16;
  const w = width - 32;
  const { top, h } = lane;
  const r = 10;
  const headerW = overview.layout.headerW;
  const parts = [`<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${r}" fill="${theme.node}" filter="url(#shadow)"/>`];
  for (const zone of overview.zones) {
    if (zone.runtime) parts.push(`<rect x="${zone.x}" y="${top}" width="${zone.w}" height="${h}" fill="${theme.runtimeFill}"/>`);
  }
  parts.push(`<path d="M ${x + r} ${top} H ${x + headerW} V ${top + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${top + h - r} V ${top + r} A ${r} ${r} 0 0 1 ${x + r} ${top} Z" fill="${accent}" fill-opacity="${tintOpacity(theme, theme.name === "dark" ? 0.55 : 0.85)}"/>`);
  for (const zone of overview.zones.slice(1)) parts.push(`<path d="M ${zone.x} ${top + 1} V ${top + h - 1}" stroke="${zone.x === x + headerW ? accent : theme.divider}" ${zone.x === x + headerW ? 'stroke-opacity=".35"' : ""}/>`);
  parts.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${accent}" stroke-opacity=".55" stroke-width="1.2"/>`);
  parts.push(`<rect x="${x + 0.6}" y="${top + 0.6}" width="4" height="${h - 1.2}" rx="2" fill="${accent}"/>`);
  parts.push(laneBadge(x + 26, top + 28, 12, lane.number, accent, 12.5));
  parts.push(`<text x="${x + 46}" y="${round(top + 33)}" class="lane-title" style="font-size:${fitSize(lane.title, headerW - 54, [15, 14, 13], { bold: true })}px">${esc(lane.title)}</text>`);
  const summary = laneSummary(lane, headerW);
  summary.lines.slice(0, summary.capacity).forEach((line, index) => parts.push(`<text x="${x + 16}" y="${round(top + LANE_SUMMARY.top + index * LANE_SUMMARY.step)}" class="lane-sub">${esc(line)}</text>`));
  // Optional note for empty cells (e.g. a lane with no public entry); its pill hides the column divider.
  for (const note of lane.notes || []) {
    const noteW = textWidth(note.text, 10.5, { bold: true }) + 20;
    const noteY = top + note.y;
    parts.push(`<rect x="${round(note.x - noteW / 2)}" y="${round(noteY - 11)}" width="${round(noteW)}" height="20" rx="10" fill="${theme.node}" stroke="${theme.divider}"/>`);
    parts.push(`<text x="${note.x}" y="${round(noteY + 3)}" text-anchor="middle" class="edge-note" style="fill:${theme.faint}">${esc(note.text)}</text>`);
  }
  return `<g>${parts.join("")}</g>`;
}

function legendRowOverview(x, y, theme) {
  const parts = [];
  let cursor = x;
  const caption = (text) => {
    parts.push(`<text x="${round(cursor)}" y="${y + 4}" class="legend">${text}</text>`);
    cursor += textWidth(text, 11.5, { bold: true }) + 20;
  };
  parts.push(`<text x="${cursor}" y="${y + 4}" class="tier-title" style="font-size:11px">LEGEND</text>`);
  cursor += 66;
  parts.push(`<rect x="${cursor}" y="${y - 10}" width="20" height="20" rx="5" fill="${theme.accents.green}"/>${genericIcon("server", cursor + 4, y - 6, 12, theme.tileText)}`);
  cursor += 27; caption("Service (tile = system)");
  parts.push(dbCylinder(cursor, y - 13, 22, 26, theme, theme.brands.postgresql, null, { ry: 4 }));
  cursor += 29; caption("Data store");
  parts.push(pipeShape(cursor, y - 8, 34, 16, theme, theme.edges.event));
  cursor += 41; caption("Kafka topics");
  parts.push(`<rect x="${cursor}" y="${y - 10}" width="34" height="20" rx="5" fill="${theme.node}" stroke="${theme.accents.orange}" stroke-opacity=".7"/>${laneBadge(cursor + 10, y, 6, 2, theme.accents.orange, 8)}`);
  cursor += 41; caption("In another lane");
  parts.push(`<rect x="${cursor}" y="${y - 10}" width="30" height="20" rx="5" fill="${theme.external}" stroke="${theme.externalBorder}"/>`);
  cursor += 37; caption("Third-party");
  for (const [kind, text] of [["request", "Sync call"], ["event", "Async event"], ["data", "Data access"]]) {
    const style = EDGE_STYLE[kind];
    parts.push(`<line x1="${round(cursor)}" y1="${y}" x2="${round(cursor + 30)}" y2="${y}" stroke="${theme.edges[kind]}" stroke-width="${style.width + 0.2}" marker-end="url(#arrow-${kind})"/>`);
    cursor += 37;
    caption(text);
  }
  return parts.join("\n");
}

/**
 * Kafka reads left to right, like the pipe is drawn: producers enter at the tail (the left end) and consumers
 * read from the head (the right end), both horizontally through the middle of the pipe.
 */
function validateKafkaPorts(overview, problems) {
  const layout = layoutOverview(overview);
  const byId = new Map([...layout.nodes, ...layout.sharedStores].map((node) => [node.id, node]));
  const near = (a, b) => Math.abs(a - b) < 0.5;
  for (const link of [...layout.links, ...layout.crossLinks]) {
    const points = link.points || overviewLinkPoints(link, byId);
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    const where = `overview: link ${link.from} -> ${link.to}`;
    if (to?.kind === "kafka") {
      const [before, end] = points.slice(-2);
      const tail = near(end.x, to.x) && near(end.y, to.y + to.h / 2) && near(before.y, end.y) && before.x < end.x;
      if (!tail) problems.push(`${where} must enter Kafka "${to.id}" horizontally at its left end (the tail)`);
    }
    if (from?.kind === "kafka") {
      const [start, after] = points.slice(0, 2);
      const head = near(start.x, from.x + from.w) && near(start.y, from.y + from.h / 2) && near(after.y, start.y) && after.x > start.x;
      if (!head) problems.push(`${where} must leave Kafka "${from.id}" horizontally from its right end (the head)`);
    }
  }
}

/** Developer aid: warns when labels collide with each other, with nodes or with other connectors. */
function overlapWarnings(overview, warnings) {
  const layout = layoutOverview(overview);
  const byId = new Map([...layout.nodes, ...layout.sharedStores].map((node) => [node.id, node]));
  const rects = layout.sharedStores.map((store) => ({ id: store.id, x: store.x, y: store.y, w: store.w, h: store.h }));
  for (const node of layout.nodes) {
    rects.push({ id: node.id, ...node });
    if (node.kind === "store") rects.push({ id: `${node.id}:label`, ...storeLabelBox(node) });
  }
  const labelRect = (label, size = 10.5) => {
    const w = textWidth(label.text, size, { bold: true });
    const x = label.anchor === "end" ? label.x - w : label.anchor === "middle" ? label.x - w / 2 : label.x;
    return { x, y: label.y - size, w, h: size + 3 };
  };
  const allLinks = [...layout.links, ...layout.crossLinks];
  allLinks.forEach((link, index) => {
    labelsOf(link).forEach((label, n) => rects.push({ id: `label:${index}:${n}`, ...labelRect(label) }));
  });
  for (const node of layout.nodes.filter((item) => ["service", "external"].includes(item.kind))) {
    const brands = node.brands || (node.brand ? [node.brand] : []);
    const tile = Math.min(32, node.h - 18);
    // The 8px right padding absorbs a few pixels of overshoot from the width estimate.
    const available = node.w - 10 - (brands.length > 1 ? tile + 20 : tile) - 10 - 3;
    if (textWidth(node.title, 11, { bold: true }) > available) warnings.push(`overview layout: title of "${node.id}" does not fit its card`);
    if (textWidth(node.meta || "", 7.6, { bold: true, tracking: 0.7 }) > available) warnings.push(`overview layout: meta of "${node.id}" does not fit its card`);
  }
  for (const node of layout.nodes.filter((item) => item.kind === "client")) {
    const { available } = clientText(node);
    if (textWidth(node.title, CLIENT_CARD.title, { bold: true }) > available) warnings.push(`overview layout: title of client "${node.id}" does not fit its card`);
    if (textWidth(node.meta || "", CLIENT_CARD.meta.at(-1), { bold: true, tracking: 0.7 }) > available) warnings.push(`overview layout: meta of client "${node.id}" does not fit its card`);
  }
  for (const lane of layout.lanes) {
    const summary = laneSummary(lane, overview.layout.headerW);
    if (summary.lines.length > summary.capacity) warnings.push(`overview layout: summary of lane "${lane.id}" wraps to ${summary.lines.length} lines but only ${summary.capacity} fit; shorten it`);
    for (const node of layout.nodes.filter((item) => item.lane.id === lane.id)) {
      const box = node.kind === "store" ? { ...node, h: node.h + (node.label ? 0 : 30) } : node;
      if (box.y < lane.top + 6 || box.y + box.h > lane.top + lane.h - 4) warnings.push(`overview layout: "${node.id}" sticks out of lane "${lane.id}"`);
    }
  }
  const hit = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const p = rects[i];
      const q = rects[j];
      if (!String(p.id).includes(":") && !String(q.id).includes(":")) {
        if (hit(p, q)) warnings.push(`overview layout: "${p.id}" overlaps "${q.id}"`);
        continue;
      }
      if (hit(p, q)) warnings.push(`overview layout: "${p.id}" overlaps "${q.id}"`);
    }
  }
  const segments = allLinks.flatMap((link, index) => {
    const points = link.points || overviewLinkPoints(link, byId);
    return points.slice(0, -1).map((start, i) => ({ index, start, end: points[i + 1] }));
  });
  for (const rect of rects.filter((item) => /^label:|:label$/.test(String(item.id)))) {
    const own = String(rect.id).match(/^label:(\d+)/)?.[1];
    for (const { index, start, end } of segments) {
      if (own !== undefined && Number(own) === index) continue;
      const box = { x: Math.min(start.x, end.x) - 1, y: Math.min(start.y, end.y) - 1, w: Math.abs(end.x - start.x) + 2, h: Math.abs(end.y - start.y) + 2 };
      if (hit(rect, box)) warnings.push(`overview layout: "${rect.id}" crosses link ${allLinks[index].from} -> ${allLinks[index].to}`);
    }
  }
}

/**
 * A store two lanes share sits on their boundary: the cylinder bridges the gap, its label sits on a knockout
 * plate to the left, and one numbered badge per lane marks the halves.
 */
function drawSharedStore(store, theme) {
  const accent = storeAccent(theme, store.brand, store.accent);
  const titleW = textWidth(store.title, 11.5, { bold: true });
  const metaW = textWidth(store.meta || "", 8.5, { bold: true, tracking: 0.7 });
  const plateW = Math.max(titleW, metaW) + 20;
  const cy = store.y + store.h / 2;
  const plateX = store.x - 10 - plateW;
  const badges = store.lanes.map((lane, index) => laneBadge(store.x + store.w + 10, cy + (index === 0 ? -12 : 12), 8, lane.number, laneAccent(theme, lane), 9.5)).join("");
  return `<g>
    <rect x="${round(store.x - 6)}" y="${round(store.y - 4)}" width="${store.w + 12}" height="${store.h + 8}" rx="8" fill="${theme.canvas}"/>
    ${dbCylinder(store.x, store.y, store.w, store.h, theme, accent, store.brand, { icon: store.icon || "database" })}
    <rect x="${round(plateX)}" y="${round(cy - 15)}" width="${round(plateW)}" height="30" rx="8" fill="${theme.canvas}" stroke="${accent}" stroke-opacity=".45"/>
    <text x="${round(plateX + plateW / 2)}" y="${round(cy - 2)}" text-anchor="middle" class="store-title">${esc(store.title)}</text>
    <text x="${round(plateX + plateW / 2)}" y="${round(cy + 10)}" text-anchor="middle" class="store-meta">${esc(store.meta || "")}</text>
    <rect x="${round(store.x + store.w + 1)}" y="${round(cy - 22)}" width="18" height="44" rx="9" fill="${theme.canvas}"/>
    ${badges}
  </g>`;
}

/** Numbered badges on a store that other lanes read too (e.g. the RAG chunks Ask AI searches). */
function sharedBadges(node, overview, theme) {
  return (node.shared || []).map((number, index) => {
    const lane = overview.lanes.find((item) => item.number === number);
    return laneBadge(node.x + node.w + 1 + index * 17, node.y + 7, 7.5, number, laneAccent(theme, lane), 9);
  }).join("");
}

function renderOverview(overview, catalog, coverage, theme) {
  const { width } = overview.canvas;
  const layout = layoutOverview(overview);
  const byId = new Map([...layout.nodes, ...layout.sharedStores].map((node) => [node.id, node]));
  const parts = [];

  parts.push(`<text x="28" y="40" class="eyebrow">${esc(overview.eyebrow)}</text>`);
  parts.push(`<text x="28" y="72" class="h1">${esc(overview.title)}</text>`);
  wrapText(overview.subtitle, 14, width - 56).forEach((line, index) => parts.push(`<text x="28" y="${97 + index * 19}" class="sub">${esc(line)}</text>`));

  if (overview.systemMap) parts.push(drawSystemMap(overview.systemMap, overview, theme));
  parts.push(drawZoneHeader(overview, theme));
  for (const lane of layout.lanes) parts.push(drawLaneFrame(lane, overview, theme));

  // Links go over the lane frames (the knockout halo bridges lane borders) and under the nodes. All halos are drawn
  // before any stroke, so links that share a trunk (the outbox relay forking to two Kafkas) keep both branches whole.
  const paths = [
    ...layout.crossLinks.map((link) => ({ points: link.points, kind: link.kind, extraWidth: 0.3 })),
    ...layout.links.map((link) => ({ points: overviewLinkPoints(link, byId), kind: link.kind, extraWidth: 0 })),
  ];
  for (const layer of ["halo", "stroke"]) {
    parts.push(`<g>${paths.map((item) => connector(item.points, item.kind, theme, { extraWidth: item.extraWidth, layer })).join("")}</g>`);
  }
  for (const node of layout.nodes) {
    const target = node.ref ? byId.get(node.ref) : null;
    if (node.kind === "client") parts.push(drawClient(node, theme));
    else if (node.kind === "kafka") parts.push(drawKafka(node, theme));
    else if (node.kind === "store") parts.push(drawStore(node, theme), sharedBadges(node, overview, theme));
    else if (node.kind === "external") parts.push(drawExternalCard(node, theme));
    else if (node.kind === "ref") parts.push(drawRef(node, theme, target));
    else if (node.kind === "handoff") parts.push(drawHandoff(node, theme, target));
    else parts.push(drawLaneService(node, theme, laneAccent(theme, node.lane)));
  }
  for (const store of layout.sharedStores) parts.push(drawSharedStore(store, theme));
  parts.push(`<g>${[...layout.links, ...layout.crossLinks].flatMap(labelsOf).map((label) => linkLabel(label, theme)).join("")}</g>`);

  // Decision record (Kubernetes exit path) + platform concerns
  const footTop = layout.bottom + 18;
  const adrW = Math.round((width - 48) * 0.62);
  const adr = layoutAdr(overview.adr, 16, footTop, adrW, theme);
  const platform = layoutPlatform(overview.platform, 32 + adrW, footTop, width - 48 - adrW, theme);
  const footH = Math.max(adr.h, platform.h);
  parts.push(adr.render(footH), platform.render(footH));

  const legendY = footTop + footH + 26;
  parts.push(legendRowOverview(28, legendY, theme));
  const height = legendY + 44;
  parts.push(`<text x="28" y="${height - 12}" class="foot">Generated from docs/architecture/*.json · ${coverage.covered}/${coverage.total} topology nodes mapped · lanes ${workflowMark(0)}–${workflowMark(catalog.sequences.length - 1)} match the UML sequence diagrams</text>`);

  return svgDocument({
    width,
    height,
    title: `${overview.title}: system architecture`,
    desc: overview.description,
    theme,
    body: parts.join("\n"),
  });
}

/* ------------------------------------------------------ UML sequence diagrams */

function resolveParticipants(sequence, topo, externals) {
  return sequence.participants.map((participant) => {
    const node = participant.node ? topo.nodes.get(participant.node) : null;
    let kind = participant.kind;
    if (!kind) {
      if (node?.shape === "actor") kind = node.brands?.length ? "external" : "actor";
      else if (externals.has(participant.node)) kind = "external";
      else kind = "service";
    }
    const nodeBrands = (node?.brands || []).map((entry) => entry.brand || entry);
    return {
      ...participant,
      kind,
      title: participant.title || node?.title || participant.id,
      meta: participant.meta || (kind === "external" ? node?.meta : undefined),
      brand: participant.brand ?? (participant.brands ? undefined : node?.brand),
      brands: participant.brands || (kind === "external" ? nodeBrands : undefined),
      icon: participant.icon || node?.icon,
      stereotype: participant.stereotype ?? { service: "service", external: "external", database: "database", queue: "topic", actor: "" }[kind],
    };
  });
}

function involvedIds(steps, into = new Set()) {
  for (const step of steps || []) {
    if (step.fragment) (step.operands || [{ steps: step.steps }]).forEach((operand) => involvedIds(operand.steps, into));
    else if (step.note || step.ref) (step.over || []).forEach((id) => into.add(id));
    else if (step.self) into.add(step.self);
    else {
      into.add(step.from);
      into.add(step.to);
    }
  }
  return into;
}

function messageKind(step) {
  if (step.self) return "self";
  if (step.reply) return "return";
  if (step.async) return "event";
  return "request";
}

/** Flattened message list (numbering shared by the SVG and the README table). */
function flattenSequence(steps, context = [], list = []) {
  for (const step of steps) {
    if (step.fragment) {
      const operands = step.operands || [{ guard: step.guard, steps: step.steps }];
      for (const operand of operands) flattenSequence(operand.steps, [...context, `${step.fragment} [${operand.guard}]`], list);
    } else if (!step.note && !step.ref) {
      list.push({ step, context, number: list.length + 1 });
    }
  }
  return list;
}

/**
 * Lifeline spacing: every message label must fit between the lifelines it connects, so the gap between
 * neighbours grows with the widest label routed across it (UML tools do the same).
 */
function layoutLifelines(sequence, participants, { left, right, minWidth }) {
  const n = participants.length;
  const position = new Map(participants.map((p, index) => [p.id, index]));
  const gaps = Array(Math.max(0, n - 1)).fill(120);
  const needs = [];
  // Labels must clear both lifelines; the smaller detail line and self-call labels may run past them.
  for (const { step } of flattenSequence(sequence.steps)) {
    const labelW = 21 + textWidth(step.label, 12.5, { bold: true });
    const detailW = step.detail ? textWidth(step.detail, 10.5) : 0;
    if (step.self) {
      const index = position.get(step.self);
      if (index < n - 1) needs.push({ i: index, j: index + 1, need: Math.min(200, 40 + labelW * 0.6) });
      continue;
    }
    const a = position.get(step.from);
    const b = position.get(step.to);
    needs.push({ i: Math.min(a, b), j: Math.max(a, b), need: Math.max(labelW + 28, detailW + 26) });
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const { i, j, need } of needs) {
      const span = gaps.slice(i, j).reduce((sum, gap) => sum + gap, 0);
      if (span >= need) continue;
      const extra = (need - span) / (j - i);
      for (let k = i; k < j; k += 1) gaps[k] += extra;
    }
  }
  const headW = participants.map((_, index) => {
    const around = [gaps[index - 1], gaps[index]].filter((gap) => gap !== undefined);
    return Math.max(100, Math.min(146, Math.min(...around) - 12));
  });
  const columns = new Map();
  let cx = left + Math.max(headW[0] / 2 + 6, 60);
  participants.forEach((p, index) => {
    if (index > 0) cx += gaps[index - 1];
    columns.set(p.id, { p, cx, w: headW[index] + 12 });
  });
  let width = cx + Math.max(headW[n - 1] / 2 + 6, 60) + right;
  if (width < minWidth) {
    const shift = (minWidth - width) / 2;
    for (const column of columns.values()) column.cx += shift;
    width = minWidth;
  }
  columns.width = Math.round(width);
  return columns;
}

function participantHead(p, column, top, headH, theme) {
  const { cx } = column;
  const w = column.w - 14;
  const x = cx - w / 2;
  const titleLines = wrapText(p.title, 12.5, w - 12, { bold: true }).slice(0, 2);
  const title = (y) => titleLines.map((line, index) => `<text x="${round(cx)}" y="${round(y + index * 14)}" text-anchor="middle" class="head-title">${esc(line)}</text>`).join("");
  const stereo = (y, text = p.stereotype) => (text ? `<text x="${round(cx)}" y="${round(y)}" text-anchor="middle" class="stereo">«${esc(text)}»</text>` : "");
  if (p.kind === "actor") {
    return `<g>${stickFigure(cx, top + 2, theme)}${title(top + 59)}</g>`;
  }
  if (p.kind === "queue") {
    const pipeW = Math.min(w, 120);
    return `<g>
      ${pipeShape(round(cx - pipeW / 2), top + 6, round(pipeW), 28, theme, theme.edges.event)}
      ${brandIcon("apachekafka", cx - 9, top + 11, 18, theme.text)}
      <text x="${round(cx)}" y="${top + 51}" text-anchor="middle" class="topic-in" style="font-size:${fitSize(p.title, w, [10.5, 10, 9.5, 9], { mono: true })}px">${esc(p.title)}</text>
      ${p.meta ? `<text x="${round(cx)}" y="${top + 64}" text-anchor="middle" class="head-meta">${esc(p.meta)}</text>` : stereo(top + 64)}
    </g>`;
  }
  if (p.kind === "database") {
    const accent = storeAccent(theme, p.brand);
    const cw = 40;
    return `<g>
      ${dbCylinder(round(cx - cw / 2), top, cw, 42, theme, accent, p.brand, { ry: 6 })}
      <text x="${round(cx)}" y="${top + 56}" text-anchor="middle" class="head-title" style="font-size:${fitSize(p.title, w, [12.5, 12, 11.5, 11], { bold: true })}px">${esc(p.title)}</text>
      ${p.meta ? `<text x="${round(cx)}" y="${top + 68}" text-anchor="middle" class="store-meta" style="font-size:${fitSize(p.meta, w, [8.5, 8, 7.5], { bold: true, tracking: 0.7 })}px">${esc(p.meta)}</text>` : ""}
    </g>`;
  }
  const external = p.kind === "external";
  const accent = theme.accents[p.accent || "slate"];
  const brands = p.brands?.length ? p.brands.slice(0, 2) : p.brand ? [p.brand] : [];
  const icons = brands.length
    ? brands.map((brand, index) => brandIcon(brand, cx - brands.length * 10.5 + index * 21 + 1.5, top + 19, 18, theme.text, p.icon)).join("")
    : genericIcon(p.icon || (external ? "web" : "server"), cx - 9, top + 19, 18, external ? theme.muted : accent);
  return `<g>
    <rect x="${round(x)}" y="${top}" width="${round(w)}" height="${headH}" rx="8" fill="${external ? theme.external : theme.node}" stroke="${external ? theme.externalBorder : theme.border}" stroke-width="1.1" filter="url(#shadow)"/>
    ${external ? "" : `<rect x="${round(x + 0.6)}" y="${top + 0.6}" width="${round(w - 1.2)}" height="3" rx="1.5" fill="${theme.accents.slate}" fill-opacity=".8"/>`}
    ${stereo(top + 15)}
    ${icons}
    ${title(titleLines.length > 1 ? top + 51 : top + 56)}
  </g>`;
}

function renderSequence(sequence, index, topo, externals, theme) {
  const participants = resolveParticipants(sequence, topo, externals);
  const n = participants.length;
  const left = 36;
  const right = 36;
  const columns = layoutLifelines(sequence, participants, { left, right, minWidth: 940 });
  const width = columns.width;
  const parts = [];
  parts.push(`<text x="28" y="42" class="h1" style="font-size:24px">${esc(`${workflowMark(index)}  ${sequence.title}`)}</text>`);
  const summaryLines = wrapText(sequence.summary, 14, width - 56);
  summaryLines.forEach((line, lineIndex) => parts.push(`<text x="28" y="${68 + lineIndex * 19}" class="sub">${esc(line)}</text>`));

  const frameTop = 68 + summaryLines.length * 19 + 10;
  const headTop = frameTop + 38;
  const headH = 70;

  // ---- vertical layout pass
  let y = headTop + headH + 22;
  const rows = [];
  const frames = [];
  const stack = [];
  let number = 0;
  const walk = (steps, depth) => {
    for (const step of steps) {
      if (step.fragment) {
        const frame = { op: step.fragment, depth, top: y, separators: [], ids: involvedIds([step]), rows: [] };
        frames.push(frame);
        stack.push(frame);
        const operands = step.operands || [{ guard: step.guard, steps: step.steps }];
        frame.firstGuard = operands[0].guard;
        y += 30;
        operands.forEach((operand, operandIndex) => {
          if (operandIndex > 0) {
            frame.separators.push({ y: y + 2, guard: operand.guard });
            y += 26;
          }
          walk(operand.steps, depth + 1);
        });
        y += 8;
        frame.bottom = y;
        stack.pop();
        y += 10;
        continue;
      }
      let row;
      if (step.note) {
        const ids = step.over || [];
        const xs = ids.map((id) => columns.get(id).cx);
        const x1 = Math.min(...xs) - 54;
        const x2 = Math.max(...xs) + 54;
        const lines = wrapText(step.note, 11.5, x2 - x1 - 26);
        const h = 16 + lines.length * 15.5;
        row = { type: "note", top: y + 2, x1, x2, h, lines };
        y += h + 14;
      } else if (step.ref) {
        // UML interaction use: "ref" frame pointing at another sequence diagram.
        const cols = (step.over || []).map((id) => columns.get(id));
        const x1 = Math.min(...cols.map((column) => column.cx - column.w / 2)) + 2;
        const x2 = Math.max(...cols.map((column) => column.cx + column.w / 2)) - 2;
        const textW = textWidth(step.ref, 12, { bold: true }) + 70;
        const mid = (x1 + x2) / 2;
        let refX1 = Math.min(x1, mid - textW / 2);
        let refX2 = Math.max(x2, mid + textW / 2);
        const overflow = refX2 - (width - 40);
        if (overflow > 0) {
          refX1 -= overflow;
          refX2 -= overflow;
        }
        row = { type: "ref", top: y + 4, x1: refX1, x2: refX2, h: 34, text: step.ref };
        y += 34 + 16;
      } else if (step.self) {
        number += 1;
        row = { type: "self", step, number, y: y + 18, id: step.self };
        y += step.detail ? 50 : 44;
      } else {
        number += 1;
        row = { type: "message", step, number, y: y + 22, kind: messageKind(step) };
        y += step.detail ? 48 : 38;
      }
      rows.push(row);
      stack.forEach((frame) => frame.rows.push(row));
    }
  };
  walk(sequence.steps, 0);
  const lifelineEnd = y + 6;

  // ---- activation bars (execution specifications)
  const events = new Map(participants.map((p) => [p.id, []]));
  for (const row of rows) {
    if (row.type === "self") events.get(row.id).push({ y: row.y, type: "self", end: row.y + 18 });
    if (row.type !== "message") continue;
    const { step, kind } = row;
    events.get(step.from).push({ y: row.y, type: kind === "return" ? "send-reply" : "send" });
    events.get(step.to).push({ y: row.y, type: kind === "return" ? "recv-reply" : kind === "event" ? "recv-async" : "recv" });
  }
  const intervals = new Map();
  for (const p of participants) {
    if (p.kind === "actor" || p.kind === "queue") {
      intervals.set(p.id, []);
      continue;
    }
    const maxGap = p.kind === "database" ? 70 : 150;
    const list = [];
    let open = null;
    for (const event of events.get(p.id)) {
      const endY = event.end ?? event.y;
      if (open && event.type.startsWith("recv") && event.type !== "recv-reply" && event.y - open.to > maxGap) {
        list.push(open);
        open = null;
      }
      if (!open) open = { from: event.y, to: endY };
      open.to = Math.max(open.to, endY);
      if (event.type === "send-reply") {
        list.push(open);
        open = null;
      }
    }
    if (open) list.push(open);
    intervals.set(p.id, list.map((interval) => ({ from: interval.from - 8, to: Math.max(interval.to + 8, interval.from + 14) })));
  }
  const activeAt = (id, atY) => (intervals.get(id) || []).some((interval) => atY >= interval.from - 0.5 && atY <= interval.to + 0.5);
  const edgeX = (id, towardsX, atY) => {
    const { cx } = columns.get(id);
    if (!activeAt(id, atY)) return cx;
    return cx + (towardsX >= cx ? 5 : -5);
  };

  // ---- draw
  const back = [];
  const knockouts = [];
  const bars = [];
  const arrows = [];
  const texts = [];
  const front = [];

  for (const column of columns.values()) {
    back.push(`<line x1="${round(column.cx)}" y1="${headTop + headH}" x2="${round(column.cx)}" y2="${round(lifelineEnd)}" stroke="${theme.lifeline}" stroke-width="1.3"/>`);
    front.push(participantHead(column.p, column, headTop, headH, theme));
  }
  for (const [id, list] of intervals) {
    const { cx } = columns.get(id);
    for (const interval of list) {
      bars.push(`<rect x="${round(cx - 5)}" y="${round(interval.from)}" width="10" height="${round(interval.to - interval.from)}" fill="${theme.node}" stroke="${theme.muted}" stroke-width="1.1"/>`);
    }
  }

  const badge = (num, x, baseline, color) => `<circle cx="${round(x + 8)}" cy="${round(baseline - 4.2)}" r="8" fill="${color}"/><text x="${round(x + 8)}" y="${round(baseline - 0.8)}" text-anchor="middle" class="seq-num">${num}</text>`;
  const labelExtents = new Map();
  for (const row of rows) {
    if (row.type === "ref") {
      const tagW = 38;
      front.push(`<rect x="${round(row.x1)}" y="${round(row.top)}" width="${round(row.x2 - row.x1)}" height="${row.h}" rx="3" fill="${theme.node}" stroke="${theme.muted}" stroke-width="1.2"/>`);
      front.push(`<path d="M ${round(row.x1)} ${round(row.top)} H ${round(row.x1 + tagW)} V ${round(row.top + 12)} L ${round(row.x1 + tagW - 8)} ${round(row.top + 19)} H ${round(row.x1)} Z" fill="${theme.external}" stroke="${theme.muted}" stroke-width="1.2"/>`);
      front.push(`<text x="${round(row.x1 + 8)}" y="${round(row.top + 13.5)}" class="frag-op" style="fill:${theme.muted}">ref</text>`);
      front.push(`<text x="${round((row.x1 + row.x2) / 2 + 12)}" y="${round(row.top + 22)}" text-anchor="middle" class="msg">${esc(row.text)}</text>`);
      continue;
    }
    if (row.type === "note") {
      front.push(noteShape(row.x1, row.top, row.x2 - row.x1, row.h, theme));
      row.lines.forEach((line, lineIndex) => front.push(`<text x="${round(row.x1 + 12)}" y="${round(row.top + 19 + lineIndex * 15.5)}" class="note">${esc(line)}</text>`));
      continue;
    }
    if (row.type === "self") {
      const { cx } = columns.get(row.id);
      const x0 = cx + 5;
      const loop = [{ x: x0, y: row.y - 7 }, { x: x0 + 26, y: row.y - 7 }, { x: x0 + 26, y: row.y + 11 }, { x: x0 + 10, y: row.y + 11 }];
      bars.push(`<rect x="${round(cx)}" y="${round(row.y + 4)}" width="10" height="16" fill="${theme.node}" stroke="${theme.muted}" stroke-width="1.1"/>`);
      arrows.push(connector(loop, "request", theme, { extraWidth: 0.1 }));
      const labelX = x0 + 34;
      const labelW = 20 + textWidth(row.step.label, 12.5, { bold: true });
      const detailW = row.step.detail ? textWidth(row.step.detail, 10.5) : 0;
      knockouts.push(`<rect x="${round(labelX - 3)}" y="${round(row.y - 15)}" width="${round(labelW + 6)}" height="17" rx="3" fill="${theme.canvas}"/>`);
      texts.push(badge(row.number, labelX, row.y - 2, theme.edges.request));
      texts.push(`<text x="${round(labelX + 21)}" y="${round(row.y - 2)}" class="msg">${esc(row.step.label)}</text>`);
      if (row.step.detail) {
        knockouts.push(`<rect x="${round(labelX + 18)}" y="${round(row.y + 4)}" width="${round(detailW + 6)}" height="14" rx="3" fill="${theme.canvas}"/>`);
        texts.push(`<text x="${round(labelX + 21)}" y="${round(row.y + 14.5)}" class="msg-detail">${esc(row.step.detail)}</text>`);
      }
      labelExtents.set(row, { right: labelX + Math.max(labelW, 21 + detailW) + 6, left: cx - 8 });
      continue;
    }
    const { step, kind } = row;
    const from = columns.get(step.from);
    const to = columns.get(step.to);
    const start = { x: edgeX(step.from, to.cx, row.y), y: row.y };
    const end = { x: edgeX(step.to, from.cx, row.y), y: row.y };
    arrows.push(connector([start, end], kind, theme, { extraWidth: 0.2 }));
    const midX = (from.cx + to.cx) / 2;
    const labelW = 21 + textWidth(step.label, 12.5, { bold: true });
    const labelX = Math.min(width - right - labelW, Math.max(Math.min(from.cx, to.cx) + 12, midX - labelW / 2));
    const color = kind === "event" ? theme.edges.event : kind === "return" ? theme.edges.return : theme.edges.request;
    knockouts.push(`<rect x="${round(labelX - 3)}" y="${round(row.y - 22)}" width="${round(labelW + 6)}" height="17" rx="3" fill="${theme.canvas}"/>`);
    texts.push(badge(row.number, labelX, row.y - 9, color));
    texts.push(`<text x="${round(labelX + 21)}" y="${round(row.y - 9)}" class="msg"${kind === "return" ? ` style="fill:${theme.muted}"` : ""}>${esc(step.label)}</text>`);
    let extentRight = labelX + labelW;
    if (step.detail) {
      const detailW = textWidth(step.detail, 10.5);
      const detailX = Math.min(width - 40 - detailW / 2, Math.max(Math.min(from.cx, to.cx) + 11 + detailW / 2, midX));
      knockouts.push(`<rect x="${round(detailX - detailW / 2 - 3)}" y="${round(row.y + 4)}" width="${round(detailW + 6)}" height="14" rx="3" fill="${theme.canvas}"/>`);
      texts.push(`<text x="${round(detailX)}" y="${round(row.y + 14.5)}" text-anchor="middle" class="msg-detail">${esc(step.detail)}</text>`);
      extentRight = Math.max(extentRight, detailX + detailW / 2);
    }
    labelExtents.set(row, { right: extentRight, left: Math.min(labelX, Math.min(from.cx, to.cx)) });
  }

  // ---- combined fragments
  const frameLeft = 20;
  const frameRight = width - 20;
  const fragments = [];
  for (const frame of frames) {
    const meta = FRAGMENTS[frame.op];
    const accent = theme.accents[meta.accent];
    const cols = [...frame.ids].map((id) => columns.get(id));
    const inset = frame.depth * 7;
    let x1 = Math.min(...cols.map((column) => column.cx - column.w / 2)) + 6 + inset;
    let x2 = Math.max(...cols.map((column) => column.cx + column.w / 2)) - 6 - inset;
    for (const row of frame.rows) {
      const extent = labelExtents.get(row);
      if (extent) x2 = Math.max(x2, extent.right + 10 - inset);
      if (row.type === "note" || row.type === "ref") {
        x1 = Math.min(x1, row.x1 - 8);
        x2 = Math.max(x2, row.x2 + 8);
      }
    }
    const opW = textWidth(frame.op, 11, { bold: true, tracking: 0.4 }) + 22;
    const guardText = frame.firstGuard ? `[${frame.firstGuard}]` : "";
    x2 = Math.max(x2, x1 + opW + textWidth(guardText, 11, { bold: true }) + 24);
    x1 = Math.max(frameLeft + 8 + inset, x1);
    x2 = Math.min(frameRight - 8 - inset, x2);
    fragments.push(`<rect x="${round(x1)}" y="${round(frame.top)}" width="${round(x2 - x1)}" height="${round(frame.bottom - frame.top)}" rx="3" fill="${accent}" fill-opacity="${tintOpacity(theme, 0.18)}" stroke="${accent}" stroke-opacity=".75" stroke-width="1.2"/>`);
    front.push(`<path d="M ${round(x1)} ${round(frame.top)} H ${round(x1 + opW)} V ${round(frame.top + 13)} L ${round(x1 + opW - 8)} ${round(frame.top + 20)} H ${round(x1)} Z" fill="${theme.canvas}"/>`);
    front.push(`<path d="M ${round(x1)} ${round(frame.top)} H ${round(x1 + opW)} V ${round(frame.top + 13)} L ${round(x1 + opW - 8)} ${round(frame.top + 20)} H ${round(x1)} Z" fill="${accent}" fill-opacity="${tintOpacity(theme, 1.3)}" stroke="${accent}" stroke-opacity=".75" stroke-width="1.2"/>`);
    front.push(`<text x="${round(x1 + 8)}" y="${round(frame.top + 14)}" class="frag-op" style="fill:${accent}">${esc(frame.op)}</text>`);
    if (guardText) {
      const gw = textWidth(guardText, 11, { bold: true }) + 8;
      front.push(`<rect x="${round(x1 + opW + 6)}" y="${round(frame.top + 3)}" width="${round(gw)}" height="15" rx="3" fill="${theme.canvas}"/>`);
      front.push(`<text x="${round(x1 + opW + 10)}" y="${round(frame.top + 14.5)}" class="frag-guard">${esc(guardText)}</text>`);
    }
    for (const separator of frame.separators) {
      fragments.push(`<line x1="${round(x1)}" y1="${round(separator.y)}" x2="${round(x2)}" y2="${round(separator.y)}" stroke="${accent}" stroke-opacity=".75" stroke-width="1.1" stroke-dasharray="6 4"/>`);
      const text = `[${separator.guard}]`;
      const gw = textWidth(text, 11, { bold: true }) + 8;
      front.push(`<rect x="${round(x1 + 6)}" y="${round(separator.y + 5)}" width="${round(gw)}" height="15" rx="3" fill="${theme.canvas}"/>`);
      front.push(`<text x="${round(x1 + 10)}" y="${round(separator.y + 16.5)}" class="frag-guard">${esc(text)}</text>`);
    }
  }

  // UML frame: "sd <name>" pentagon tag around the whole interaction.
  const frameBottom = lifelineEnd + 14;
  const sdText = `sd ${sequence.title}`;
  const tagW = textWidth(sdText, 13, { bold: true }) + 28;
  parts.push(`<rect x="${frameLeft}" y="${frameTop}" width="${frameRight - frameLeft}" height="${round(frameBottom - frameTop)}" rx="2" fill="none" stroke="${theme.muted}" stroke-width="1.2"/>`);
  parts.push(`<path d="M ${frameLeft} ${frameTop} H ${round(frameLeft + tagW)} V ${frameTop + 16} L ${round(frameLeft + tagW - 10)} ${frameTop + 26} H ${frameLeft} Z" fill="${theme.external}" stroke="${theme.muted}" stroke-width="1.2"/>`);
  parts.push(`<text x="${frameLeft + 10}" y="${frameTop + 18}" class="frame">${esc(sdText)}</text>`);
  parts.push(...fragments, ...back, ...knockouts, ...bars, ...arrows, ...texts, ...front);

  // Result + legend
  const resultY = frameBottom + 30;
  const resultText = `Result: ${sequence.result}`;
  const resultW = textWidth(resultText, 13, { bold: true }) + 46;
  parts.push(`<rect x="28" y="${round(resultY - 16)}" width="${round(resultW)}" height="32" rx="16" fill="${theme.accents.green}" fill-opacity="${tintOpacity(theme, 0.75)}" stroke="${theme.accents.green}" stroke-opacity=".45"/>`);
  parts.push(genericIcon("check", 38, resultY - 9, 18, theme.accents.green));
  parts.push(`<text x="62" y="${round(resultY + 4.5)}" class="chip" style="font-size:13px">${esc(resultText)}</text>`);

  const legendY = resultY + 42;
  let cursor = 28;
  for (const [kind, text] of [["request", "Synchronous call"], ["event", "Asynchronous message"], ["return", "Reply"]]) {
    const style = EDGE_STYLE[kind];
    parts.push(`<line x1="${cursor}" y1="${legendY}" x2="${cursor + 30}" y2="${legendY}" stroke="${theme.edges[kind]}" stroke-width="${style.width + 0.2}" ${style.dash ? `stroke-dasharray="${style.dash}"` : ""} marker-end="url(#arrow-${kind})"/>`);
    parts.push(`<text x="${cursor + 38}" y="${legendY + 4}" class="legend" style="font-size:11px">${text}</text>`);
    cursor += 38 + textWidth(text, 11, { bold: true }) + 22;
  }
  parts.push(`<rect x="${cursor}" y="${legendY - 8}" width="10" height="16" fill="${theme.node}" stroke="${theme.muted}" stroke-width="1.1"/>`);
  parts.push(`<text x="${cursor + 18}" y="${legendY + 4}" class="legend" style="font-size:11px">Execution</text>`);
  cursor += 18 + textWidth("Execution", 11, { bold: true }) + 22;
  const used = [...new Set(frames.map((frame) => frame.op))].sort((a, b) => Object.keys(FRAGMENTS).indexOf(a) - Object.keys(FRAGMENTS).indexOf(b));
  for (const op of used) {
    const accent = theme.accents[FRAGMENTS[op].accent];
    const text = `${op} = ${FRAGMENTS[op].meaning}`;
    const w = textWidth(text, 11, { bold: true }) + 16;
    if (cursor + w > width - 24) break;
    parts.push(`<rect x="${round(cursor)}" y="${legendY - 9}" width="${round(w)}" height="18" rx="3" fill="${accent}" fill-opacity="${tintOpacity(theme, 0.8)}" stroke="${accent}" stroke-opacity=".6"/>`);
    parts.push(`<text x="${round(cursor + 8)}" y="${legendY + 4}" class="legend" style="font-size:11px;fill:${accent}">${esc(text)}</text>`);
    cursor += w + 8;
  }

  const height = Math.round(legendY + 26);
  const messages = flattenSequence(sequence.steps);
  const desc = `UML sequence diagram. ${sequence.summary} Messages: ${messages.map(({ step, number }) => `${number}. ${step.label}`).join("; ")}.`;
  return svgDocument({ width, height, title: `Workflow: ${sequence.title}`, desc, theme, body: parts.join("\n") });
}

/* ------------------------------------------------------------------- README */

function picture(base, alt, indent = "  ") {
  return [
    `${indent}<picture>`,
    `${indent}  <source media="(prefers-color-scheme: dark)" srcset="${OUT_URL}/${base}-dark.svg">`,
    `${indent}  <img src="${OUT_URL}/${base}.svg" alt="${esc(alt)}" width="100%" />`,
    `${indent}</picture>`,
  ].join("\n");
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

const KIND_LABEL = { request: "sync", event: "async", return: "reply", self: "self" };

function renderReadmeBlock(catalog, topo, externals) {
  const lines = [];
  lines.push(README_START);
  lines.push("<!-- Generated by scripts/render-architecture-views.mjs. Edit the JSON sources in docs/architecture/, then run `npm run docs:architecture`. -->");
  lines.push("");
  lines.push(`<p align="center">\n  <a href="${OUT_URL}/overview.svg">\n${picture("overview", "Portfolio platform system architecture: a map of how Ask AI, content publishing, notifications, visitor analytics and the MCP tools connect, then one lane per system from the Next.js UI and its Vercel API routes to Cloud Run services, their data stores and Kafka topics, plus the Kubernetes exit path (ADR-001)", "    ")}\n  </a>\n</p>`);
  lines.push("");
  lines.push(`<p align="center"><a href="${SITE_URL}/architecture"><b>Interactive explorer</b></a> · <a href="${OUT_URL}/overview.svg">Full-size architecture</a> · <a href="docs/architecture/platform-system-flow.svg">Detailed service topology</a></p>`);
  lines.push("");
  lines.push("### Data flows");
  lines.push("");
  lines.push("Each workflow is a UML 2 sequence diagram with combined fragments for the paths that matter in production: rate-limit exits (`break`), degraded modes (`alt`), atomic writes (`critical`), retries and batches (`loop`) and fan-out (`par`).");
  lines.push("");
  lines.push("| | Workflow | What it shows | Outcome |");
  lines.push("| :-: | --- | --- | --- |");
  catalog.sequences.forEach((sequence, index) => {
    lines.push(`| ${workflowMark(index)} | [${markdownCell(sequence.title)}](#workflow-${sequence.key}) | ${markdownCell(sequence.summary)} | ${markdownCell(sequence.result)} |`);
  });
  lines.push("");
  catalog.sequences.forEach((sequence, index) => {
    const participants = new Map(resolveParticipants(sequence, topo, externals).map((p) => [p.id, p]));
    const name = (id) => participants.get(id)?.title || id;
    lines.push(`<a name="workflow-${sequence.key}"></a>`);
    lines.push(`<details>\n<summary><b>${workflowMark(index)} ${esc(sequence.title)}</b> — ${esc(sequence.summary)}</summary>`);
    lines.push("");
    lines.push(`<p align="center">\n${picture(`flow-${sequence.key}`, `${sequence.title}: UML sequence diagram`)}\n</p>`);
    lines.push("");
    lines.push("| # | From → To | Message | Type | Guard |");
    lines.push("| :-: | --- | --- | :-: | --- |");
    for (const { step, context, number } of flattenSequence(sequence.steps)) {
      const hop = step.self ? `${name(step.self)} (self)` : `${name(step.from)} → ${name(step.to)}`;
      const message = step.detail ? `**${markdownCell(step.label)}**<br><sub>${markdownCell(step.detail)}</sub>` : `**${markdownCell(step.label)}**`;
      lines.push(`| ${number} | ${markdownCell(hop)} | ${message} | ${KIND_LABEL[messageKind(step)]} | ${markdownCell(context.join(" › "))} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  });
  lines.push("<details>\n<summary><b>Detailed service topology</b> — every service, topic and state store</summary>");
  lines.push("");
  lines.push(`<p align="center">\n  <a href="docs/architecture/platform-system-flow.svg">\n    <img src="docs/architecture/platform-system-flow.svg" alt="Detailed service topology, event streams and state stores" width="100%" />\n  </a>\n</p>`);
  lines.push("");
  lines.push("</details>");
  lines.push("");
  lines.push("> **Maintain these diagrams:** edit the JSON sources in [`docs/architecture/`](docs/architecture/) — topology in `platform-system-flow.json`, system overview in `platform-overview.json`, sequence diagrams in `platform-sequences.json` — then run `npm run docs:architecture`. `npm run docs:architecture:check` fails when a service is missing from the overview, a message references an unknown participant, or the generated files are stale.");
  lines.push(README_END);
  return lines.join("\n");
}

function updateReadme(current, block) {
  const start = current.indexOf(README_START);
  const end = current.indexOf(README_END);
  if (start !== -1 && end !== -1) {
    return current.slice(0, start) + block + current.slice(end + README_END.length);
  }
  // First run: replace the content of the "## Architecture" section.
  const heading = current.indexOf("## Architecture");
  if (heading === -1) throw new Error("README.md has no '## Architecture' section or architecture markers");
  const bodyStart = current.indexOf("\n", heading) + 1;
  const nextRule = current.indexOf("\n---", bodyStart);
  if (nextRule === -1) throw new Error("Could not find the end of the '## Architecture' section");
  return `${current.slice(0, bodyStart)}\n${block}\n${current.slice(nextRule)}`;
}

/* --------------------------------------------------------------------- main */

function main() {
  const check = process.argv.includes("--check");
  const topology = readJson(SOURCES.topology);
  const overview = readJson(SOURCES.overview);
  const catalog = readJson(SOURCES.sequences);
  const topo = indexTopology(topology);

  const problems = [];
  const warnings = [];
  const owner = validateOverview(overview, topo, catalog, problems);
  // Port and layout checks resolve link endpoints, so they only run on an otherwise valid overview.
  if (!problems.length) validateKafkaPorts(overview, problems);
  validateSequences(catalog, topo, problems, warnings);
  if (!problems.length) overlapWarnings(overview, warnings);
  warnings.forEach((warning) => console.warn(`warn  ${warning}`));
  if (problems.length) {
    problems.forEach((problem) => console.error(`error ${problem}`));
    process.exit(1);
  }

  const externals = new Set(overviewNodes(overview).filter((node) => node.kind === "external").flatMap((node) => node.covers || []));
  const coverage = { covered: owner.size, total: topo.nodes.size };
  const outputs = new Map();
  for (const theme of Object.values(THEMES)) {
    const suffix = theme.name === "dark" ? "-dark" : "";
    outputs.set(path.join(OUT_DIR, `overview${suffix}.svg`), renderOverview(overview, catalog, coverage, theme));
    catalog.sequences.forEach((sequence, index) => {
      outputs.set(path.join(OUT_DIR, `flow-${sequence.key}${suffix}.svg`), renderSequence(sequence, index, topo, externals, theme));
    });
  }
  const readme = fs.readFileSync(README_PATH, "utf8");
  outputs.set(README_PATH, updateReadme(readme, renderReadmeBlock(catalog, topo, externals)));

  const expected = new Set([...outputs.keys()].filter((file) => file.startsWith(OUT_DIR)));
  const orphans = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).map((name) => path.join(OUT_DIR, name)).filter((file) => file.endsWith(".svg") && !expected.has(file))
    : [];

  if (check) {
    const stale = [...outputs.entries()]
      .filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content)
      .map(([file]) => path.relative(ROOT, file));
    stale.push(...orphans.map((file) => `${path.relative(ROOT, file)} (orphan)`));
    if (stale.length) {
      console.error(`Architecture views are stale. Run \`npm run docs:architecture\`.\n  ${stale.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`Architecture views are up to date (${coverage.covered}/${coverage.total} topology nodes, ${catalog.sequences.length} sequence diagrams).`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, content] of outputs) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
      fs.writeFileSync(file, content);
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
  }
  for (const file of orphans) console.warn(`warn  ${path.relative(ROOT, file)} is no longer generated; delete it`);
}

main();
