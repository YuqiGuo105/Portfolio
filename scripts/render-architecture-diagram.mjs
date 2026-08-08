#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const LIGHT_ACCENTS = {
  blue: { strong: "#1769aa", soft: "#f3f8fc" },
  green: { strong: "#14805e", soft: "#f2faf6" },
  orange: { strong: "#b56b13", soft: "#fff9f0" },
  purple: { strong: "#7255a5", soft: "#f8f5fb" },
  red: { strong: "#ba4a52", soft: "#fdf5f5" },
  cyan: { strong: "#087f95", soft: "#f1fafb" },
  slate: { strong: "#435363", soft: "#f7f9fa" },
};

const DARK_ACCENTS = {
  blue: { strong: "#60a5fa", soft: "#111d2d" },
  green: { strong: "#5eead4", soft: "#102521" },
  orange: { strong: "#fbbf6a", soft: "#2a2013" },
  purple: { strong: "#c4b5fd", soft: "#201b31" },
  red: { strong: "#fb7185", soft: "#2b171d" },
  cyan: { strong: "#67e8f9", soft: "#10242a" },
  slate: { strong: "#94a3b8", soft: "#151c24" },
};

const LIGHT_EDGE_STYLES = {
  primary: { color: "#24313c", width: 2, dash: "", marker: "arrow-primary" },
  sync: { color: "#657482", width: 1.65, dash: "", marker: "arrow-sync" },
  data: { color: "#1778a8", width: 1.7, dash: "", marker: "arrow-data" },
  event: { color: "#7356a6", width: 1.8, dash: "7 6", marker: "arrow-event" },
  recovery: { color: "#b84b53", width: 1.7, dash: "3 6", marker: "arrow-recovery" },
  return: { color: "#16805e", width: 1.6, dash: "4 5", marker: "arrow-return" },
};

const DARK_EDGE_STYLES = {
  primary: { color: "#d5dee7", width: 2, dash: "", marker: "arrow-primary" },
  sync: { color: "#778794", width: 1.65, dash: "", marker: "arrow-sync" },
  data: { color: "#38bdf8", width: 1.7, dash: "", marker: "arrow-data" },
  event: { color: "#a78bfa", width: 1.8, dash: "7 6", marker: "arrow-event" },
  recovery: { color: "#fb7185", width: 1.7, dash: "3 6", marker: "arrow-recovery" },
  return: { color: "#5eead4", width: 1.6, dash: "4 5", marker: "arrow-return" },
};

const PALETTES = {
  light: {
    canvas: "#ffffff",
    header: "#ffffff",
    node: "#ffffff",
    nodeStrong: "#ffffff",
    border: "#596873",
    softBorder: "#cbd4da",
    gridSmall: "#d9e0e5",
    gridLarge: "#c4ced5",
    text: "#17212a",
    muted: "#5f6f7a",
    faint: "#7b8891",
    labelBg: "#ffffff",
    shadow: "#1f2d38",
  },
  dark: {
    canvas: "#0b1015",
    header: "#0d1319",
    node: "#111920",
    nodeStrong: "#151e26",
    border: "#52616d",
    softBorder: "#33404a",
    gridSmall: "#24303a",
    gridLarge: "#34414b",
    text: "#e8edf2",
    muted: "#a2aeb8",
    faint: "#75838e",
    labelBg: "#0d141a",
    shadow: "#000000",
  },
};

