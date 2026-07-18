import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  BrainCircuit,
  Database,
  FileText,
  Gauge,
  Globe2,
  MemoryStick,
  Monitor,
  Network,
  Play,
  Radio,
  Search,
  Server,
  Sparkles,
  Square,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./PlatformArchitectureExperience.module.css";

const STEP_INTERVAL_MS = 760;

const ICONS = {
  analytics: BarChart3,
  bell: Bell,
  bot: Bot,
  brain: BrainCircuit,
  database: Database,
  file: FileText,
  gauge: Gauge,
  globe: Globe2,
  memory: MemoryStick,
  monitor: Monitor,
  network: Network,
  radio: Radio,
  search: Search,
  server: Server,
  sparkles: Sparkles,
  users: Users,
  wrench: Wrench,
  zap: Zap,
};

const FILTERS = [
  ["ALL", "All"],
  ["BUILT", "Built"],
  ["SYSTEM_DESIGN", "System design"],
];

const EDGE_KIND_CLASSES = {
  sync: styles.edgeSync,
  async: styles.edgeAsync,
  data: styles.edgeData,
};

const edgeKey = (from, to) => `${from}::${to}`;

function edgePath(from, to) {
  const startX = Number(from.x) * 10;
  const startY = Number(from.y) * 6;
  const endX = Number(to.x) * 10;
  const endY = Number(to.y) * 6;
  const bend = Math.max(48, Math.abs(endX - startX) * 0.46);
  const direction = endX >= startX ? 1 : -1;
  return `M ${startX} ${startY} C ${startX + bend * direction} ${startY}, ${endX - bend * direction} ${endY}, ${endX} ${endY}`;
}

function edgeLabelPosition(from, to) {
  return {
    x: ((Number(from.x) + Number(to.x)) / 2) * 10,
    y: ((Number(from.y) + Number(to.y)) / 2) * 6 - 7,
  };
}

