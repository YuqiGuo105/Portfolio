export const GRAFANA_PUBLIC_URL = "https://loyalcaravan951.grafana.net/public-dashboards/154eccd6136f4daebe70faf015600aa9";
const github = "https://github.com/YuqiGuo105/";

export const SERVICE_CATALOG = Object.freeze({
  "portfolio-admin-service": { name: "Admin", purpose: "Content management, publishing, and protected operational APIs.", repo: "portfolio-admin-service", module: "admin-service", stack: ["Spring Boot", "PostgreSQL", "Kafka"] },
  "portfolio-notification-service": { name: "Notification", purpose: "Subscription preferences and reliable delivery of content updates.", repo: "portfolio-notification-service", stack: ["Spring Boot", "PostgreSQL", "Email"] },
  "portfolio-agent-service": { name: "AI Agent", purpose: "Plans requests, retrieves evidence, runs tools, and streams Mr. Pot's answers.", repo: "portfolio-ai-platform", module: "portfolio-agent-service", stack: ["Spring Boot", "SSE", "Valkey"] },
  "portfolio-mcp-gateway": { name: "MCP Gateway", purpose: "Typed tool execution with role checks, confirmation, and audit records.", repo: "portfolio-ai-platform", module: "portfolio-mcp-gateway", stack: ["Spring Boot", "MCP", "RBAC"] },
  "knowledge-service": { name: "Knowledge", purpose: "Permission-aware retrieval that combines lexical and vector evidence.", repo: "portfolio-ai-platform", module: "knowledge-service", stack: ["Spring Boot", "OpenSearch", "pgvector"] },
  "portfolio-search-indexer": { name: "Search Indexer", purpose: "Projects content changes into searchable OpenSearch documents.", repo: "portfolio-admin-service", module: "search-indexer", stack: ["Spring Boot", "Kafka", "OpenSearch"] },
  "portfolio-rag-indexer": { name: "RAG Indexer", purpose: "Chunks content and maintains embeddings for retrieval.", repo: "portfolio-admin-service", module: "rag-indexer", stack: ["Spring Boot", "Kafka", "pgvector"] },
  "analytics-aggregator-service": { name: "Analytics Aggregator", purpose: "Deduplicates visitor events and builds session and geographic rollups.", repo: "portfolio-analytics-platform", module: "analytics-aggregator-service", stack: ["Spring Boot", "Kafka", "Valkey"] },
  "analytics-alerts-service": { name: "Analytics Alerts", purpose: "Evaluates visitor analytics rules and prepares operational alerts.", repo: "portfolio-analytics-platform", module: "analytics-alerts-service", stack: ["Spring Boot", "PostgreSQL", "Alerts"] },
  "portfolio-application-copilot": { name: "Career Workflow Service", purpose: "Private application workflows with owner-reviewed actions.", repo: "portfolio-application-copilot", stack: ["Spring Boot", "PostgreSQL", "Valkey"] },
});

export function getServiceMetadata(job) {
  if (typeof job !== "string" || !Object.hasOwn(SERVICE_CATALOG, job)) return null;
  const metadata = SERVICE_CATALOG[job];
  return { ...metadata, repositoryUrl: `${github}${metadata.repo}` };
}

export function metricNumber(value, digits = 1, suffix = "") {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "N/A";
  if (value > 0 && value < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}${suffix}`;
  return `${value.toFixed(digits)}${suffix}`;
}

export function memorySize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "N/A";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}

export function processAge(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "N/A";
  const h = Math.floor(seconds / 3600);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor(seconds % 3600 / 60)}m`;
}
