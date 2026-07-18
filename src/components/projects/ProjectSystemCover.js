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
  CONTENT_INTELLIGENCE: {
    theme: "content",
    layout: "pipeline",
    eyebrow: "CONTENT INTELLIGENCE",
    caption: "PUBLISH · INDEX · RETRIEVE",
    status: "REPLAYABLE PROJECTIONS",
    motif: "SOURCE → TWO PROJECTIONS",
    aria: "Content publication pipeline splitting into search and RAG projections",
    zones: [
      { label: "WRITE", x: 3, width: 35 },
      { label: "EVENT", x: 41, width: 21 },
      { label: "PROJECT", x: 65, width: 19 },
      { label: "SERVE", x: 87, width: 10 },
    ],
    nodes: [
      { label: "ADMIN", x: 8, y: 52, tone: "edge" },
      { label: "API", x: 24, y: 52, tone: "edge" },
      { label: "OUTBOX", x: 42, y: 52, tone: "gold", shape: "store" },
      { label: "KAFKA", x: 59, y: 52, tone: "violet", shape: "stream" },
      { label: "SEARCH", x: 77, y: 29, tone: "cyan" },
      { label: "RAG", x: 77, y: 73, tone: "rose" },
      { label: "OS", x: 93, y: 29, tone: "data", shape: "store" },
      { label: "PGV", x: 93, y: 73, tone: "data", shape: "store" },
    ],
    paths: [
      { d: "M80 187 C145 187 185 187 240 187", kind: "sync" },
      { d: "M240 187 C305 187 355 187 420 187", kind: "data" },
      { d: "M420 187 C480 187 530 187 590 187", kind: "async" },
      { d: "M590 187 C655 150 700 108 770 104", kind: "search" },
      { d: "M590 187 C655 225 700 265 770 263", kind: "rag" },
      { d: "M770 104 C835 104 875 104 930 104", kind: "search" },
      { d: "M770 263 C835 263 875 263 930 263", kind: "rag" },
    ],
  },
  SUBSCRIPTION_NOTIFICATION: {
    theme: "notification",
    layout: "sequence",
    eyebrow: "SUBSCRIPTION + NOTIFICATION",
    caption: "VERIFY · PREFERENCE · DELIVER",
    status: "CONSENT-AWARE DELIVERY",
    motif: "IDENTITY LOOP + FAN-OUT",
    aria: "Email verification loop and preference-aware notification fan-out",
    zones: [
      { label: "CONSENT", x: 3, width: 38 },
      { label: "DECIDE", x: 44, width: 25 },
      { label: "DELIVER", x: 72, width: 25 },
    ],
    nodes: [
      { label: "WEB", x: 8, y: 52, tone: "edge" },
      { label: "VERIFY", x: 26, y: 29, tone: "primary", shape: "hub" },
      { label: "MCP", x: 26, y: 75, tone: "violet" },
      { label: "PREF", x: 47, y: 29, tone: "gold", shape: "store" },
      { label: "FANOUT", x: 60, y: 52, tone: "rose", shape: "hub" },
      { label: "WEB FEED", x: 79, y: 27, tone: "cyan" },
      { label: "MAIL", x: 79, y: 75, tone: "rose" },
      { label: "SMTP", x: 94, y: 75, tone: "gold" },
      { label: "DB", x: 94, y: 27, tone: "data", shape: "store" },
    ],
    paths: [
      { d: "M80 187 C140 150 190 112 260 105", kind: "verify" },
      { d: "M80 187 C145 230 195 270 260 270", kind: "async" },
      { d: "M260 105 C335 105 400 105 470 105", kind: "verify" },
      { d: "M260 270 C335 250 400 160 470 105", kind: "async" },
      { d: "M470 105 C520 125 555 160 600 187", kind: "data" },
      { d: "M600 187 C665 145 720 100 790 98", kind: "signal" },
      { d: "M600 187 C665 230 720 270 790 270", kind: "deliver" },
      { d: "M790 270 C850 270 895 270 940 270", kind: "deliver" },
      { d: "M790 98 C850 98 895 98 940 98", kind: "data" },
    ],
  },
  VISITOR_BEHAVIOR: {
    theme: "analytics",
    layout: "stream",
    eyebrow: "VISITOR BEHAVIOR",
    caption: "INGEST · AGGREGATE · ACT",
    status: "RECOMMENDATION-READY",
    motif: "EVENTS → SIGNALS",
    aria: "Behavior event stream aggregating into analytics and recommendation signals",
    zones: [
      { label: "COLLECT", x: 3, width: 31 },
      { label: "PROCESS", x: 37, width: 31 },
      { label: "ACT", x: 71, width: 26 },
    ],
    nodes: [
      { label: "SDK", x: 8, y: 52, tone: "edge" },
      { label: "EDGE", x: 23, y: 52, tone: "edge" },
      { label: "KAFKA", x: 39, y: 52, tone: "violet", shape: "stream" },
      { label: "DEDUP", x: 55, y: 27, tone: "gold" },
      { label: "SESSION", x: 55, y: 75, tone: "cyan" },
      { label: "ROLLUP", x: 72, y: 52, tone: "primary", shape: "hub" },
      { label: "DASH", x: 91, y: 24, tone: "cyan" },
      { label: "ALERT", x: 91, y: 52, tone: "rose" },
      { label: "RECO", x: 91, y: 80, tone: "gold" },
    ],
    paths: [
      { d: "M80 187 C130 187 180 187 230 187", kind: "sync" },
      { d: "M230 187 C285 187 335 187 390 187", kind: "async" },
      { d: "M390 187 C450 150 500 98 550 98", kind: "verify" },
      { d: "M390 187 C450 225 500 270 550 270", kind: "signal" },
      { d: "M550 98 C615 115 665 150 720 187", kind: "data" },
      { d: "M550 270 C615 250 665 220 720 187", kind: "data" },
      { d: "M720 187 C790 145 845 90 910 88", kind: "search" },
      { d: "M720 187 C790 187 845 187 910 187", kind: "deliver" },
      { d: "M720 187 C790 230 845 285 910 286", kind: "rag" },
    ],
  },
};

export function supportsSystemCover(variant) {
  return Boolean(PRESETS[variant]);
}

function ContentPipelineScene() {
  return (
    <div className={styles.contentPipeline} aria-hidden="true">
      <div className={styles.contentSource}>
        <span className={styles.pipelineLabel}>SOURCE OF TRUTH</span>
        <span className={styles.documentStack}>
          <i>ARTICLE</i>
          <i>PROJECT</i>
          <i>METADATA</i>
        </span>
      </div>

      <div className={styles.eventBackbone}>
        <span>OUTBOX</span>
        <i className={styles.eventRail} />
        <span>KAFKA</span>
      </div>

      <div className={styles.readModels}>
        <span className={styles.pipelineLabel}>READ MODELS</span>
        <span className={styles.readModel} data-kind="search">
          <strong>SEARCH</strong>
          <small>OPENSEARCH</small>
        </span>
        <span className={styles.readModel} data-kind="rag">
          <strong>RAG</strong>
          <small>PGVECTOR</small>
        </span>
      </div>
    </div>
  );
}

export default function ProjectSystemCover({ variant }) {
  const preset = PRESETS[variant];
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
      {preset.layout === "pipeline" ? (
        <ContentPipelineScene />
      ) : (
        <>
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
        </>
      )}

      <span className={styles.motif}>{preset.motif}</span>
      <div className={styles.heading}>
        <span>{preset.eyebrow}</span>
        <strong>{preset.caption}</strong>
      </div>
      <span className={styles.status}>{preset.status}</span>
    </div>
  );
}