function SystemDiagram({ system }) {
  const config = system.diagram_config || system.diagramConfig;
  const nodes = Array.isArray(config?.nodes) ? config.nodes : [];
  const edges = Array.isArray(config?.edges) ? config.edges : [];
  const routes = Array.isArray(config?.routes) ? config.routes : [];
  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node])),
    [nodes]
  );
  const initialRoute = config?.defaultRoute || routes[0]?.key || "";
  const initialNode = config?.defaultNode || nodes[0]?.id || "";

  const [routeKey, setRouteKey] = useState(initialRoute);
  const [activeStep, setActiveStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedNode, setSelectedNode] = useState(initialNode);
  const [traceId, setTraceId] = useState("TRACE READY");

  const route = routes.find((item) => item.key === routeKey) || routes[0];
  const steps = route?.steps || [];
  const transitions = useMemo(
    () => steps.slice(1).map((step, index) => edgeKey(steps[index].nodeId, step.nodeId)),
    [steps]
  );
  const completedEdges = useMemo(
    () => new Set(hasStarted ? transitions.slice(0, Math.max(0, activeStep - 1)) : []),
    [activeStep, hasStarted, transitions]
  );
  const isComplete = hasStarted && activeStep === steps.length - 1 && !isRunning;

  useEffect(() => {
    setRouteKey(initialRoute);
    setSelectedNode(initialNode);
    setActiveStep(0);
    setIsRunning(false);
    setHasStarted(false);
    setTraceId("TRACE READY");
  }, [initialNode, initialRoute, system.id]);

  useEffect(() => {
    if (!isRunning) return undefined;
    if (activeStep >= steps.length - 1) {
      setIsRunning(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setActiveStep((step) => step + 1), STEP_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activeStep, isRunning, steps.length]);

  useEffect(() => {
    if (hasStarted && steps[activeStep]) setSelectedNode(steps[activeStep].nodeId);
  }, [activeStep, hasStarted, steps]);

  if (!route || nodes.length < 2) return null;

  const resetForRoute = (nextRoute) => {
    const selectedRoute = routes.find((item) => item.key === nextRoute);
    setRouteKey(nextRoute);
    setActiveStep(0);
    setIsRunning(false);
    setHasStarted(false);
    setSelectedNode(selectedRoute?.steps?.[0]?.nodeId || initialNode);
    setTraceId("TRACE READY");
  };

  const startTrace = () => {
    if (!hasStarted || isComplete) setTraceId(`TRACE ${Date.now().toString(36).toUpperCase()}`);
    if (isComplete) setActiveStep(0);
    setHasStarted(true);
    setIsRunning(true);
  };

  const currentStep = steps[activeStep];
  const selected = nodeMap[selectedNode] || nodes[0];
  const visitedNodes = new Set(steps.slice(0, activeStep).map((step) => step.nodeId));
  const activeEdge = hasStarted && activeStep > 0 ? transitions[activeStep - 1] : null;
  const traceStatus = isRunning ? "RUNNING" : isComplete ? "COMPLETE" : hasStarted ? "PAUSED" : "READY";
  const progress = hasStarted && steps.length > 1
    ? Math.round((activeStep / (steps.length - 1)) * 100)
    : 0;

  return (
    <section className={styles.experience} aria-label={`${system.title} architecture`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>SYSTEM FLOW / LIVE TRACE</span>
          <h3>{route.label} request path</h3>
        </div>
        <div className={styles.controls}>
          {routes.length > 1 && (
            <div className={styles.routeSwitch} aria-label="Trace type">
              {routes.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={routeKey === item.key ? styles.routeActive : ""}
                  onClick={() => resetForRoute(item.key)}
                  aria-pressed={routeKey === item.key}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {isRunning ? (
            <button type="button" className={styles.traceButton} onClick={() => setIsRunning(false)}>
              <Square size={14} aria-hidden="true" /> Stop trace
            </button>
          ) : (
            <button type="button" className={styles.traceButton} onClick={startTrace}>
              <Play size={15} aria-hidden="true" />
              {isComplete ? "Replay trace" : hasStarted ? "Resume trace" : "Trace request"}
            </button>
          )}
        </div>
      </header>

      <div className={styles.topology}>
        <div className={styles.canvasMeta} aria-hidden="true">
          <span><Activity size={13} /> ARCHITECTURE MAP</span>
          <span>{nodes.length} COMPONENTS</span>
          <span>{edges.length} CONNECTIONS</span>
        </div>

        {(config.domains || []).map((domain) => (
          <div
            key={`${domain.label}-${domain.x}`}
            className={styles.domain}
            style={{ left: `${domain.x}%`, width: `${domain.width}%` }}
          >
            <span>{domain.label}</span>
          </div>
        ))}

        <svg className={styles.edges} viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="architecture-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.edgeArrow} />
            </marker>
            <marker id="architecture-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.edgeArrowActive} />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = nodeMap[edge.from];
            const to = nodeMap[edge.to];
            if (!from || !to) return null;
            const key = edgeKey(edge.from, edge.to);
            const reverseKey = edgeKey(edge.to, edge.from);
            const active = activeEdge === key || activeEdge === reverseKey;
            const complete = completedEdges.has(key) || completedEdges.has(reverseKey);
            const kindClass = EDGE_KIND_CLASSES[edge.kind] || styles.edgeSync;
            return (
              <path
                key={key}
                d={edgePath(from, to)}
                className={`${styles.edge} ${kindClass} ${active ? styles.edgeActive : ""} ${complete ? styles.edgeComplete : ""}`}
                markerEnd={active ? "url(#architecture-arrow-active)" : "url(#architecture-arrow)"}
              />
            );
          })}
          {edges.map((edge) => {
            const from = nodeMap[edge.from];
            const to = nodeMap[edge.to];
            if (!from || !to || !edge.label) return null;
            const position = edgeLabelPosition(from, to);
            return (
              <text key={`${edgeKey(edge.from, edge.to)}-label`} x={position.x} y={position.y} className={styles.edgeLabel}>
                {edge.label}
              </text>
            );
          })}
        </svg>

        <div className={styles.nodes}>
          {nodes.map((node) => {
            const Icon = ICONS[node.icon] || Server;
            const active = hasStarted && currentStep?.nodeId === node.id;
            const visited = hasStarted && visitedNodes.has(node.id);
            const boundedX = Math.min(92, Math.max(8, Number(node.x)));
            return (
              <div key={node.id} className={styles.node} style={{ left: `${boundedX}%`, top: `${node.y}%` }}>
                <button
                  type="button"
                  className={`${styles.nodeButton} ${active ? styles.nodeActive : ""} ${visited ? styles.nodeVisited : ""} ${selectedNode === node.id ? styles.nodeSelected : ""}`}
                  onClick={() => setSelectedNode(node.id)}
                  aria-label={`Inspect ${node.title}`}
                  title={node.title}
                  data-shape={node.shape || "service"}
                >
                  <span className={styles.nodeTopline}>
                    <span className={styles.nodeIcon}><Icon size={14} aria-hidden="true" /></span>
                    <span className={styles.nodeCode}>{node.code}</span>
                  </span>
                  <strong className={styles.nodeTitle}>{node.title}</strong>
                  <span className={styles.nodeLabel}>{node.label}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div className={styles.traceConsole} aria-live="polite">
          <div className={styles.traceProgress} aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className={styles.traceReadout}>
            <span className={styles.traceState}>
              <span className={styles.traceDot} data-running={isRunning ? "true" : "false"} />
              {traceStatus}
            </span>
            <span className={styles.traceId}>{traceId}</span>
            <strong>{hasStarted ? currentStep?.description : "Start the trace to follow this request"}</strong>
            <span className={styles.stepCount}>
              STEP {String(activeStep + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.componentPanel}>
        <div className={styles.componentHeading}>
          <span className={styles.componentIndex}>
            {String(nodes.findIndex((node) => node.id === selected.id) + 1).padStart(2, "0")}
          </span>
          <div>
            <span className={styles.eyebrow}>SELECTED COMPONENT</span>
            <h3>{selected.title}</h3>
          </div>
        </div>
        <div className={styles.componentDetails}>
          <div><span>ROLE</span><p>{selected.responsibility}</p></div>
          <div><span>DATA</span><p>{selected.data}</p></div>
          <div><span>RELIABILITY</span><p>{selected.reliability}</p></div>
        </div>
      </div>
    </section>
  );
}

export default function PlatformArchitectureExperience({ systems = [] }) {
  const activeSystems = useMemo(() => systems.filter((system) => system.active !== false), [systems]);
  const [filter, setFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState(activeSystems[0]?.id || "");
  const filtered = filter === "ALL"
    ? activeSystems
    : activeSystems.filter((system) => system.maturity === filter);
  const selected = activeSystems.find((system) => system.id === selectedId) || filtered[0] || activeSystems[0];

  useEffect(() => {
    if (!selectedId && activeSystems[0]) setSelectedId(activeSystems[0].id);
  }, [activeSystems, selectedId]);

  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((system) => system.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filter, filtered, selectedId]);

  if (!selected) return null;

  return (
    <section id="architecture-trace" className={styles.systemExplorer} aria-labelledby="system-explorer-title">
      <aside className={styles.systemRail}>
        <div className={styles.systemFilters} aria-label="Subsystem maturity">
          {FILTERS.map(([value, label]) => {
            const count = value === "ALL"
              ? activeSystems.length
              : activeSystems.filter((system) => system.maturity === value).length;
            return (
              <button
                key={value}
                type="button"
                className={filter === value ? styles.filterActive : ""}
                onClick={() => setFilter(value)}
              >
                {label} <small>{count}</small>
              </button>
            );
          })}
        </div>

        <div className={styles.systemList}>
          {filtered.map((system, index) => (
            <button
              key={system.id}
              type="button"
              className={`${styles.systemItem} ${system.id === selected.id ? styles.systemItemActive : ""}`}
              onClick={() => setSelectedId(system.id)}
              aria-pressed={system.id === selected.id}
            >
              <span className={styles.systemNumber}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.systemCopy}>
                <strong>{system.title}</strong>
                <small>{system.eyebrow}</small>
              </span>
              <span className={styles.maturity}>{system.maturity === "BUILT" ? "Built" : "System design"}</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      </aside>

      <div className={styles.systemDetail}>
        <div className={styles.systemIntro}>
          <div>
            <span className={styles.systemEyebrow}>{selected.eyebrow}</span>
            <h2 id="system-explorer-title">{selected.title}</h2>
            <p>{selected.summary}</p>
          </div>
          <div className={styles.designIntent}>
            <span>DESIGN INTENT</span>
            <strong>{selected.design_intent || selected.designIntent}</strong>
            {(selected.linked_project_id || selected.linkedProjectId) && (
              <Link href={`/work-single/${selected.linked_project_id || selected.linkedProjectId}`}>
                <a>Open case study <ArrowUpRight size={14} aria-hidden="true" /></a>
              </Link>
            )}
          </div>
        </div>
        <SystemDiagram key={selected.id} system={selected} />
      </div>
    </section>
  );
}
