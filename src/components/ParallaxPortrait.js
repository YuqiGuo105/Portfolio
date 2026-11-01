"use client";

import { useEffect, useRef, useState } from "react";

// The hero portrait as a 2.5D scene: the beach/sky background and the figure are separate layers
// (public/assets/images/profile-bg-*, profile-person-*). Tilting the phone, or moving the mouse on a
// computer, turns the oval slightly and slides the far beach and sky behind him, like looking past him
// at the sea. The scene pivots on the line where his boots meet the sand, so he stays standing on it.
// Everything is CSS transforms on two images — no WebGL; the loop only runs while the view moves, and
// once it settles back to centre the transforms are removed so the resting portrait is pixel-sharp.

// Turn of the whole oval. On a large desktop oval a 6° turn magnified the near side enough to read as
// a zoom, so the mouse gets a gentler turn and a longer perspective; the layer parallax carries depth.
const TURN = { touch: { deg: 6, perspective: 1100 }, pointer: { deg: 3.5, perspective: 1800 } };
const SKEW_DEG = 2.5; // background shear: zero at his feet, growing towards the horizon and sky
const LIFT = 0.03; // vertical stretch of the background about his feet (horizon rises / falls)
// Background-only headroom so the sheared background never shows an edge. The figure is not scaled:
// it does not move, and scaling it about his feet would push his head out of the top of the oval.
const SCALE = 1.08;
// The theme's hero slot (~0.73 wide:tall) is squatter than the 2:3 art, so the art is cropped. Crop
// only the sky (anchor the bottom), or his boots end up on the oval's lower edge with no sand under
// him and he seems to float.
const CROP = "50% 100%";
// Where his boots touch the sand, in % of the frame: the person layer ends at 93% of the art, which
// that bottom-anchored crop puts at about 92.5% of the slot. Both layers pivot here.
const GROUND = "50% 92%";
// Touch devices follow the device tilt; everything else follows the mouse.
const TOUCH_MEDIA = "(hover: none), (pointer: coarse)";
const TILT_RANGE = 18; // degrees of phone tilt for a full swing
const EASE = 0.12; // share of the remaining distance covered per frame

const clamp = (v) => Math.max(-1, Math.min(1, v));

