"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";

const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false,
  loading: () => <CssGlobeFallback />,
});

// Remote textures (no /public needed)
const EARTH_DAY =
  "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const EARTH_BUMP =
  "https://unpkg.com/three-globe/example/img/earth-topology.png";

const DEFAULT_HARDCODE_PINS = [
  { lat: 1.2872, lng: 103.8507, label: "Singapore, SG", weight: 106 },
  { lat: 37.9593, lng: -121.2619, label: "Stockton, CA", weight: 76 },
  { lat: 38.9609, lng: -77.3429, label: "Sterling, VA", weight: 7 },
  { lat: 31.2304, lng: 121.4737, label: "Shanghai, SH", weight: 6 },
  { lat: 37.751, lng: -97.822, label: "US", weight: 37 },
  { lat: 35.8617, lng: 104.1954, label: "CN", weight: 37 },
];

function CssGlobeFallback() {
  return (
    <div className="cssGlobeWrap" aria-hidden="true">
      <div className="cssGlobe">
        <div className="cssSpin">
          <div className="cssTexture" />
          <div className="cssGrid" />
          <div className="cssPins">
            <div className="pin" style={{ left: "65%", top: "44%" }} />
            <div className="pin" style={{ left: "25%", top: "40%" }} />
            <div className="pin" style={{ left: "30%", top: "34%" }} />
            <div className="pin" style={{ left: "70%", top: "50%" }} />
          </div>
        </div>
        <div className="shade" />
        <div className="rim" />
      </div>

      <style jsx>{`
        .cssGlobeWrap {
          width: min(420px, 62vw);
          height: min(420px, 62vw);
          display: grid;
          place-items: center;
        }
        .cssGlobe {
          width: 100%;
          height: 100%;
          border-radius: 999px;
          position: relative;
          overflow: hidden;
          background: radial-gradient(
              circle at 30% 25%,
              rgba(255, 255, 255, 0.18),
              rgba(0, 0, 0, 0) 55%
            ),
            radial-gradient(
              circle at 60% 70%,
              rgba(79, 70, 229, 0.16),
              rgba(0, 0, 0, 0) 55%
            ),
            linear-gradient(180deg, rgba(2, 6, 23, 0.95), rgba(2, 6, 23, 0.55));
          box-shadow: 0 26px 60px rgba(15, 23, 42, 0.35);
        }
        .cssSpin {
          position: absolute;
          inset: -2%;
          border-radius: 999px;
          transform-origin: 50% 50%;
          animation: spin 18s linear infinite;
        }
        .cssTexture {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          opacity: 0.7;
          background: radial-gradient(
              circle at 20% 35%,
              rgba(56, 189, 248, 0.14),
              rgba(0, 0, 0, 0) 60%
            ),
            radial-gradient(
              circle at 75% 65%,
              rgba(34, 197, 94, 0.12),
              rgba(0, 0, 0, 0) 62%
            );
          mix-blend-mode: screen;
        }
        .cssGrid {
          position: absolute;
          inset: -10%;
          border-radius: 999px;
          opacity: 0.2;
          background-image: repeating-linear-gradient(
              0deg,
              rgba(148, 163, 184, 0.16) 0px,
              rgba(148, 163, 184, 0.16) 1px,
              rgba(0, 0, 0, 0) 10px,
              rgba(0, 0, 0, 0) 18px
            ),
            repeating-linear-gradient(
              90deg,
              rgba(148, 163, 184, 0.12) 0px,
              rgba(148, 163, 184, 0.12) 1px,
              rgba(0, 0, 0, 0) 14px,
              rgba(0, 0, 0, 0) 22px
            );
        }
        .cssPins {
          position: absolute;
          inset: 0;
          border-radius: 999px;
        }
        .pin {
          position: absolute;
          transform: translate(-50%, -50%);
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: rgba(249, 115, 22, 0.95);
          box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.45),
            0 14px 20px rgba(0, 0, 0, 0.35);
        }
        .shade {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: radial-gradient(
              circle at 20% 25%,
              rgba(0, 0, 0, 0) 40%,
              rgba(0, 0, 0, 0.55) 78%
            ),
            radial-gradient(
              circle at 75% 70%,
              rgba(0, 0, 0, 0) 35%,
              rgba(0, 0, 0, 0.45) 75%
            );
          pointer-events: none;
        }
        .rim {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          pointer-events: none;
        }
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

export default function RotatingGlobe({ pins = [] }) {
  const wrapRef = useRef(null);
  const globeRef = useRef(null);
  const [size, setSize] = useState({ w: 420, h: 420 });

  const safePins = useMemo(() => {
    const arr = Array.isArray(pins) ? pins : [];
    if (!arr.length) return DEFAULT_HARDCODE_PINS;

    return arr
      .map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        label: p.label || "",
        weight: Number(p.weight || 1),
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }, [pins]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries?.[0]?.contentRect;
      if (!r) return;
      const w = Math.max(260, Math.floor(r.width));
      const h = Math.max(260, Math.floor(r.height));
      setSize({ w, h });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const configureGlobe = useCallback(() => {
    const g = globeRef.current;
    if (!g) return;

    // ✅ Compatibility: controls can be a function OR an object (depends on react-globe.gl version)
    const controls =
      typeof g.controls === "function" ? g.controls() : g.controls;

    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.7;
      controls.enableZoom = true;
      controls.enablePan = false;
      controls.minDistance = 170;
      controls.maxDistance = 820;
      controls.zoomSpeed = 0.6;
      // optional: keep user interaction smooth
      if (typeof controls.update === "function") controls.update();
    }

    // pointOfView also may not exist immediately in some builds
    if (typeof g.pointOfView === "function") {
      g.pointOfView({ lat: 20, lng: -30, altitude: 2.2 }, 0);
    }
  }, []);

  // run after render/resize
  useEffect(() => {
    configureGlobe();
  }, [size.w, size.h, configureGlobe]);

  // Apple-map-ish pin DOM element
  const makePinEl = (d) => {
    const el = document.createElement("div");
    el.className = "globePin";
    el.title = d.label || "";
    el.innerHTML = `<span class="head"></span><span class="stem"></span>`;
    return el;
  };

  return (
    <div ref={wrapRef} className="globeWrap">
      <Globe
        ref={globeRef}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl={EARTH_DAY}
        bumpImageUrl={EARTH_BUMP}
        showAtmosphere={true}
        atmosphereAltitude={0.18}
        htmlElementsData={safePins}
        htmlLat={(d) => d.lat}
        htmlLng={(d) => d.lng}
        htmlAltitude={() => 0.02}
        htmlElement={makePinEl}
        // ✅ IMPORTANT: set controls only when globe is ready
        onGlobeReady={configureGlobe}
      />

      <style jsx>{`
        .globeWrap {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
        }
      `}</style>

      <style jsx global>{`
        .globePin {
          transform: translate(-50%, -100%);
          filter: drop-shadow(0 12px 18px rgba(0, 0, 0, 0.35));
          pointer-events: none;
        }
        .globePin .head {
          width: 14px;
          height: 14px;
          display: block;
          border-radius: 999px;
          background: rgba(249, 115, 22, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.55);
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.08);
        }
        .globePin .stem {
          width: 3px;
          height: 18px;
          display: block;
          margin: -2px auto 0;
          border-radius: 999px;
          background: linear-gradient(
            180deg,
            rgba(249, 115, 22, 0.95),
            rgba(249, 115, 22, 0.35)
          );
        }
      `}</style>
    </div>
  );
}
