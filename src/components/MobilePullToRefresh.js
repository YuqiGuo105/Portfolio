import { RefreshCw } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import styles from "./MobilePullToRefresh.module.css";

const ACTIVATION_DISTANCE_PX = 84;
const MAX_PULL_DISTANCE_PX = 132;
const TOUCH_SLOP_PX = 8;

function isInteractiveTarget(target) {
  return Boolean(
    target instanceof Element &&
      target.closest(
        "input, textarea, select, button, [contenteditable='true'], [data-disable-pull-refresh]"
      )
  );
}

function hasOpenModal() {
  return Boolean(
    document.querySelector(
      "[role='dialog'][aria-modal='true'], .ReactModal__Overlay--after-open"
    )
  );
}

export default function MobilePullToRefresh() {
  const router = useRouter();
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const distanceRef = useRef(0);
  const trackingRef = useRef(false);
  const refreshingRef = useRef(false);
  const [distance, setDistance] = useState(0);
  const [state, setState] = useState("idle");

  useEffect(() => {
    if (router.pathname.startsWith("/admin")) return undefined;

    const mobilePointer = window.matchMedia("(pointer: coarse)");
    if (!mobilePointer.matches) return undefined;

    const reset = () => {
      trackingRef.current = false;
      distanceRef.current = 0;
      setDistance(0);
      setState("idle");
    };

    const onTouchStart = (event) => {
      if (
        refreshingRef.current ||
        event.touches.length !== 1 ||
        window.scrollY > 0 ||
        isInteractiveTarget(event.target) ||
        hasOpenModal()
      ) {
        trackingRef.current = false;
        return;
      }

      startXRef.current = event.touches[0].clientX;
      startYRef.current = event.touches[0].clientY;
      trackingRef.current = true;
    };

    const onTouchMove = (event) => {
      if (!trackingRef.current || refreshingRef.current) return;
      if (event.touches.length !== 1 || window.scrollY > 0) {
        reset();
        return;
      }

      const deltaX = event.touches[0].clientX - startXRef.current;
      const rawDistance = event.touches[0].clientY - startYRef.current;
      if (Math.abs(deltaX) > Math.abs(rawDistance)) {
        reset();
        return;
      }
      if (rawDistance <= TOUCH_SLOP_PX) return;

      event.preventDefault();
      const resistedDistance = Math.min(
        MAX_PULL_DISTANCE_PX,
        Math.round(Math.pow(rawDistance - TOUCH_SLOP_PX, 0.82) * 2.1)
      );
      distanceRef.current = resistedDistance;
      setDistance(resistedDistance);
      setState(
        resistedDistance >= ACTIVATION_DISTANCE_PX ? "armed" : "pulling"
      );
    };

    const onTouchEnd = () => {
      if (!trackingRef.current || refreshingRef.current) return;
      trackingRef.current = false;

      if (distanceRef.current < ACTIVATION_DISTANCE_PX) {
        reset();
        return;
      }

      refreshingRef.current = true;
      distanceRef.current = 58;
      setDistance(58);
      setState("refreshing");

      // Keep the state visible long enough to confirm the gesture before the
      // browser performs a full refresh and reloads fresh client-side data.
      window.setTimeout(() => router.reload(), 320);
    };

    const onTouchCancel = () => {
      if (!refreshingRef.current) reset();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [router, router.pathname]);

  if (router.pathname.startsWith("/admin")) return null;

  const visible = state !== "idle";
  const progress = Math.min(distance / ACTIVATION_DISTANCE_PX, 1);
  const label =
    state === "refreshing"
      ? "Refreshing"
      : state === "armed"
      ? "Release to refresh"
      : "Pull to refresh";

  return (
    <div
      className={`${styles.indicator} ${visible ? styles.visible : ""} ${
        state === "refreshing" ? styles.refreshing : ""
      }`}
      style={{
        "--pull-distance": `${distance}px`,
        "--pull-progress": progress,
      }}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      <span className={styles.icon} aria-hidden="true">
        <RefreshCw size={18} strokeWidth={2.1} />
      </span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