let ACTIVE_ACCENTS = LIGHT_ACCENTS;
let ACTIVE_EDGE_STYLES = LIGHT_EDGE_STYLES;
let PALETTE = PALETTES.light;

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function lines(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function materializeNodes(config) {
  const lanes = new Map((config.lanes || []).map((lane) => [lane.id || lane.title, lane]));
  const rows = new Map((config.rows || []).map((row) => [row.id, row]));

  return config.nodes.map((node) => {
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
      return node;
    }

    const lane = lanes.get(node.lane);
    const row = rows.get(node.row);
    if (!lane || !row) {
      throw new Error(`Node ${node.id} requires a valid lane and row`);
    }

    const padding = lane.padding ?? 16;
    const gap = lane.columnGap ?? 12;
    const columns = lane.columns ?? 1;
    const column = node.column ?? 0;
    const columnSpan = node.columnSpan ?? 1;
    if (column < 0 || column + columnSpan > columns) {
      throw new Error(`Node ${node.id} exceeds the ${lane.id || lane.title} lane grid`);
    }

    const usableWidth = lane.w - padding * 2 - gap * (columns - 1);
    const columnWidth = usableWidth / columns;
    const width = node.w ?? columnWidth * columnSpan + gap * (columnSpan - 1);
    const height = node.h ?? Math.max(80, row.h - 24);

    return {
      ...node,
      x: lane.x + padding + column * (columnWidth + gap) + (node.offsetX ?? 0),
      y: row.y + (row.h - height) / 2 + (node.offsetY ?? 0),
      w: width,
      h: height,
    };
  });
}

function validateDiagram(config, nodes) {
  const ids = new Set();
  for (const node of nodes) {
    if (!node.id) throw new Error("Every node requires an id");
    if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    ids.add(node.id);

    const { x, y, w, h } = nodeBounds(node);
    if (x < 0 || y < 0 || x + w > config.width || y + h > config.height) {
      throw new Error(`Node ${node.id} exceeds the ${config.width}x${config.height} canvas`);
    }
  }

  for (const edge of config.edges || []) {
    if (!ids.has(edge.from)) throw new Error(`Edge references unknown source node: ${edge.from}`);
    if (!ids.has(edge.to)) throw new Error(`Edge references unknown target node: ${edge.to}`);
  }

  if (!config.validateNoOverlap) return;
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodeBounds(nodes[leftIndex]);
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodeBounds(nodes[rightIndex]);
      const overlaps = left.x < right.x + right.w
        && left.x + left.w > right.x
        && left.y < right.y + right.h
        && left.y + left.h > right.y;
      if (overlaps) {
        throw new Error(`Nodes overlap: ${nodes[leftIndex].id} and ${nodes[rightIndex].id}`);
      }
    }
  }
}

