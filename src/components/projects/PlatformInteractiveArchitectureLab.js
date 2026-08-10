import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Server,
  Square,
  Workflow,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import topology from "../../../docs/architecture/platform-system-flow.json";
import labConfig from "../../../docs/architecture/platform-interactive-lab.json";
import styles from "./PlatformInteractiveArchitectureLab.module.css";

const MIN_ZOOM = 0.72;
const MAX_ZOOM = 2.15;
const BASE_STEP_MS = 1180;

const OPERATION_LABELS = {
  client: "CLIENT EVENT",
  compute: "COMPUTE",
  http: "HTTP / SSE",
  kafka: "KAFKA EVENT",
  model: "MODEL CALL",
  provider: "PROVIDER CALL",
  read: "DATA READ",
  request: "REQUEST",
  response: "RESPONSE",
  stream: "STREAM",
  write: "DATA WRITE",
};

function centerOf(node) {
  return {
    x: Number(node.x) + Number(node.w || 180) / 2,
    y: Number(node.y) + Number(node.h || 100) / 2,
  };
}

function connectionPath(fromNode, toNode) {
  const from = centerOf(fromNode);
  const to = centerOf(toNode);
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const horizontal = Math.abs(deltaX) >= Math.abs(deltaY);

  if (horizontal) {
    const direction = deltaX >= 0 ? 1 : -1;
    const startX = from.x + direction * Number(fromNode.w || 180) * 0.42;
    const endX = to.x - direction * Number(toNode.w || 180) * 0.42;
    const bend = Math.max(90, Math.abs(endX - startX) * 0.42);
    return `M ${startX} ${from.y} C ${startX + direction * bend} ${from.y}, ${endX - direction * bend} ${to.y}, ${endX} ${to.y}`;
  }

  const direction = deltaY >= 0 ? 1 : -1;
  const startY = from.y + direction * Number(fromNode.h || 100) * 0.42;
  const endY = to.y - direction * Number(toNode.h || 100) * 0.42;
  const bend = Math.max(80, Math.abs(endY - startY) * 0.4);
  return `M ${from.x} ${startY} C ${from.x} ${startY + direction * bend}, ${to.x} ${endY - direction * bend}, ${to.x} ${endY}`;
}

function formatLatency(value) {
  if (!Number.isFinite(value)) return "N/A";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
}

function connectedInterfaces(nodeId) {
  return topology.edges
    .filter((edge) => edge.from === nodeId || edge.to === nodeId)
    .map((edge) => edge.label)
    .filter(Boolean);
}

function derivedMetadata(node) {
  const configured = labConfig.componentMetadata[node.id] || {};
  const members = Array.isArray(node.members) ? node.members : [];
  const details = Array.isArray(node.details) ? node.details : [];
  const resources = Array.isArray(node.resources)
    ? node.resources.map((resource) => `${resource.title}: ${resource.meta}`)
    : [];

  return {
    responsibility: configured.responsibility
      || details.join(". ")
      || (members.length > 0 ? `Owns ${members.join(", ")}.` : `${node.title} participates in the platform request path.`),
    interfaces: configured.interfaces || connectedInterfaces(node.id),
    state: resources,
    reliability: configured.reliability || [
      node.shape === "queue" ? "At-least-once delivery boundary" : "Bounded service responsibility",
      node.shape === "queue" ? "Replayable consumer offset" : "Observable request outcome",
    ],
  };
}

function scenarioEdges(scenario) {
  return scenario.steps
    .filter((step) => step.from && step.to)
    .map((step, index) => ({
      ...step,
      key: `${scenario.key}-${step.from}-${step.to}-${index}`,
      fromNode: topology.nodes.find((node) => node.id === step.from),
      toNode: topology.nodes.find((node) => node.id === step.to),
    }))
    .filter((edge) => edge.fromNode && edge.toNode)
    .map((edge) => ({ ...edge, path: connectionPath(edge.fromNode, edge.toNode) }));
}

function systemScenario(scenarios, subsystemIndex) {
  return scenarios.find((item) => Number(item.subsystemIndex) === subsystemIndex);
}

