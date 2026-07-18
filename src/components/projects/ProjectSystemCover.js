import styles from "./PlatformProjectCover.module.css";

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
  const zones = Array.isArray(config?.domains) ? config.domains : [];
  const hasCoverMetadata = [
    system?.title,
    system?.eyebrow,
    config?.coverTheme,
    config?.coverLayout,
    config?.coverStatus,
    config?.coverMotif,
  ].every((value) => typeof value === "string" && value.trim().length > 0);

  if (sourceNodes.length < 2 || sourceEdges.length < 1 || zones.length < 1 || !hasCoverMetadata) {
    return null;
  }

  const nodes = sourceNodes.slice(0, 10);
  const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const paths = sourceEdges.flatMap((edge) => {
    const from = nodeMap[edge.from];
    const to = nodeMap[edge.to];
    return from && to ? [{ d: edgePath(from, to), kind: edge.kind || "sync" }] : [];
  });

  return {
    theme: config.coverTheme,
    layout: config.coverLayout,
    eyebrow: system.title,
    caption: system.eyebrow,
    status: config.coverStatus,
    motif: config.coverMotif,
    aria: `${system.title} component architecture`,
    zones,
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

export function supportsSystemCover(system) {
  return Boolean(databasePreset(system));
}

export default function ProjectSystemCover({ system }) {
  const preset = databasePreset(system);
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