function genericIcon(name, x, y, size, color) {
  const scale = size / 24;
  const icons = {
    user: `<circle cx="12" cy="7" r="4"/><path d="M4.5 21c.8-5 3.3-7 7.5-7s6.7 2 7.5 7"/>`,
    users: `<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.8"/><path d="M2.5 21c.7-4.5 2.8-6.5 6.5-6.5s5.8 2 6.5 6.5"/><path d="M14.5 15.5c3.9-.5 6.2 1.3 7 5.5"/>`,
    web: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.3 4.2 6.3 4.2 9S15 17.7 12 21M12 3C9 6.3 7.8 9.3 7.8 12S9 17.7 12 21"/>`,
    monitor: `<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4"/>`,
    api: `<path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h7"/>`,
    shield: `<path d="M12 3l8 3v5c0 5.2-3 8.4-8 10-5-1.6-8-4.8-8-10V6z"/><path d="M8.5 12l2.2 2.2 4.8-5"/>`,
    bot: `<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M12 3v3M9 3h6M8 12h.01M16 12h.01M8.5 16h7"/>`,
    server: `<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>`,
    queue: `<circle cx="5" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 6h4.2a3 3 0 013 3v.5M7.5 18h4.2a3 3 0 003-3v-.5M14.5 12H9"/>`,
    database: `<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>`,
    cache: `<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>`,
    search: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>`,
    mail: `<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M4 7l8 6 8-6"/>`,
    bell: `<path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/>`,
    chart: `<path d="M4 20V9M10 20V4M16 20v-7M22 20H2"/>`,
    workflow: `<rect x="3" y="3" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/><path d="M9 6h4a4 4 0 014 4v5M15 18h-4a4 4 0 01-4-4V9"/>`,
    tool: `<path d="M14.7 6.3a4 4 0 01-5 5L4 17l3 3 5.7-5.7a4 4 0 005-5l-2.5 2.5-3-3z"/>`,
    model: `<path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5zM18.5 15l.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8z"/>`,
    memory: `<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>`,
    clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`,
    file: `<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>`,
    lock: `<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V7a4 4 0 018 0v3M12 14v3"/>`,
    cloud: `<path d="M6 19h12a4 4 0 00.5-8A7 7 0 005 9.5 4.5 4.5 0 006 19z"/>`,
    code: `<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>`,
    compass: `<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`,
    retry: `<path d="M20 6v6h-6M4 18v-6h6"/><path d="M6.5 8a7 7 0 0111.8-1.7L20 8M4 16l1.7 1.7A7 7 0 0017.5 16"/>`,
  };
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.server}</g>`;
}

function brandIcon(node, x, y, size, accent, configDir) {
  if (!node.brand) {
    return genericIcon(node.icon || "server", x, y, size, accent.strong);
  }

  const iconPath = path.join(configDir, "icons", `${node.brand}.svg`);
  if (!fs.existsSync(iconPath)) {
    return genericIcon(node.icon || "server", x, y, size, accent.strong);
  }

  const source = fs.readFileSync(iconPath, "utf8");
  const viewBox = source.match(/viewBox=["']([^"']+)["']/)?.[1]
    ?.trim()
    .split(/\s+/)
    .map(Number);
  const [minX, minY, viewBoxWidth, viewBoxHeight] = viewBox?.length === 4
    ? viewBox
    : [0, 0, 24, 24];
  const iconScale = size / Math.max(viewBoxWidth, viewBoxHeight);
  const offsetX = (size - viewBoxWidth * iconScale) / 2 - minX * iconScale;
  const offsetY = (size - viewBoxHeight * iconScale) / 2 - minY * iconScale;
  const body = source
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>[\s\S]*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "");
  const renderedBody = node.brandColorMode === "source"
    ? body
    : body.replace(/<path\b/g, `<path fill="${node.brandColor || accent.strong}"`);
  return `<g transform="translate(${x + offsetX} ${y + offsetY}) scale(${iconScale})">${renderedBody}</g>`;
}

function nodeBounds(node) {
  return { x: node.x, y: node.y, w: node.w || 220, h: node.h || 112 };
}

function port(node, side = "right") {
  const { x, y, w, h } = nodeBounds(node);
  const visualHeight = node.shape === "queue" && node.metaBelow
    ? Math.min(node.tubeHeight ?? 56, h)
    : h;
  if (side === "left") return { x, y: y + visualHeight / 2 };
  if (side === "top") return { x: x + w / 2, y };
  if (side === "bottom") return { x: x + w / 2, y: y + visualHeight };
  return { x: x + w, y: y + visualHeight / 2 };
}

function smoothPath(points) {
  if (points.length < 2) return "";
  if (points.length === 2) {
    const [start, end] = points;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return `M ${start.x} ${start.y} C ${start.x + dx * 0.42} ${start.y}, ${end.x - dx * 0.42} ${end.y}, ${end.x} ${end.y}`;
    }
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + dy * 0.42}, ${end.x} ${end.y - dy * 0.42}, ${end.x} ${end.y}`;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] || points[index];
    const current = points[index];
    const next = points[index + 1];
    const following = points[index + 2] || next;
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (following.x - current.x) / 6,
      y: next.y - (following.y - current.y) / 6,
    };
    commands.push(`C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${next.x} ${next.y}`);
  }
  return commands.join(" ");
}

function edgePath(edge, byId) {
  const start = edge.fromAt || port(byId.get(edge.from), edge.fromSide || "right");
  const end = edge.toAt || port(byId.get(edge.to), edge.toSide || "left");
  const points = [start, ...(edge.via || []), end];
  return {
    d: edge.routing === "smooth"
      ? smoothPath(points)
      : points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
    points,
  };
}

