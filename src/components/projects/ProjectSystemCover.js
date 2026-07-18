import styles from "./PlatformProjectCover.module.css";

const PRESETS = {
  PLATFORM_SYSTEM_MAP: {
    theme: "platform",
    layout: "topology",
    eyebrow: "PORTFOLIO PLATFORM",
    caption: "PRODUCTION SYSTEM MAP · 2026",
    status: "LIVE ARCHITECTURE",
    motif: "CONTROL + DATA PLANES",
    aria: "Portfolio Platform hub and spoke production architecture",
    zones: [
      { label: "EDGE", x: 3, width: 29 },
      { label: "CORE", x: 35, width: 21 },
      { label: "CAPABILITIES", x: 59, width: 18 },
      { label: "PLATFORM", x: 80, width: 17 },
    ],
    nodes: [
      { label: "UI", x: 9, y: 52, tone: "edge" },
      { label: "API", x: 26, y: 52, tone: "edge" },
      { label: "CORE", x: 46, y: 52, tone: "primary", shape: "hub" },
      { label: "CONTENT", x: 68, y: 23, tone: "gold" },
      { label: "ENGAGE", x: 68, y: 52, tone: "rose" },
      { label: "BEHAVIOR", x: 68, y: 81, tone: "cyan" },
      { label: "SEARCH", x: 89, y: 23, tone: "data" },
      { label: "KAFKA", x: 89, y: 52, tone: "violet" },
      { label: "DATA", x: 89, y: 81, tone: "data" },
    ],
    paths: [
      { d: "M90 187 C155 187 205 187 260 187", kind: "sync" },
      { d: "M260 187 C330 187 390 187 460 187", kind: "sync" },
      { d: "M460 187 C535 140 590 93 680 84", kind: "data" },
      { d: "M460 187 C540 187 600 187 680 187", kind: "async" },
      { d: "M460 187 C535 235 590 278 680 292", kind: "signal" },
      { d: "M680 84 C755 84 825 84 890 84", kind: "data" },
      { d: "M680 187 C755 187 825 187 890 187", kind: "async" },
      { d: "M680 292 C755 292 825 292 890 292", kind: "signal" },
    ],
  },
};

const SHAPE_TONES = {
  cache: "gold",
  client: "edge",
  database: "data",
  "event-stream": "violet",
  gateway: "edge",
  model: "violet",
  policy: "gold",
  "search-index": "cyan",
  worker: "rose",
};

const SHAPE_STYLES = {
  database: "store",
  "event-stream": "stream",
};

function edgePath(from, to) {
  const startX = Number(from.x) * 10;
  const startY = Number(from.y) * 3.6;
  const endX = Number(to.x) * 10;
  const endY = Number(to.y) * 3.6;
  const bend = Math.max(36, Math.abs(endX - startX) * 0.42);
  const direction = endX >= startX ? 1 : -1;
  return `M${startX} ${startY} C${startX + bend * direction} ${startY} ${endX - bend * direction} ${endY} ${endX} ${endY}`;
}

function databasePreset(system) {
  const config = system?.diagram_config || system?.diagramConfig;
  const sourceNodes = Array.isArray(config?.nodes) ? config.nodes : [];
  const sourceEdges = Array.isArray(config?.edges) ? config.edges : [];
  if (sourceNodes.length < 2) return null;

  const nodes = sourceNodes.slice(0, 10);
  const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const paths = sourceEdges.flatMap((edge) => {
    const from = nodeMap[edge.from];
    const to = nodeMap[edge.to];
    return from && to ? [{ d: edgePath(from, to), kind: edge.kind || "sync" }] : [];
  });

  return {
    theme: config.coverTheme || "platform",
    layout: config.coverLayout || "database",
    eyebrow: system.title || "SYSTEM ARCHITECTURE",
    caption: system.eyebrow || "LIVE COMPONENT MAP",
    status: config.coverStatus || "DATABASE-DRIVEN",
    motif: config.coverMotif || `${nodes.length} COMPONENTS · ${paths.length} LINKS`,
    aria: `${system.title || "Project"} component architecture`,
    zones: Array.isArray(config.domains) ? config.domains : [],
    nodes: nodes.map((node) => ({
      label: node.code || node.label || node.title,
      x: node.x,
      y: node.y,
      tone: node.tone || SHAPE_TONES[node.shape] || "data",
      shape: SHAPE_STYLES[node.shape] || "service",
    })),
    paths,
  };
}

export function supportsSystemCover(variant, system) {
  return Boolean(PRESETS[variant] || databasePreset(system));
}

export default function ProjectSystemCover({ variant, system }) {
  const preset = databasePreset(system) || PRESETS[variant];
  if (!preset) return null;

  return (
    <div
      className={styles.cover}
      data-theme={preset.theme}
      data-layout={preset.layout}
      role="img"
      aria-label={preset.aria}
    >
      <div className={styles.grid} aria-hidden="true" />
      <div className={styles.layoutSignature} aria-hidden="true" />
      <div className={styles.zones} aria-hidden="true">
        {preset.zones.map((zone) => (
          <span
            key={zone.label}
            className={styles.zone}
            style={{ left: `${zone.x}%`, width: `${zone.width}%` }}
          >
            {zone.label}
          </span>
        ))}
      </div>

      <svg className={styles.links} viewBox="0 0 1000 360" aria-hidden="true">
        {preset.paths.map((path, index) => (
          <path key={`${path.kind}-${index}`} d={path.d} data-kind={path.kind} />
        ))}
      </svg>

      <div className={styles.nodes} aria-hidden="true">
        {preset.nodes.map((node) => (
          <span
            key={node.label}
            className={styles.node}
            data-tone={node.tone}
            data-shape={node.shape || "service"}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            {node.label}
          </span>
        ))}
      </div>

      <span className={styles.motif}>{preset.motif}</span>
      <div className={styles.heading}>
        <span>{preset.eyebrow}</span>
        <strong>{preset.caption}</strong>
      </div>
      <span className={styles.status}>{preset.status}</span>
    </div>
  );
}
