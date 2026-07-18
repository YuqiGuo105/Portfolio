import styles from "./PlatformProjectCover.module.css";

const PRESETS = {
  PLATFORM_SYSTEM_MAP: {
    eyebrow: "PORTFOLIO PLATFORM",
    caption: "PRODUCTION SYSTEM MAP · 2026",
    status: "LIVE ARCHITECTURE",
    aria: "Portfolio Platform production architecture system map",
    nodes: ["UI", "API", "CORE", "CONTENT", "ENGAGE", "BEHAVIOR", "SEARCH", "KAFKA", "DATA"],
  },
  CONTENT_INTELLIGENCE: {
    eyebrow: "CONTENT INTELLIGENCE",
    caption: "PUBLISH · INDEX · RETRIEVE",
    status: "REPLAYABLE PIPELINE",
    aria: "Event-driven content search and retrieval architecture",
    nodes: ["ADMIN", "API", "OUTBOX", "INDEX", "RAG", "SEARCH", "OS", "KAFKA", "PGV"],
  },
  SUBSCRIPTION_NOTIFICATION: {
    eyebrow: "SUBSCRIPTION + NOTIFICATION",
    caption: "VERIFY · PREFERENCE · DELIVER",
    status: "GOVERNED DELIVERY",
    aria: "Subscription and notification delivery architecture",
    nodes: ["WEB", "API", "VERIFY", "PREF", "MCP", "MAIL", "SMTP", "KAFKA", "DB"],
  },
  VISITOR_BEHAVIOR: {
    eyebrow: "VISITOR BEHAVIOR",
    caption: "INGEST · AGGREGATE · ACT",
    status: "FIRST-PARTY SIGNALS",
    aria: "Visitor behavior analytics and aggregation architecture",
    nodes: ["SDK", "API", "STREAM", "SESSION", "FUNNEL", "ROLLUP", "ALERT", "KAFKA", "DATA"],
  },
};

const POSITIONS = [
  { x: 10, y: 49, tone: "edge" },
  { x: 27, y: 49, tone: "edge" },
  { x: 46, y: 49, tone: "core" },
  { x: 67, y: 22, tone: "content" },
  { x: 67, y: 49, tone: "engagement" },
  { x: 67, y: 76, tone: "behavior" },
  { x: 89, y: 22, tone: "data" },
  { x: 89, y: 49, tone: "events" },
  { x: 89, y: 76, tone: "data" },
];

export function supportsSystemCover(variant) {
  return Boolean(PRESETS[variant]);
}

export default function ProjectSystemCover({ variant }) {
  const preset = PRESETS[variant];
  if (!preset) return null;

  return (
    <div className={styles.cover} role="img" aria-label={preset.aria}>
      <div className={styles.grid} aria-hidden="true" />
      <div className={`${styles.zone} ${styles.edgeZone}`} aria-hidden="true" />
      <div className={`${styles.zone} ${styles.coreZone}`} aria-hidden="true" />
      <div className={`${styles.zone} ${styles.platformZone}`} aria-hidden="true" />
      <div className={`${styles.zone} ${styles.dataZone}`} aria-hidden="true" />

      <svg className={styles.links} viewBox="0 0 1000 360" aria-hidden="true">
        <path d="M100 176 C165 176 215 176 270 176" />
        <path d="M270 176 C335 176 400 176 460 176" />
        <path d="M460 176 C535 125 590 90 670 79" />
        <path d="M460 176 C540 176 590 176 670 176" />
        <path d="M460 176 C535 228 590 262 670 274" />
        <path d="M670 79 C750 79 820 79 890 79" />
        <path d="M670 176 C750 176 820 176 890 176" />
        <path d="M670 274 C750 274 820 274 890 274" />
        <path d="M890 79 C930 125 930 224 890 274" />
      </svg>

      <div className={styles.nodes} aria-hidden="true">
        {preset.nodes.map((label, index) => {
          const position = POSITIONS[index];
          return (
            <span
              key={`${label}-${index}`}
              className={`${styles.node} ${styles[position.tone]}`}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
            >
              {label}
            </span>
          );
        })}
      </div>

      <div className={styles.heading}>
        <span>{preset.eyebrow}</span>
        <strong>{preset.caption}</strong>
      </div>
      <span className={styles.status}>{preset.status}</span>
    </div>
  );
}