function edgeLabel(edge, pathData) {
  if (!edge.label) return "";
  const point = edge.labelAt || pathData.points
    .slice(0, -1)
    .map((start, index) => {
      const end = pathData.points[index + 1];
      return {
        length: Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
    })
    .sort((a, b) => b.length - a.length)[0];
  const width = Math.max(58, String(edge.label).length * 6.2 + 14);
  return `<g transform="translate(${point.x - width / 2} ${point.y - 10})">
    <rect width="${width}" height="20" rx="3" fill="${PALETTE.labelBg}" fill-opacity=".96"
      stroke="${PALETTE.softBorder}" stroke-opacity=".45"/>
    <text x="${width / 2}" y="14" text-anchor="middle" class="edge-label">${escapeXml(edge.label)}</text>
  </g>`;
}

function drawLane(lane) {
  const accent = ACTIVE_ACCENTS[lane.accent || "slate"];
  const fillOpacity = lane.fillOpacity ?? 0.2;
  const strokeOpacity = lane.strokeOpacity ?? 0.68;
  const strokeDasharray = lane.strokeDasharray || "";
  return `<g>
    <rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="${lane.h}" rx="8"
      fill="${accent.soft}" fill-opacity="${fillOpacity}" stroke="${accent.strong}"
      stroke-opacity="${strokeOpacity}" stroke-width=".9"
      ${strokeDasharray ? `stroke-dasharray="${strokeDasharray}"` : ""}/>
    <line x1="${lane.x + 16}" y1="${lane.y + 17}" x2="${lane.x + 52}" y2="${lane.y + 17}"
      stroke="${accent.strong}" stroke-width="2"/>
    <text x="${lane.x + 62}" y="${lane.y + 22}" class="lane-title">${escapeXml(lane.title)}</text>
    ${lane.subtitle ? `<text x="${lane.x + 16}" y="${lane.y + 45}" class="lane-subtitle">${escapeXml(lane.subtitle)}</text>` : ""}
  </g>`;
}

function drawActor(node, accent, configDir) {
  const { x, y, w } = nodeBounds(node);
  const center = x + w / 2;
  const brands = Array.isArray(node.brands) ? node.brands : [];
  const brandSize = brands.length > 1 ? 38 : 52;
  const brandGap = 14;
  const brandRowWidth = brands.length * brandSize + Math.max(0, brands.length - 1) * brandGap;
  const actorIcons = brands.length
    ? brands.map((brand, index) => brandIcon(
      { ...node, ...brand },
      center - brandRowWidth / 2 + index * (brandSize + brandGap),
      y + 9,
      brandSize,
      ACTIVE_ACCENTS[brand.accent || node.accent || "slate"],
      configDir,
    )).join("")
    : brandIcon(node, center - 26, y + 2, 52, accent, configDir);
  return `<g>
    ${actorIcons}
    <text x="${center}" y="${y + 76}" text-anchor="middle" class="node-title">${escapeXml(node.title)}</text>
    ${node.meta ? `<text x="${center}" y="${y + 96}" text-anchor="middle" class="node-meta">${escapeXml(node.meta)}</text>` : ""}
  </g>`;
}

function drawService(node, accent, configDir) {
  const { x, y, w, h } = nodeBounds(node);
  const details = lines(node.details);
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${PALETTE.node}"
      stroke="${PALETTE.border}" stroke-width="1.2" filter="url(#node-shadow)"/>
    <rect x="${x}" y="${y}" width="5" height="${h}" rx="2.5" fill="${accent.strong}"/>
    ${brandIcon(node, x + 20, y + 18, 36, accent, configDir)}
    <text x="${x + 70}" y="${y + 32}" class="node-title">${escapeXml(node.title)}</text>
    ${node.meta ? `<text x="${x + 70}" y="${y + 52}" class="node-meta">${escapeXml(node.meta)}</text>` : ""}
    ${details.map((line, index) => `<text x="${x + 22}" y="${y + 82 + index * 19}" class="node-detail">${escapeXml(line)}</text>`).join("")}
  </g>`;
}

function drawDatabase(node, accent, configDir) {
  const { x, y, w, h } = nodeBounds(node);
  const details = lines(node.details);
  const top = y + 14;
  const bottom = y + h - 14;
  return `<g>
    <path d="M ${x} ${top} C ${x} ${y - 2}, ${x + w} ${y - 2}, ${x + w} ${top}
      L ${x + w} ${bottom} C ${x + w} ${y + h + 2}, ${x} ${y + h + 2}, ${x} ${bottom} Z"
      fill="${PALETTE.node}" stroke="${PALETTE.border}" stroke-width="1.2" filter="url(#node-shadow)"/>
    <ellipse cx="${x + w / 2}" cy="${top}" rx="${w / 2}" ry="14" fill="${accent.soft}" stroke="${PALETTE.border}" stroke-width="1.2"/>
    ${brandIcon(node, x + 20, y + 32, 38, accent, configDir)}
    <text x="${x + 70}" y="${y + 47}" class="node-title">${escapeXml(node.title)}</text>
    ${node.meta ? `<text x="${x + 70}" y="${y + 68}" class="node-meta">${escapeXml(node.meta)}</text>` : ""}
    ${details.map((line, index) => `<text x="${x + 22}" y="${y + 96 + index * 19}" class="node-detail">${escapeXml(line)}</text>`).join("")}
  </g>`;
}

function drawQueue(node, accent, configDir) {
  const { x, y, w, h } = nodeBounds(node);
  const tubeHeight = Math.min(node.tubeHeight ?? (node.metaBelow ? 56 : h), h);
  const capX = x + w - tubeHeight / 2;
  const iconSize = Math.min(32, tubeHeight - 18);
  const iconY = y + (tubeHeight - iconSize) / 2;
  const titleX = x + 66;
  const availableTitleWidth = Math.max(54, capX - 12 - titleX);
  const estimatedTitleWidth = Math.max(1, String(node.title).length * 7.4);
  const titleFontSize = Math.max(11, Math.min(14, 14 * availableTitleWidth / estimatedTitleWidth));
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${tubeHeight}" rx="${tubeHeight / 2}" fill="${PALETTE.node}"
      stroke="${PALETTE.border}" stroke-width="1.3" filter="url(#node-shadow)"/>
    <path d="M ${capX} ${y + 4}
      C ${capX - tubeHeight * 0.34} ${y + 4}, ${capX - tubeHeight * 0.34} ${y + tubeHeight - 4}, ${capX} ${y + tubeHeight - 4}"
      fill="none" stroke="${PALETTE.muted}" stroke-width="1.15"/>
    ${brandIcon(node, x + 20, iconY, iconSize, accent, configDir)}
    <text x="${titleX}" y="${y + tubeHeight / 2 + 5}" class="queue-title"
      style="font-size:${titleFontSize.toFixed(2)}px">${escapeXml(node.title)}</text>
    ${node.meta ? `<text x="${x + w / 2}" y="${y + tubeHeight + 18}" text-anchor="middle" class="queue-meta">${escapeXml(node.meta)}</text>` : ""}
  </g>`;
}

function drawCache(node, accent, configDir) {
  const { x, y, w, h } = nodeBounds(node);
  const details = lines(node.details);
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${accent.soft}"
      stroke="${PALETTE.border}" stroke-width="1.2" filter="url(#node-shadow)"/>
    ${brandIcon(node, x + 20, y + 18, 40, accent, configDir)}
    <text x="${x + 74}" y="${y + 34}" class="node-title">${escapeXml(node.title)}</text>
    ${node.meta ? `<text x="${x + 74}" y="${y + 55}" class="node-meta">${escapeXml(node.meta)}</text>` : ""}
    ${details.map((line, index) => `<text x="${x + 22}" y="${y + 84 + index * 19}" class="node-detail">${escapeXml(line)}</text>`).join("")}
  </g>`;
}

function drawFabric(node, accent, configDir) {
  const { x, y, w, h } = nodeBounds(node);
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"
      fill="${PALETTE.nodeStrong}" fill-opacity=".98" stroke="${accent.strong}"
      stroke-width="1.2" stroke-dasharray="7 5" filter="url(#node-shadow)"/>
    ${brandIcon(node, x + 18, y + (h - 30) / 2, 30, accent, configDir)}
    <text x="${x + 60}" y="${y + h / 2 + 5}" class="fabric-title">${escapeXml(node.title)}</text>
    ${node.meta ? `<text x="${x + w - 18}" y="${y + h / 2 + 4}" text-anchor="end" class="fabric-meta">${escapeXml(node.meta)}</text>` : ""}
  </g>`;
}

function drawCluster(node, accent, configDir) {
  const { x, y, w, h } = nodeBounds(node);
  const members = lines(node.members);
  const resources = Array.isArray(node.resources) ? node.resources : [];
  const gap = 10;
  const columns = 2;
  const memberWidth = (w - 44 - gap) / columns;
  const memberHeight = 32;
  const memberTop = y + 72;
  const resourceGap = 8;
  const resourceHeight = 48;
  const resourceTop = y + h - resourceHeight - 14;
  const resourceWeights = resources.map((resource) => resource.weight ?? 1);
  const totalResourceWeight = resourceWeights.reduce((total, weight) => total + weight, 0) || 1;
  const resourceAreaWidth = w - 44 - resourceGap * Math.max(0, resources.length - 1);
  let resourceCursor = x + 22;

  const resourcesMarkup = resources.map((resource, index) => {
    const resourceWidth = resourceAreaWidth * (resourceWeights[index] / totalResourceWeight);
    const resourceAccent = ACTIVE_ACCENTS[resource.accent || "slate"];
    const markup = `<g>
      <rect x="${resourceCursor}" y="${resourceTop}" width="${resourceWidth}" height="${resourceHeight}" rx="5"
        fill="${resourceAccent.soft}" fill-opacity=".78" stroke="${resourceAccent.strong}" stroke-opacity=".5"/>
      ${brandIcon(resource, resourceCursor + 10, resourceTop + 12, 24, resourceAccent, configDir)}
      <text x="${resourceCursor + 42}" y="${resourceTop + 19}" class="resource-title">${escapeXml(resource.title)}</text>
      ${resource.meta ? `<text x="${resourceCursor + 42}" y="${resourceTop + 36}" class="resource-meta">${escapeXml(resource.meta)}</text>` : ""}
    </g>`;
    resourceCursor += resourceWidth + resourceGap;
    return markup;
  }).join("");

  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${accent.soft}"
      fill-opacity=".9" stroke="${accent.strong}" stroke-opacity=".72" stroke-width="1.25"
      filter="url(#node-shadow)"/>
    <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${accent.strong}"/>
    ${brandIcon(node, x + 20, y + 16, 38, accent, configDir)}
    <text x="${x + 72}" y="${y + 31}" class="node-title">${escapeXml(node.title)}</text>
    ${node.meta ? `<text x="${x + 72}" y="${y + 52}" class="node-meta">${escapeXml(node.meta)}</text>` : ""}
    <line x1="${x + 20}" y1="${y + 63}" x2="${x + w - 20}" y2="${y + 63}"
      stroke="${accent.strong}" stroke-opacity=".24"/>
    ${members.map((member, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const memberX = x + 22 + column * (memberWidth + gap);
      const memberY = memberTop + row * (memberHeight + 9);
      return `<g>
        <rect x="${memberX}" y="${memberY}" width="${memberWidth}" height="${memberHeight}" rx="5"
          fill="${PALETTE.nodeStrong}" fill-opacity=".96" stroke="${accent.strong}" stroke-opacity=".35"/>
        <circle cx="${memberX + 14}" cy="${memberY + memberHeight / 2}" r="3.5" fill="${accent.strong}"/>
        <text x="${memberX + 26}" y="${memberY + 22}" class="cluster-member">${escapeXml(member)}</text>
      </g>`;
    }).join("")}
    ${resourcesMarkup}
  </g>`;
}

function drawNode(node, configDir) {
  const accent = ACTIVE_ACCENTS[node.accent || "slate"];
  if (node.shape === "actor") return drawActor(node, accent, configDir);
  if (node.shape === "database") return drawDatabase(node, accent, configDir);
  if (node.shape === "queue") return drawQueue(node, accent, configDir);
  if (node.shape === "cache") return drawCache(node, accent, configDir);
  if (node.shape === "fabric") return drawFabric(node, accent, configDir);
  if (node.shape === "cluster") return drawCluster(node, accent, configDir);
  return drawService(node, accent, configDir);
}

function drawCallout(callout, configDir) {
  const accent = ACTIVE_ACCENTS[callout.accent || "slate"];
  const node = { ...callout, brand: callout.brand, icon: callout.icon || "file" };
  return `<g>
    <rect x="${callout.x}" y="${callout.y}" width="${callout.w}" height="${callout.h}" fill="${PALETTE.node}"
      stroke="${accent.strong}" stroke-width="1.1" stroke-dasharray="4 4"/>
    ${brandIcon(node, callout.x + 16, callout.y + 15, 28, accent, configDir)}
    <text x="${callout.x + 56}" y="${callout.y + 31}" class="callout-title">${escapeXml(callout.title)}</text>
    ${lines(callout.lines).map((line, index) => `<text x="${callout.x + 18}" y="${callout.y + 57 + index * 18}" class="node-detail">${escapeXml(line)}</text>`).join("")}
  </g>`;
}

function render(config, configDir) {
  const themeName = config.theme === "dark" ? "dark" : "light";
  ACTIVE_ACCENTS = themeName === "dark" ? DARK_ACCENTS : LIGHT_ACCENTS;
  ACTIVE_EDGE_STYLES = themeName === "dark" ? DARK_EDGE_STYLES : LIGHT_EDGE_STYLES;
  PALETTE = PALETTES[themeName];

  const width = config.width || 1600;
  const height = config.height || 900;
  const resolvedNodes = materializeNodes(config);
  validateDiagram({ ...config, width, height }, resolvedNodes);
  const byId = new Map(resolvedNodes.map((node) => [node.id, node]));
  const lanes = (config.lanes || []).map(drawLane).join("");
  const edges = (config.edges || []).map((edge) => {
    const style = ACTIVE_EDGE_STYLES[edge.kind || "sync"];
    const pathData = edgePath(edge, byId);
    return `<path d="${pathData.d}" fill="none" stroke="${style.color}" stroke-width="${style.width}"
      ${style.dash ? `stroke-dasharray="${style.dash}"` : ""}
      stroke-linecap="${edge.routing === "smooth" ? "round" : "square"}" stroke-linejoin="round" marker-end="url(#${style.marker})"/>
      ${edgeLabel(edge, pathData)}`;
  }).join("");
  const nodes = resolvedNodes.map((node) => drawNode(node, configDir)).join("");
  const callouts = (config.callouts || []).map((callout) => drawCallout(callout, configDir)).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(config.title)}</title>
  <desc id="desc">${escapeXml(config.description || config.subtitle || "")}</desc>
  <defs>
    <pattern id="grid-small" width="22" height="22" patternUnits="userSpaceOnUse">
      <path d="M 22 0 L 0 0 0 22" fill="none" stroke="${PALETTE.gridSmall}" stroke-opacity=".42" stroke-width=".7"/>
    </pattern>
    <pattern id="grid" width="110" height="110" patternUnits="userSpaceOnUse">
      <rect width="110" height="110" fill="url(#grid-small)"/>
      <path d="M 110 0 L 0 0 0 110" fill="none" stroke="${PALETTE.gridLarge}" stroke-opacity=".52" stroke-width="1"/>
    </pattern>
    <filter id="node-shadow" x="-12%" y="-12%" width="124%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="${PALETTE.shadow}" flood-opacity=".22"/>
    </filter>
    ${Object.entries(ACTIVE_EDGE_STYLES).map(([name, value]) => `<marker id="arrow-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${value.color}"/></marker>`).join("")}
  </defs>
  <style>
    text { font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${PALETTE.text}; }
    .diagram-title { font-size: 28px; font-weight: 750; }
    .diagram-subtitle { font-size: 13px; fill: ${PALETTE.muted}; }
    .diagram-summary { font-size: 10px; font-weight: 750; letter-spacing: 1.4px; fill: ${PALETTE.muted}; }
    .lane-title { font-size: 12px; font-weight: 750; letter-spacing: 1.5px; fill: ${PALETTE.muted}; }
    .lane-subtitle { font-size: 10px; fill: ${PALETTE.faint}; }
    .node-title { font-size: 16px; font-weight: 740; }
    .node-meta { font-size: 10px; font-weight: 700; letter-spacing: 1px; fill: ${PALETTE.muted}; }
    .node-detail { font-size: 11px; fill: ${PALETTE.muted}; }
    .cluster-member { font-size: 11px; font-weight: 660; fill: ${PALETTE.text}; }
    .resource-title { font-size: 10px; font-weight: 700; fill: ${PALETTE.text}; }
    .resource-meta { font-size: 8px; font-weight: 700; letter-spacing: .55px; fill: ${PALETTE.muted}; }
    .queue-title { font-size: 14px; font-weight: 740; fill: ${PALETTE.text}; }
    .queue-meta { font-size: 9px; font-weight: 700; letter-spacing: .8px; fill: ${PALETTE.muted}; }
    .fabric-title { font-size: 12px; font-weight: 750; letter-spacing: .6px; fill: ${PALETTE.text}; }
    .fabric-meta { font-size: 9.5px; font-weight: 700; letter-spacing: .8px; fill: ${PALETTE.muted}; }
    .edge-label { font-size: 9.5px; font-weight: 600; fill: ${PALETTE.muted}; }
    .callout-title { font-size: 13px; font-weight: 700; }
    .legend { font-size: 10px; font-weight: 650; fill: ${PALETTE.muted}; }
  </style>
  <rect width="${width}" height="${height}" fill="${PALETTE.canvas}"/>
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity=".86"/>
  <rect x="0" y="0" width="${width}" height="92" fill="${PALETTE.header}" fill-opacity=".97"/>
  <line x1="0" y1="92" x2="${width}" y2="92" stroke="${PALETTE.softBorder}"/>
  <circle cx="38" cy="31" r="6" fill="${ACTIVE_ACCENTS.green.strong}"/>
  <text x="56" y="40" class="diagram-title">${escapeXml(config.title)}</text>
  <text x="56" y="66" class="diagram-subtitle">${escapeXml(config.subtitle || "")}</text>
  ${config.summary ? `<text x="${width - 40}" y="28" text-anchor="end" class="diagram-summary">${escapeXml(config.summary)}</text>` : ""}
  <g transform="translate(${width - 420} 45)">
    <line x1="0" y1="7" x2="30" y2="7" stroke="${ACTIVE_EDGE_STYLES.primary.color}" stroke-width="2"/>
    <text x="38" y="11" class="legend">request</text>
    <line x1="100" y1="7" x2="130" y2="7" stroke="${ACTIVE_EDGE_STYLES.event.color}" stroke-width="1.8" stroke-dasharray="7 6"/>
    <text x="138" y="11" class="legend">Kafka event</text>
    <line x1="222" y1="7" x2="252" y2="7" stroke="${ACTIVE_EDGE_STYLES.recovery.color}" stroke-width="1.7" stroke-dasharray="3 6"/>
    <text x="260" y="11" class="legend">recovery / DLQ</text>
  </g>
  ${lanes}
  <g>${edges}</g>
  <g>${nodes}</g>
  <g>${callouts}</g>
</svg>`;
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: node render-architecture-diagram.mjs <diagram.json> [...]");
    process.exit(1);
  }

  for (const file of files) {
    const absolute = path.resolve(file);
    const config = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const output = absolute.replace(/\.json$/i, ".svg");
    fs.writeFileSync(output, render(config, path.dirname(absolute)));
    console.log(`Rendered ${path.relative(process.cwd(), output)}`);
  }
}

main();
