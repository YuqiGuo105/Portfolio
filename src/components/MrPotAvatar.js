import { useEffect, useRef } from "react"
import { Cog, Sparkle } from "lucide-react"
import { loadPotRenderer, POT_REST } from "../lib/mrPotAnimation.mjs"
import { samplePotPerformance } from "../lib/mrPotMotion.mjs"
import styles from "./MrPotAvatar.module.css"

const DESCRIPTIONS = {
  idle: "Mr Pot is ready",
  listening: "Mr Pot is listening",
  thinking: "Mr Pot is thinking",
  searching: "Mr Pot is searching the portfolio",
  working: "Mr Pot is using a tool",
  speaking: "Mr Pot is composing an answer",
  success: "Mr Pot finished the answer",
  error: "Mr Pot could not finish the answer",
}

export default function MrPotAvatar({ state = "idle", size = "medium", announce = false }) {
  const rootRef = useRef(null)
  const imageRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef(state)
  const resumeRef = useRef(null)
  useEffect(() => {
    stateRef.current = state
    resumeRef.current?.()
  }, [state])

  useEffect(() => {
    const root = rootRef.current, image = imageRef.current, canvas = canvasRef.current
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const current = { ...POT_REST }
    let render, loading = false, disposed = false, visible = true, frame = 0, lastTime = 0, elapsed = 0, stateTime = 0
    let previousState = stateRef.current
    let greetingAt = -100, greetingLast = -100
    let artworkTime = 0

    function draw(now) {
      frame = 0
      if (lastTime && now - lastTime < 1000 / 30) {
        frame = requestAnimationFrame(draw)
        return
      }
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0
      lastTime = now
      elapsed += dt
      stateTime += dt
      if (previousState !== stateRef.current) {
        previousState = stateRef.current
        stateTime = 0
        greetingAt = -100
      }
      if (reducedMotion.matches) {
        render(POT_REST)
        root.dataset.gesture = "rest"
        root.dataset.frameIndex = "0"
        return
      }
      const activeState = previousState === "success" && stateTime > 3.6 ? "idle" : previousState
      if (root.dataset.expression !== activeState) root.dataset.expression = activeState
      const { pose, gesture, steady = false } = samplePotPerformance(activeState, stateTime, elapsed - greetingAt)
      if (root.dataset.gesture !== gesture) root.dataset.gesture = gesture
      // Facial expression comes from the brows; the eyes belong to the head.
      for (const key of Object.keys(current)) {
        const speed = key.startsWith("mouth") ? 20 : 7
        current[key] += (pose[key] - current[key]) * (1 - Math.exp(-speed * dt))
      }
      artworkTime = steady ? 0 : artworkTime + dt
      const frameIndex = Math.floor(artworkTime * 12.5) % render.frameCount
      render(current, frameIndex)
      if (root.dataset.frameIndex !== String(frameIndex)) root.dataset.frameIndex = String(frameIndex)
      if (visible && !document.hidden) frame = requestAnimationFrame(draw)
    }

    function resume() {
      cancelAnimationFrame(frame)
      lastTime = 0
      root.dataset.paused = String(reducedMotion.matches || document.hidden || !visible)
      root.dataset.expression = stateRef.current
      if (render && !disposed && visible && !document.hidden) frame = requestAnimationFrame(draw)
    }
    async function load() {
      if (disposed || loading || render || !image.naturalWidth) return
      loading = true
      try {
        const prepared = await loadPotRenderer(canvas, image.currentSrc || image.src, image)
        if (disposed) return
        // Browsers without ImageDecoder still animate a snapshot of the same GIF.
        render = prepared.render
        render(POT_REST)
        root.dataset.ready = "true"
        root.dataset.artwork = prepared.artwork
        resume()
      } catch {
        // Keep the original animated GIF visible when frame decoding is unavailable.
      } finally {
        loading = false
      }
    }
    const onPointer = event => {
      if (event.pointerType === "touch" || reducedMotion.matches || !visible || document.hidden) return
      if (elapsed - greetingLast > 6 && ["idle", "listening"].includes(root.dataset.expression)) {
        greetingAt = elapsed
        greetingLast = elapsed
      }
    }
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume() })
    observer.observe(root)
    resumeRef.current = resume
    image.addEventListener("load", load)
    if (image.complete) load()
    root.addEventListener("pointerenter", onPointer, { passive: true })
    document.addEventListener("visibilitychange", resume)
    reducedMotion.addEventListener("change", resume)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      resumeRef.current = null
      delete root.dataset.ready
      delete root.dataset.paused
      delete root.dataset.expression
      delete root.dataset.gesture
      delete root.dataset.artwork
      delete root.dataset.frameIndex
      image.removeEventListener("load", load)
      root.removeEventListener("pointerenter", onPointer)
      document.removeEventListener("visibilitychange", resume)
      reducedMotion.removeEventListener("change", resume)
    }
  }, [])

  return <span ref={rootRef} className={`cw-pot-avatar cw-pot-${size} ${styles.avatar}`}
    data-state={state} role={announce ? "status" : undefined}
    aria-live={announce ? "polite" : undefined}
    aria-label={announce ? DESCRIPTIONS[state] || DESCRIPTIONS.idle : undefined}
    aria-hidden={announce ? undefined : true}>
    {/* The same original artwork is also the no-canvas/loading fallback. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={imageRef} className={styles.original} src="/assets/images/chatbot_pot_thinking.gif" width="96" height="96" alt="" draggable={false} />
    <canvas ref={canvasRef} className={styles.rig} width="384" height="384" aria-hidden="true" />
    <span className={styles.effects} aria-hidden="true">
      <span className={styles.orbit} />
      <span className={styles.thought} data-pot-effect="thinking"><i /><i /><i /></span>
      <span className={styles.scan} data-pot-effect="searching" />
      <span className={styles.tool} data-pot-effect="working"><Cog /></span>
      <span className={styles.listen} data-pot-effect="listening"><i /><i /></span>
      <span className={styles.voice} data-pot-effect="speaking"><i /><i /><i /></span>
      <span className={styles.spark} data-pot-effect="success"><Sparkle /><Sparkle /></span>
    </span>
  </span>
}