export default function ParallaxPortrait({ border = "0", radius = 380, alt }) {
  const frameRef = useRef(null);
  const bgRef = useRef(null);
  const fgRef = useRef(null);
  const [needsMotionPermission, setNeedsMotionPermission] = useState(false);
  const [motionOn, setMotionOn] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const touch = !!window.matchMedia?.(TOUCH_MEDIA).matches;
    const turn = touch ? TURN.touch : TURN.pointer;
    // With "Reduce Motion" on, the view still follows the visitor's own tilt (it never moves by
    // itself), at half strength — the visitor's hand drives it, so nothing animates unasked.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const amp = reduce ? 0.5 : 1;

    // ?tiltdebug shows what the browser reports, to diagnose phones we cannot test on.
    const debugBox = /[?&]tiltdebug\b/.test(window.location.search) ? document.createElement("pre") : null;
    const dbg = { reduce: !!reduce, permission: "-", events: 0, beta: null, gamma: null };
    const showDebug = () => {
      if (!debugBox) return;
      debugBox.textContent = Object.entries(dbg).map(([k, v]) => `${k}: ${typeof v === "number" ? Math.round(v * 10) / 10 : v}`).join("\n");
    };
    if (debugBox) {
      Object.assign(debugBox.style, { position: "fixed", left: "8px", top: "8px", zIndex: 99999, margin: 0, padding: "8px 10px", font: "12px/1.4 ui-monospace,monospace", color: "#fff", background: "rgba(0,0,0,0.75)", borderRadius: "8px", pointerEvents: "none" });
      document.body.appendChild(debugBox);
    }

    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let raf = 0;
    let visible = true;
    let baseline = null;

    const apply = () => {
      const x = current.x * amp;
      const y = current.y * amp;
      frame.style.transform = `perspective(${turn.perspective}px) rotateY(${(x * turn.deg).toFixed(2)}deg) rotateX(${(-y * turn.deg).toFixed(2)}deg)`;
      // Shear about the ground line: the sand under his boots stays put, the horizon and sky slide.
      if (bgRef.current) bgRef.current.style.transform = `skewX(${(x * SKEW_DEG).toFixed(3)}deg) scale(${SCALE}, ${(SCALE * (1 + y * LIFT)).toFixed(4)})`;
    };

    const step = () => {
      current.x += (target.x - current.x) * EASE;
      current.y += (target.y - current.y) * EASE;
      apply();
      const settled = Math.abs(target.x - current.x) < 0.001 && Math.abs(target.y - current.y) < 0.001;
      // Back at centre: drop the 3D transform entirely so the browser draws the portrait sharp again.
      if (settled && Math.abs(current.x) < 0.002 && Math.abs(current.y) < 0.002) {
        current.x = 0; current.y = 0;
        frame.style.transform = "";
        if (bgRef.current) bgRef.current.style.transform = "";
      }
      raf = settled || !visible ? 0 : requestAnimationFrame(step);
    };
    const kick = () => {
      if (!raf && visible) raf = requestAnimationFrame(step);
    };

    // Mouse: the view turns toward the pointer anywhere on the page, measured from the portrait's centre
    // over a wide range, so moving onto the portrait eases into the turn instead of snapping to a full one.
    const onPointerMove = (e) => {
      if (e.pointerType === "touch") return;
      const r = frame.getBoundingClientRect();
      target.x = clamp((e.clientX - (r.left + r.width / 2)) / Math.max(r.width * 0.75, window.innerWidth * 0.3));
      target.y = clamp((e.clientY - (r.top + r.height / 2)) / Math.max(r.height * 0.7, window.innerHeight * 0.5));
      kick();
    };
    // Pointer left the window (or the window lost focus): ease back to centre.
    const recentre = () => { target.x = 0; target.y = 0; kick(); };
    const onMouseOut = (e) => { if (!e.relatedTarget) recentre(); };

    // Phone tilt: relative to how the phone was held when the page started listening, with the
    // reference drifting slowly so any comfortable holding angle becomes the neutral view.
    const onOrientation = (e) => {
      dbg.events += 1;
      dbg.beta = e.beta;
      dbg.gamma = e.gamma;
      showDebug();
      // Laptops with motion sensors also fire this; on a computer the mouse drives the view.
      if (!touch || e.beta == null || e.gamma == null) return;
      if (!baseline) baseline = { beta: e.beta, gamma: e.gamma };
      baseline.beta += (e.beta - baseline.beta) * 0.01;
      baseline.gamma += (e.gamma - baseline.gamma) * 0.01;
      target.x = clamp((e.gamma - baseline.gamma) / TILT_RANGE);
      target.y = clamp((e.beta - baseline.beta) / TILT_RANGE);
      kick();
    };

    // Nothing to do while the portrait is off screen.
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) kick(); })
      : null;
    io?.observe(frame);

    if (!touch) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("mouseout", onMouseOut, { passive: true });
      window.addEventListener("blur", recentre);
    }

    // Listen straight away (Android delivers tilt without asking). Only if no reading arrives and the
    // browser offers requestPermission (iOS Safari and Chrome) show the opt-in button.
    const DOE = window.DeviceOrientationEvent;
    let gotReading = false;
    const onFirstOrientation = (e) => {
      if (e.beta == null) return;
      gotReading = true;
      setMotionOn(true);
    };
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    window.addEventListener("deviceorientation", onFirstOrientation, { passive: true, once: true });
    const mustAsk = touch && DOE && typeof DOE.requestPermission === "function";
    Object.assign(dbg, { coarse: !!touch, hasDOE: !!DOE, needsPermission: !!mustAsk, secure: window.isSecureContext });
    showDebug();
    let asking = false;
    let answered = false;
    const ask = async () => {
      if (asking || answered || gotReading) return;
      asking = true;
      try {
        // Resolves "granted" or "denied" once the visitor answers.
        dbg.permission = await DOE.requestPermission();
        answered = true;
        document.removeEventListener("touchend", ask);
        document.removeEventListener("click", ask);
        setNeedsMotionPermission(false);
      } catch (err) {
        // Not counted as a gesture (e.g. the touch was a scroll): the next tap asks again.
        dbg.permission = `error: ${err?.name || err}`;
      }
      showDebug();
      asking = false;
    };
    const askTimer = setTimeout(() => {
      if (mustAsk && !gotReading) setNeedsMotionPermission(true);
    }, 1200);
    // iOS (Safari and Chrome alike) only grants motion access from a user gesture: a tap anywhere on
    // the page asks until the visitor answers; the button is the visible way to do the same.
    if (mustAsk) {
      document.addEventListener("touchend", ask, { passive: true });
      document.addEventListener("click", ask, { passive: true });
    }
    frame.__enableMotion = ask;

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(askTimer);
      document.removeEventListener("touchend", ask);
      document.removeEventListener("click", ask);
      debugBox?.remove();
      window.removeEventListener("deviceorientation", onFirstOrientation);
      io?.disconnect();
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("blur", recentre);
      delete frame.__enableMotion;
    };
  }, []);

  const layer = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: CROP,
    transformOrigin: GROUND,
    pointerEvents: "none",
    userSelect: "none",
  };

  return (
    <div
      ref={frameRef}
      className="pp-frame"
      style={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        // Fill the hero slot like the old single image did (the theme sizes .slide; object-fit crops).
        height: "100%",
        borderRadius: `${radius}px`,
        overflow: "hidden",
        border,
        boxSizing: "border-box",
        // Safari clips transformed children to the radius only with a mask.
        WebkitMaskImage: "-webkit-radial-gradient(white, black)",
        background: "#e9a25a",
      }}
    >
      <picture>
        <source srcSet="/assets/images/profile-bg-640.webp 640w, /assets/images/profile-bg-1024.webp 1024w" sizes="(max-width: 767px) 90vw, 680px" type="image/webp" />
        <img
          ref={bgRef}
          className="pp-bg"
          src="/assets/images/profile.png"
          alt={alt}
          width={1024}
          height={1536}
          fetchpriority="high"
          decoding="async"
          style={layer}
        />
      </picture>
      <img
          ref={fgRef}
          className="pp-fg"
          src="/assets/images/profile-person-1024.webp"
          srcSet="/assets/images/profile-person-640.webp 640w, /assets/images/profile-person-1024.webp 1024w"
          sizes="(max-width: 767px) 90vw, 680px"
          alt=""
          aria-hidden="true"
          width={1024}
          height={1536}
          decoding="async"
          style={layer}
        />
      {needsMotionPermission && !motionOn && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            frameRef.current?.__enableMotion?.();
          }}
          style={{
            position: "absolute",
            left: "50%",
            bottom: "7%",
            transform: "translateX(-50%)",
            // Above the image layers: the theme gives every .hero-started .slide img z-index 10.
            zIndex: 20,
            height: "auto",
            lineHeight: 1.2,
            // The theme scales the hero to 0.5–0.75 on phones and tablets, so these read about half size.
            padding: "14px 26px",
            borderRadius: 999,
            border: "2px solid rgba(255,255,255,0.7)",
            background: "rgba(15,23,42,0.45)",
            color: "#fff",
            fontSize: 24,
            fontWeight: 600,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            cursor: "pointer",
          }}
        >
          Tilt to look around
        </button>
      )}
      <style jsx>{`
        .pp-bg { transform: scale(${SCALE}); }
        .pp-frame { transform-style: preserve-3d; }
        /* Phones keep their layers ready for tilt; on computers the layers are only promoted while the
           view moves, and are drawn sharp again at rest. */
        @media (hover: none), (pointer: coarse) {
          .pp-frame, .pp-bg { will-change: transform; }
        }
      `}</style>
    </div>
  );
}
