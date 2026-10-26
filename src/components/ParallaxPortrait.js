"use client";

import { useEffect, useRef, useState } from "react";

// The hero portrait as a 2.5D scene: the beach/sky background and the figure are separate layers
// (public/assets/images/profile-bg-*, profile-person-*), so tilting the phone or moving the pointer
// shifts them by different amounts and turns the oval slightly, like looking past him at the sea.
// Everything is CSS transforms on two images — no WebGL; the loop only runs while the view moves.

const MAX_TILT_DEG = 6; // turn of the whole oval
const BG_SHIFT = 2.2; // % of the frame: background moves against the motion
const FG_SHIFT = 3.0; // % of the frame: the figure moves with it
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
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return undefined;

    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let raf = 0;
    let visible = true;
    let baseline = null;

    const apply = () => {
      const { x, y } = current;
      frame.style.transform = `perspective(1100px) rotateY(${(x * MAX_TILT_DEG).toFixed(2)}deg) rotateX(${(-y * MAX_TILT_DEG).toFixed(2)}deg)`;
      if (bgRef.current) bgRef.current.style.transform = `translate3d(${(-x * BG_SHIFT).toFixed(3)}%, ${(-y * BG_SHIFT).toFixed(3)}%, 0) scale(1.08)`;
      if (fgRef.current) fgRef.current.style.transform = `translate3d(${(x * FG_SHIFT).toFixed(3)}%, ${(y * FG_SHIFT * 0.5).toFixed(3)}%, 0) scale(1.08)`;
    };

    const step = () => {
      current.x += (target.x - current.x) * EASE;
      current.y += (target.y - current.y) * EASE;
      apply();
      const settled = Math.abs(target.x - current.x) < 0.001 && Math.abs(target.y - current.y) < 0.001;
      raf = settled || !visible ? 0 : requestAnimationFrame(step);
    };
    const kick = () => {
      if (!raf && visible) raf = requestAnimationFrame(step);
    };

    // Pointer (desktop / trackpad): position over the portrait, easing back when it leaves.
    const onPointerMove = (e) => {
      if (e.pointerType === "touch") return;
      const r = frame.getBoundingClientRect();
      target.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1);
      target.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1);
      kick();
    };
    const onPointerLeave = () => {
      target.x = 0;
      target.y = 0;
      kick();
    };

    // Phone tilt: relative to how the phone was held when the page started listening, with the
    // reference drifting slowly so any comfortable holding angle becomes the neutral view.
    const onOrientation = (e) => {
      if (e.beta == null || e.gamma == null) return;
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

    frame.addEventListener("pointermove", onPointerMove, { passive: true });
    frame.addEventListener("pointerleave", onPointerLeave, { passive: true });

    // Listen straight away (Android and desktop browsers deliver tilt without asking). Only if no
    // reading arrives on a touch device whose browser offers requestPermission (iOS Safari) show the
    // opt-in button; desktops just use the pointer.
    const DOE = window.DeviceOrientationEvent;
    let gotReading = false;
    const onFirstOrientation = (e) => {
      if (e.beta == null) return;
      gotReading = true;
      setMotionOn(true);
    };
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    window.addEventListener("deviceorientation", onFirstOrientation, { passive: true, once: true });
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    const mustAsk = touch && DOE && typeof DOE.requestPermission === "function";
    let asking = false;
    let answered = false;
    const ask = async () => {
      if (asking || answered || gotReading) return;
      asking = true;
      try {
        await DOE.requestPermission(); // resolves "granted" or "denied" once the visitor answers
        answered = true;
        document.removeEventListener("touchend", ask);
        setNeedsMotionPermission(false);
      } catch {
        // Not counted as a gesture (e.g. the touch was a scroll): the next tap asks again.
      }
      asking = false;
    };
    const askTimer = setTimeout(() => {
      if (mustAsk && !gotReading) setNeedsMotionPermission(true);
    }, 1200);
    // iOS (Safari and Chrome alike) only grants motion access from a user gesture: a tap anywhere on
    // the page asks until the visitor answers; the button is the visible way to do the same.
    if (mustAsk) document.addEventListener("touchend", ask, { passive: true });
    frame.__enableMotion = ask;

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(askTimer);
      document.removeEventListener("touchend", ask);
      window.removeEventListener("deviceorientation", onFirstOrientation);
      io?.disconnect();
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("deviceorientation", onOrientation);
      delete frame.__enableMotion;
    };
  }, []);

  const layer = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    willChange: "transform",
    pointerEvents: "none",
    userSelect: "none",
  };

  return (
    <div
      ref={frameRef}
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
        transformStyle: "preserve-3d",
        willChange: "transform",
        // Safari clips transformed children to the radius only with a mask.
        WebkitMaskImage: "-webkit-radial-gradient(white, black)",
        background: "#e9a25a",
      }}
    >
      <picture>
        <source srcSet="/assets/images/profile-bg-640.webp 640w, /assets/images/profile-bg-1024.webp 1024w" sizes="(max-width: 767px) 90vw, 680px" type="image/webp" />
        <img
          ref={bgRef}
          src="/assets/images/profile.png"
          alt={alt}
          width={1024}
          height={1536}
          fetchpriority="high"
          decoding="async"
          style={{ ...layer, transform: "scale(1.08)" }}
        />
      </picture>
      <img
        ref={fgRef}
        src="/assets/images/profile-person-1024.webp"
        srcSet="/assets/images/profile-person-640.webp 640w, /assets/images/profile-person-1024.webp 1024w"
        sizes="(max-width: 767px) 90vw, 680px"
        alt=""
        aria-hidden="true"
        width={1024}
        height={1536}
        decoding="async"
        style={{ ...layer, transform: "scale(1.08)" }}
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
    </div>
  );
}
