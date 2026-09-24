import { useEffect, useRef } from "react"
import { Cog, Sparkle } from "lucide-react"
import { createPotRenderer, decodePotFrames, POT_REST } from "../lib/mrPotAnimation.mjs"
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

function expression(state, t) {
  const pose = { ...POT_REST }
  const glance = Math.floor(t / 4) % 2 === 0 ? 1 : -1
  if (state === "thinking") Object.assign(pose, {
    tilt: -2 * glance, gazeX: -0.65 * glance, gazeY: -0.6,
    eyeLeft: glance > 0 ? 0.84 : 0.97, eyeRight: glance > 0 ? 0.97 : 0.84,
    browLeft: 10 * glance, browRight: -10 * glance,
    mouthWidth: 0.88, mouthHeight: 0.72,
  })
  if (state === "searching") Object.assign(pose, { tilt: -1, gazeY: 0.2, eyeLeft: 0.95, eyeRight: 0.95 })
  if (state === "listening") Object.assign(pose, { tilt: 3, gazeX: 0.4, browLift: -0.5 })
  if (state === "working") Object.assign(pose, { tilt: 2, gazeY: 0.6, eyeLeft: 0.88, eyeRight: 0.88 })
  if (state === "speaking") Object.assign(pose, {
    tilt: Math.sin(t * 2.1) * 1.5, mouthWidth: 1 + Math.sin(t * 5.7) * 0.08,
    mouthHeight: 1 + Math.max(0, Math.sin(t * 8.1)) * 0.45, browLift: -0.25,
  })
  if (state === "success") Object.assign(pose, {
    lift: -0.8 * Math.sin(Math.min(t, 1) * Math.PI),
    tilt: 2 * Math.sin(Math.min(t, 1) * Math.PI * 2),
    eyeLeft: 0.9, eyeRight: 0.9, mouthWidth: 1.08, browLift: -0.4,
  })
  if (state === "error") Object.assign(pose, { tilt: -2, browLeft: -8, browRight: 8, mouthHeight: 0.75 })
  return pose
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
    const pointer = { x: 0, y: 0, active: false }
    let render, loading = false, disposed = false, visible = true, frame = 0, lastTime = 0, elapsed = 0, stateTime = 0
    let previousState = stateRef.current, gazeAt = 0, gazeCount = 0, gaze = { x: 0, y: 0 }
    let blinkAt = 2 + Math.random() * 2, blinkStart = -10

    function draw(now) {
      frame = 0
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0
      lastTime = now
      elapsed += dt
      stateTime += dt
      if (previousState !== stateRef.current) {
        previousState = stateRef.current
        stateTime = 0
        gazeAt = 0
      }
      if (reducedMotion.matches) {
        render(POT_REST)
        return
      }
      const activeState = previousState === "success" && stateTime > 2.6 ? "idle" : previousState
      if (root.dataset.expression !== activeState) root.dataset.expression = activeState
      const pose = expression(activeState, stateTime)
      if (elapsed >= gazeAt) {
        gazeCount++
        gaze = { x: (Math.random() - 0.5) * 0.65, y: (Math.random() - 0.5) * 0.35 }
        if (activeState === "searching") gaze.x = (gazeCount % 2 ? -1 : 1) * 0.85
        gazeAt = elapsed + 1.2 + Math.random() * 1.8
      }
      pose.gazeX += gaze.x
      pose.gazeY += gaze.y
      if ((activeState === "idle" || activeState === "listening") && pointer.active) {
        pose.gazeX = pointer.x * 0.85
        pose.gazeY = pointer.y * 0.65
        pose.tilt += pointer.x * 1.5
      }
      if (elapsed >= blinkAt) {
        blinkStart = elapsed
        blinkAt = elapsed + 2.6 + Math.random() * 2.8
      }
      const age = elapsed - blinkStart
      const blink = age < 0.2 ? Math.sin(age / 0.2 * Math.PI) : 0
      pose.eyeLeft *= Math.max(0.09, 1 - blink)
      pose.eyeRight *= Math.max(0.09, 1 - blink)

      // Eye movements settle before the head, with quiet pauses between glances.
      for (const key of Object.keys(current)) {
        const speed = key.startsWith("eye") ? 42 : key.startsWith("gaze") ? 16 : 5
        current[key] += (pose[key] - current[key]) * (1 - Math.exp(-speed * dt))
      }
      render(current, Math.floor(elapsed * 12.5) % render.frameCount)
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
      let frames
      try {
        frames = await decodePotFrames(image.currentSrc || image.src)
        if (disposed || !frames?.length) return
        render = createPotRenderer(canvas, frames)
        render(POT_REST)
        root.dataset.ready = "true"
        resume()
      } catch {
        // Keep the original animated GIF visible when frame decoding is unavailable.
      } finally {
        frames?.forEach(frame => frame.close())
        loading = false
      }
    }
    const onPointer = event => {
      if (event.pointerType === "touch" || reducedMotion.matches || !visible || document.hidden) return
      const box = root.getBoundingClientRect()
      const x = event.clientX - (box.left + box.width / 2), y = event.clientY - (box.top + box.height / 2)
      pointer.active = Math.hypot(x, y) < 220
      pointer.x = Math.max(-1, Math.min(1, x / 100))
      pointer.y = Math.max(-1, Math.min(1, y / 90))
    }
    const leave = () => { pointer.active = false }
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume() })
    observer.observe(root)
    resumeRef.current = resume
    image.addEventListener("load", load)
    if (image.complete) load()
    window.addEventListener("pointermove", onPointer, { passive: true })
    document.addEventListener("pointerleave", leave)
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
      image.removeEventListener("load", load)
      window.removeEventListener("pointermove", onPointer)
      document.removeEventListener("pointerleave", leave)
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
    <canvas ref={canvasRef} className={styles.rig} width="192" height="192" aria-hidden="true" />
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
