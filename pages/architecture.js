import Head from "next/head";
import { ExternalLink, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import styles from "../src/components/ArchitectureViewer.module.css";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

export default function ArchitectureViewerPage() {
  const [zoom, setZoom] = useState(1);

  const updateZoom = useCallback((next) => {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  }, []);

  return (
    <>
      <Head>
        <title>Portfolio Platform Architecture | Yuqi Guo</title>
        <meta
          name="description"
          content="Interactive, zoomable system design for the yuqi.site microservice platform."
        />
      </Head>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>SYSTEM DESIGN</span>
            <h1>Portfolio Microservice Platform</h1>
            <p>Inspect service ownership, synchronous calls, Kafka streams, state stores, replay paths and operational controls.</p>
          </div>
          <div className={styles.controls} aria-label="Architecture zoom controls">
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
            <a href="/api/architecture/platform-diagram" target="_blank" rel="noreferrer" title="Open original SVG">
              <ExternalLink size={17} /> SVG
            </a>
          </div>
        </header>

        <section className={styles.viewport} aria-label="Zoomable portfolio architecture diagram">
          <div className={styles.canvas} style={{ width: `${zoom * 100}%` }}>
            <img src="/api/architecture/platform-diagram" alt="Portfolio microservice platform architecture" />
          </div>
        </section>

        <footer className={styles.footer}>
          <span>50%–250% zoom</span>
          <button type="button" onClick={() => setZoom(1)}><RotateCcw size={15} /> Reset view</button>
        </footer>
      </main>
    </>
  );
}