export default function PlatformInteractiveArchitectureLab({ systems = [] }) {
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const [scenarioKey, setScenarioKey] = useState(labConfig.defaultScenario);
  const [activeStep, setActiveStep] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(0.42);
  const [selectedNodeId, setSelectedNodeId] = useState("");

  const activeSystems = useMemo(
    () => systems.filter((system) => system.active !== false),
    [systems]
  );

  const scenario = labConfig.scenarios.find((item) => item.key === scenarioKey)
    || labConfig.scenarios[0];
  const selectedSystem = activeSystems[Number(scenario.subsystemIndex)] || activeSystems[0] || null;
  const steps = scenario.steps;
  const currentStep = steps[activeStep] || steps[0];
  const isComplete = hasStarted && activeStep === steps.length - 1 && !isRunning;
  const scale = fitScale * zoom;
  const totalLatency = steps.reduce((sum, step) => sum + Number(step.latencyMs || 0), 0);
  const elapsedLatency = hasStarted
    ? steps.slice(0, activeStep + 1).reduce((sum, step) => sum + Number(step.latencyMs || 0), 0)
    : 0;
  const routeNodeIds = useMemo(
    () => new Set(steps.map((step) => step.nodeId)),
    [steps]
  );
  const edges = useMemo(() => scenarioEdges(scenario), [scenario]);
  const activeConnectionIndex = activeStep > 0
    ? edges.findIndex((edge) => edge.from === currentStep.from && edge.to === currentStep.to)
    : -1;
  const selectedNode = topology.nodes.find((node) => node.id === selectedNodeId)
    || topology.nodes.find((node) => node.id === currentStep.nodeId)
    || topology.nodes[0];
  const selectedMetadata = derivedMetadata(selectedNode);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const updateFit = () => {
      const availableWidth = Math.max(320, viewport.clientWidth - 2);
      setFitScale(Math.min(1, availableWidth / topology.width));
    };
    updateFit();
    const observer = new ResizeObserver(updateFit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setActiveStep(0);
    setHasStarted(false);
    setIsRunning(false);
    setSelectedNodeId(scenario.steps[0]?.nodeId || "");
  }, [scenario]);

  useEffect(() => {
    if (!isRunning) return undefined;
    if (activeStep >= steps.length - 1) {
      setIsRunning(false);
      return undefined;
    }
    const timeout = window.setTimeout(
      () => setActiveStep((step) => Math.min(step + 1, steps.length - 1)),
      BASE_STEP_MS / speed
    );
    return () => window.clearTimeout(timeout);
  }, [activeStep, isRunning, speed, steps.length]);

  useEffect(() => {
    if (hasStarted && currentStep?.nodeId) setSelectedNodeId(currentStep.nodeId);
  }, [currentStep?.nodeId, hasStarted]);

  const startTrace = () => {
    if (isComplete || !hasStarted) setActiveStep(0);
    setHasStarted(true);
    setIsRunning(true);
  };

  const replayTrace = () => {
    setActiveStep(0);
    setHasStarted(true);
    setIsRunning(true);
  };

  const resetView = () => {
    setZoom(1);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  };

  const selectSystem = (index) => {
    const nextScenario = systemScenario(labConfig.scenarios, index);
    if (nextScenario) setScenarioKey(nextScenario.key);
  };

  const beginDrag = (event) => {
    if (event.button !== 0 || !viewportRef.current) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewportRef.current.scrollLeft,
      top: viewportRef.current.scrollTop,
    };
    viewportRef.current.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event) => {
    if (!dragRef.current || !viewportRef.current) return;
    viewportRef.current.scrollLeft = dragRef.current.left - (event.clientX - dragRef.current.x);
    viewportRef.current.scrollTop = dragRef.current.top - (event.clientY - dragRef.current.y);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <section className={styles.lab} aria-labelledby="architecture-lab-title">
      <header className={styles.labHeader}>
        <div>
          <span className={styles.eyebrow}>VIEWER LAB / READ-ONLY</span>
          <h2 id="architecture-lab-title">{labConfig.title}</h2>
          <p>{labConfig.description}</p>
        </div>
        <div className={styles.labSummary}>
          <span><Server size={15} /> {topology.nodes.length} components</span>
          <span><Workflow size={15} /> {topology.edges.length} connections</span>
          <span><Gauge size={15} /> simulated latency</span>
        </div>
      </header>

      {activeSystems.length > 0 && (
        <section className={styles.systemNavigator} aria-label="Platform subsystems">
          <header className={styles.systemNavigatorHeader}>
            <div>
              <span>PLATFORM SUBSYSTEMS</span>
              <strong>Built {activeSystems.filter((system) => system.maturity === "BUILT").length}</strong>
              <small>System design {activeSystems.filter((system) => system.maturity !== "BUILT").length}</small>
            </div>
            {selectedSystem && (
              <p>{selectedSystem.summary}</p>
            )}
          </header>
          <div className={styles.systemList}>
            {activeSystems.map((system, index) => {
              const selected = system.id === selectedSystem?.id;
              return (
                <button
                  key={system.id}
                  type="button"
                  className={selected ? styles.systemActive : ""}
                  onClick={() => selectSystem(index)}
                  aria-pressed={selected}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{system.title}</strong>
                    <small>{system.eyebrow}</small>
                  </div>
                  <em>{system.maturity === "BUILT" ? "Built" : "Design"}</em>
                </button>
              );
            })}
          </div>
          {selectedSystem && (
            <div className={styles.systemIntent}>
              <span>DESIGN INTENT</span>
              <strong>{selectedSystem.design_intent || selectedSystem.designIntent}</strong>
              {(selectedSystem.linked_project_id || selectedSystem.linkedProjectId) && (
                <Link href={`/work-single/${selectedSystem.linked_project_id || selectedSystem.linkedProjectId}`}>
                  <a>Open subsystem <ArrowUpRight size={13} /></a>
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      <div className={styles.scenarioBar}>
        <label htmlFor="architecture-scenario">Scenario</label>
        <select
          id="architecture-scenario"
          value={scenarioKey}
          onChange={(event) => setScenarioKey(event.target.value)}
        >
          {labConfig.scenarios.map((item) => (
            <option key={item.key} value={item.key}>{item.label}</option>
          ))}
        </select>
        <div className={styles.scenarioTabs} aria-label="Architecture scenarios">
          {labConfig.scenarios.map((item) => (
            <button
              key={item.key}
              type="button"
              className={scenarioKey === item.key ? styles.scenarioActive : ""}
              onClick={() => setScenarioKey(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.commandBar}>
        <div className={styles.primaryControls}>
          {isRunning ? (
            <button type="button" className={styles.primaryButton} onClick={() => setIsRunning(false)}>
              <Square size={15} /> Stop trace
            </button>
          ) : (
            <button type="button" className={styles.primaryButton} onClick={startTrace}>
              <Play size={15} />
              {isComplete ? "Run again" : hasStarted ? "Resume" : "Run trace"}
            </button>
          )}
          <button type="button" className={styles.iconButton} onClick={replayTrace} title="Replay trace" aria-label="Replay trace">
            <RotateCcw size={16} />
          </button>
          <div className={styles.speedControl}>
            <span>Speed</span>
            {[0.75, 1, 1.5].map((value) => (
              <button
                key={value}
                type="button"
                data-active={speed === value ? "true" : "false"}
                onClick={() => setSpeed(value)}
              >
                {value}x
              </button>
            ))}
          </div>
        </div>
        <div className={styles.viewControls}>
          <button type="button" className={styles.iconButton} onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - 0.16))} title="Zoom out" aria-label="Zoom out">
            <ZoomOut size={16} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className={styles.iconButton} onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 0.16))} title="Zoom in" aria-label="Zoom in">
            <ZoomIn size={16} />
          </button>
          <button type="button" className={styles.iconButton} onClick={resetView} title="Fit architecture" aria-label="Fit architecture">
            <Maximize2 size={16} />
          </button>
        </div>
      </div>

      <div className={styles.scenarioIntro}>
        <div>
          <span>{scenario.label}</span>
          <p>{scenario.summary}</p>
        </div>
        <dl>
          <div><dt>Stages</dt><dd>{steps.length}</dd></div>
          <div><dt>Services</dt><dd>{routeNodeIds.size}</dd></div>
          <div><dt>Expected</dt><dd>{formatLatency(totalLatency)}</dd></div>
        </dl>
      </div>

      <div
        ref={viewportRef}
        className={styles.viewport}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <div
          className={styles.scaledSurface}
          style={{ width: topology.width * scale, height: topology.height * scale }}
        >
          <div
            className={`${styles.canvas} ${hasStarted ? styles.canvasFocused : ""}`}
            style={{
              width: topology.width,
              height: topology.height,
              transform: `scale(${scale})`,
            }}
          >
            <img
              src="/api/architecture/platform-diagram"
              alt="Portfolio microservice platform architecture"
              width={topology.width}
              height={topology.height}
              draggable="false"
              className={styles.diagramImage}
            />

            <svg className={styles.traceLayer} viewBox={`0 0 ${topology.width} ${topology.height}`} aria-hidden="true">
              <defs>
                <filter id="lab-packet-glow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="7" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              {edges.map((edge, index) => {
                const complete = hasStarted && index < activeConnectionIndex;
                const active = hasStarted && index === activeConnectionIndex;
                return (
                  <path
                    key={edge.key}
                    d={edge.path}
                    className={`${styles.tracePath} ${complete ? styles.tracePathComplete : ""} ${active ? styles.tracePathActive : ""}`}
                  />
                );
              })}
              {isRunning && activeConnectionIndex >= 0 && edges[activeConnectionIndex] && (
                <g key={`${scenario.key}-${activeStep}`} filter="url(#lab-packet-glow)">
                  <circle r="11" className={styles.packetHalo} />
                  <circle r="5" className={styles.packetCore} />
                  <animateMotion dur={`${BASE_STEP_MS / speed}ms`} fill="freeze" path={edges[activeConnectionIndex].path} />
                </g>
              )}
            </svg>

            {topology.nodes.map((node) => {
              const active = hasStarted && currentStep.nodeId === node.id;
              const selected = selectedNode.id === node.id;
              const relevant = routeNodeIds.has(node.id);
              const visitedIndex = steps.findIndex((step) => step.nodeId === node.id);
              const visited = hasStarted && visitedIndex >= 0 && visitedIndex < activeStep;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`${styles.hotspot} ${relevant ? styles.hotspotRelevant : ""} ${visited ? styles.hotspotVisited : ""} ${active ? styles.hotspotActive : ""} ${selected ? styles.hotspotSelected : ""}`}
                  style={{ left: node.x, top: node.y, width: node.w || 180, height: node.h || 100 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedNodeId(node.id);
                  }}
                  aria-label={`Inspect ${node.title}`}
                >
                  {active && (
                    <span className={styles.activeBadge}>
                      {currentStep.dataAction || currentStep.cache || OPERATION_LABELS[currentStep.operation]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.liveReadout} aria-live="polite">
        <div className={styles.liveState} data-running={isRunning ? "true" : "false"}>
          {isRunning ? <Activity size={16} /> : isComplete ? <CheckCircle2 size={16} /> : <Pause size={16} />}
          <span>{isRunning ? "RUNNING" : isComplete ? "COMPLETE" : hasStarted ? "PAUSED" : "READY"}</span>
        </div>
        <div className={styles.liveCopy}>
          <span>STEP {String(activeStep + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span>
          <strong>{hasStarted ? currentStep.label : "Select a scenario and run the trace"}</strong>
          <p>{hasStarted ? currentStep.detail : scenario.summary}</p>
        </div>
        <div className={styles.liveMetrics}>
          <div><Clock3 size={14} /><span>Step</span><strong>{hasStarted ? formatLatency(currentStep.latencyMs) : "--"}</strong></div>
          <div><Gauge size={14} /><span>Elapsed</span><strong>{hasStarted ? formatLatency(elapsedLatency) : "--"}</strong></div>
          <div><Database size={14} /><span>State</span><strong>{currentStep.dataAction || currentStep.cache || "No mutation"}</strong></div>
        </div>
      </div>

      <div className={styles.detailGrid}>
        <aside className={styles.executionPlan} aria-label={`${scenario.label} execution plan`}>
          <div className={styles.panelHeading}>
            <span>EXECUTION PLAN</span>
            <small>{scenario.result}</small>
          </div>
          <ol>
            {steps.map((step, index) => {
              const state = hasStarted
                ? index < activeStep ? "complete" : index === activeStep ? "active" : "pending"
                : "pending";
              return (
                <li key={`${scenario.key}-${step.nodeId}-${index}`} data-state={state}>
                  <button type="button" onClick={() => setSelectedNodeId(step.nodeId)}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{step.label}</strong><small>{formatLatency(step.latencyMs)}</small></div>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <aside className={styles.inspector} aria-label="Architecture component inspector">
          <div className={styles.panelHeading}>
            <span>COMPONENT INSPECTOR</span>
            <small>{selectedNode.meta || selectedNode.shape || "platform component"}</small>
          </div>
          <div className={styles.inspectorTitle}>
            <span><Server size={17} /></span>
            <div><small>{selectedNode.id}</small><h3>{selectedNode.title}</h3></div>
          </div>
          <p className={styles.responsibility}>{selectedMetadata.responsibility}</p>
          <div className={styles.inspectorSections}>
            <section>
              <h4>Interfaces</h4>
              <ul>{selectedMetadata.interfaces.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section>
              <h4>State ownership</h4>
              <ul>{(selectedMetadata.state.length ? selectedMetadata.state : ["Stateless or state delegated to an owning service"]).map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section>
              <h4>Reliability</h4>
              <ul>{selectedMetadata.reliability.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          </div>
          <div className={styles.observabilityLinks}>
            {labConfig.observability.map((item) => (
              <a key={item.label} href={item.url} target="_blank" rel="noreferrer">
                {item.label} <ArrowUpRight size={13} />
              </a>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
