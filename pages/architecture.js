import { ExternalLink, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import SeoHead from "../src/components/SeoHead";
import ArchitectureTimeMachine from "../src/components/ArchitectureTimeMachine";
import styles from "../src/components/ArchitectureViewer.module.css";
import sequences from "../docs/architecture/platform-sequences.json";
import evolution from "../docs/architecture/platform-evolution.json";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

const VIEWS = [
  { id: "container", label: "System overview", hint: "How the systems connect, then one lane per system" },
  { id: "flows", label: "Data flows", hint: "UML 2 sequence diagram per workflow" },
  { id: "topology", label: "Detailed topology", hint: "Every service, topic and state store" },
  { id: "evolution", label: "Time machine", hint: "How it grew, decision by decision" },
];

const FLOWS = sequences.sequences;

function readHash() {
  if (typeof window === "undefined") return { view: "container", flow: FLOWS[0]?.key, step: undefined };
  const [view, detail] = window.location.hash.replace(/^#/, "").split("/");
  const known = VIEWS.some((item) => item.id === view);
  const flowKnown = FLOWS.some((item) => item.key === detail);
  return {
    view: known ? view : "container",
    flow: view === "flows" && flowKnown ? detail : FLOWS[0]?.key,
    step: view === "evolution" && evolution.milestones.some((item) => item.id === detail) ? detail : undefined,
  };
}

export default function ArchitectureViewerPage() {
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState("container");
  const [flowKey, setFlowKey] = useState(FLOWS[0]?.key);
  const [step, setStep] = useState(undefined);

  useEffect(() => {
    const sync = () => {
      const state = readHash();
      setView(state.view);
      setFlowKey(state.flow);
      setStep(state.step);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const select = useCallback((nextView, nextFlow) => {
    setView(nextView);
    if (nextFlow) setFlowKey(nextFlow);
    setZoom(1);
    const hash = nextView === "flows" ? `#flows/${nextFlow || flowKey}` : nextView === "evolution" && step ? `#evolution/${step}` : `#${nextView}`;
    window.history.replaceState(null, "", hash);
  }, [flowKey, step]);

  // The time machine reports each step so a link can open the same milestone.
  const showStep = useCallback((id) => {
    setStep(id);
    window.history.replaceState(null, "", `#evolution/${id}`);
  }, []);

  const updateZoom = useCallback((next) => {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  }, []);

  const scenario = FLOWS.find((item) => item.key === flowKey) || FLOWS[0];

  const diagram = useMemo(() => {
    if (view === "topology") {
      return { src: "/api/architecture/platform-diagram", alt: "Detailed service topology, event streams and state stores" };
    }
    if (view === "flows" && scenario) {
      return { src: `/diagrams/flow-${scenario.key}.svg`, alt: `${scenario.title}: UML sequence diagram` };
    }
    return { src: "/diagrams/overview.svg", alt: "Portfolio platform system architecture: a map of how Ask AI, content publishing, notifications, visitor analytics and the MCP tools connect, then one lane per system from the Next.js UI to Cloud Run and its data, plus the Kubernetes exit path" };
  }, [view, scenario]);


  return (
    <>
      <SeoHead
        title="System Design — Portfolio Microservice Platform"
        description="System overview, UML 2 sequence diagrams, the full service topology and an architecture time machine of yuqi.site: API gateway (BFF), Cloud Run services with a Kubernetes exit path, Kafka event backbone, transactional outbox, CQRS read model, idempotent consumers and RAG."
        url="/architecture"
      />
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>SYSTEM DESIGN</span>
            <h1>Portfolio Microservice Platform</h1>
            <p>
              A Next.js edge on Vercel, services on Cloud Run and a Kafka event backbone. Switch between the system
              overview, the UML sequence diagram of each workflow, the full service topology and a time machine of
              how it grew.
            </p>
          </div>
          {view !== "evolution" && <div className={styles.controls} aria-label="Diagram zoom controls">
            <button type="button" onClick={() => updateZoom(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out">
              <Minus size={18} />
            </button>
            <output aria-live="polite">{Math.round(zoom * 100)}%</output>
            <button type="button" onClick={() => updateZoom(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in">
              <Plus size={18} />
            </button>
            <button type="button" className={styles.textButton} onClick={() => setZoom(1)} title="Fit diagram">
              <Maximize2 size={17} /> Fit
            </button>
            <a href={diagram.src} target="_blank" rel="noreferrer" title="Open this diagram as SVG">
              <ExternalLink size={17} /> SVG
            </a>
          </div>}
        </header>

        <nav className={styles.tabs} aria-label="Architecture views">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? styles.tabActive : styles.tab}
              aria-pressed={view === item.id}
              onClick={() => select(item.id, item.id === "flows" ? flowKey : undefined)}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </nav>

        {view === "flows" && (
          <div className={styles.flowPicker} role="group" aria-label="Workflows">
            {FLOWS.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={item.key === scenario?.key ? styles.flowActive : styles.flow}
                aria-pressed={item.key === scenario?.key}
                onClick={() => select("flows", item.key)}
              >
                {CIRCLED[index] || `${index + 1}.`} {item.title}
              </button>
            ))}
          </div>
        )}

        {view === "evolution" ? (
          <ArchitectureTimeMachine data={evolution} initialId={step} onChange={showStep} />
        ) : (
          <>
            <section className={styles.viewport} aria-label="Zoomable architecture diagram">
              <div className={styles.canvas} style={{ width: `${zoom * 100}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static SVG diagrams, zoomed by width */}
                <img key={diagram.src} src={diagram.src} alt={diagram.alt} />
              </div>
            </section>

            <footer className={styles.footer}>
              <span>50%–250% zoom · diagrams are generated from the same JSON as the README</span>
              <button type="button" onClick={() => setZoom(1)}><RotateCcw size={15} /> Reset view</button>
            </footer>
          </>
        )}
      </main>
    </>
  );
}

ArchitectureViewerPage.hasCustomSeo = true;
