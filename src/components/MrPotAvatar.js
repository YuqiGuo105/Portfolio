import { useEffect, useId, useMemo, useRef } from "react"
import { createPotRig, POT_REACTIONS } from "../lib/mrPotRig.mjs"
import { drawPot, potMarkup, potParts } from "../lib/mrPotDrawing.mjs"
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

/**
 * Mr. Pot, alive.
 *
 * `state` is what the conversation is doing. `reaction` is a short look in answer to the visitor,
 * as `{ name, id }`: a new id plays it again. `pulse` changes once per keystroke, for the nod.
 * The drawing is in the page from the first paint; the script only moves it, and stops while he
 * is off screen, the tab is hidden, or the visitor asked for reduced motion.
 * With `launcher` he sits on the button that opens the chat: he says hello when that button is
 * hovered or focused, never nods off, and is drawn every other frame, because he is on every page.
 */
export default function MrPotAvatar({ state = "idle", size = "medium", announce = false, reaction = null, pulse = 0, launcher = false }) {
  const rootRef = useRef(null)
  const rigRef = useRef(null)
  const wakeRef = useRef(null)
  const id = `pot${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  const markup = useMemo(() => ({ __html: potMarkup(id) }), [id])

  useEffect(() => {
    const root = rootRef.current
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const rig = createPotRig({ still: () => reducedMotion.matches, sleeps: !launcher })
    const parts = potParts(root)
    let frame = 0, last = 0, visible = true, pointer = null, greeted = -100, skipped = false
    const host = launcher ? root.closest("button") || root : root
    const running = () => visible && !document.hidden && !reducedMotion.matches
    rigRef.current = rig

    function draw(now) {
      frame = 0
      if (launcher && last && (skipped = !skipped)) { if (running()) frame = requestAnimationFrame(draw); return }
      const dt = last ? Math.min((now - last) / 1000, 0.033) : 0
      last = now
      if (pointer) {
        const box = root.getBoundingClientRect()
        rig.look((pointer.x - (box.left + box.width / 2)) / 90, (pointer.y - (box.top + box.height * 0.6)) / 90)
        pointer = null
      }
      // Two half steps keep the stiffest springs stable at 30 frames a second.
      rig.step(dt / 2); rig.step(dt / 2)
      drawPot(parts, rig.state, rig.clock, rig.puffs)
      if (root.dataset.expression !== rig.shown) root.dataset.expression = rig.shown
      if (running()) frame = requestAnimationFrame(draw)
    }
    function wake() {
      cancelAnimationFrame(frame)
      last = 0
      root.dataset.paused = String(reducedMotion.matches || document.hidden || !visible)
      // One frame is always drawn, so a still pot still wears the right face.
      if (visible && !document.hidden) frame = requestAnimationFrame(draw)
    }
    const onMove = event => { if (event.pointerType !== "touch") pointer = { x: event.clientX, y: event.clientY } }
    const onEnter = event => {
      if (event.pointerType === "touch") return
      if (rig.clock - greeted < 6) return
      if (rig.react("hello")) greeted = rig.clock
    }
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; wake() })
    observer.observe(root)
    wakeRef.current = wake
    root.dataset.ready = "true"
    document.addEventListener("pointermove", onMove, { passive: true })
    host.addEventListener("pointerenter", onEnter, { passive: true })
    host.addEventListener("focus", onEnter, { passive: true })
    document.addEventListener("visibilitychange", wake)
    reducedMotion.addEventListener("change", wake)
    wake()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      rigRef.current = null
      wakeRef.current = null
      delete root.dataset.ready
      delete root.dataset.paused
      delete root.dataset.expression
      document.removeEventListener("pointermove", onMove)
      host.removeEventListener("pointerenter", onEnter)
      host.removeEventListener("focus", onEnter)
      document.removeEventListener("visibilitychange", wake)
      reducedMotion.removeEventListener("change", wake)
    }
  }, [launcher])

  useEffect(() => { rigRef.current?.setMood(state); wakeRef.current?.() }, [state])
  const reactionName = reaction?.name, reactionId = reaction?.id
  useEffect(() => {
    if (reactionName === "none") rigRef.current?.settle()
    else if (reactionName && POT_REACTIONS[reactionName]) rigRef.current?.react(reactionName)
    if (reactionName) wakeRef.current?.()
  }, [reactionName, reactionId])
  useEffect(() => { if (pulse) rigRef.current?.key() }, [pulse])

  return <span ref={rootRef} className={`cw-pot-avatar cw-pot-${size} ${styles.avatar}`}
    data-state={state} role={announce ? "status" : undefined}
    aria-live={announce ? "polite" : undefined}
    aria-label={announce ? DESCRIPTIONS[state] || DESCRIPTIONS.idle : undefined}
    aria-hidden={announce ? undefined : true}
    dangerouslySetInnerHTML={markup} />
}
