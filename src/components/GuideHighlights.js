import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowUpRight } from "lucide-react"
import { normalizeWebGuidePlan } from "../lib/webGuide"

function cardPosition(rect) {
  if (!rect || typeof window === "undefined") return { top: 0, left: 0, opacity: 0 }
  const width = Math.min(320, window.innerWidth - 24)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const below = rect.bottom + 10
  const top = below + 180 < window.innerHeight ? below : Math.max(12, rect.top - 190)
  return { top, left, width, opacity: 1 }
}

export default function GuideHighlights() {
  const [active, setActive] = useState(null)
  const cleanupsRef = useRef([])
  const openTimerRef = useRef(null)
  const closeTimerRef = useRef(null)

  const clearTimers = useCallback(() => {
    clearTimeout(openTimerRef.current)
    clearTimeout(closeTimerRef.current)
  }, [])

  const clearTargets = useCallback(() => {
    clearTimers()
    cleanupsRef.current.forEach((cleanup) => cleanup())
    cleanupsRef.current = []
  }, [clearTimers])

  const show = useCallback((step, element, delayed = false) => {
    clearTimeout(closeTimerRef.current)
    const open = () => setActive({ step, element, rect: element.getBoundingClientRect() })
    clearTimeout(openTimerRef.current)
    if (delayed) openTimerRef.current = setTimeout(open, 140)
    else open()
  }, [])

  const scheduleClose = useCallback(() => {
    clearTimeout(openTimerRef.current)
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setActive(null), 120)
  }, [])

  const apply = useCallback((rawPlan) => {
    const plan = normalizeWebGuidePlan(rawPlan)
    if (!plan) return
    clearTargets()
    setActive(null)
    const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches

    plan.highlights.forEach((step) => {
      const element = document.getElementById(step.targetId)
      if (!element) return
      const previousTabIndex = element.getAttribute("tabindex")
      const previousAriaLabel = element.getAttribute("aria-label")
      element.classList.add("cw-guide-keyword")
      element.setAttribute("tabindex", "0")
      element.setAttribute("aria-label", `${step.title}. ${step.content}`)

      const onEnter = () => finePointer && show(step, element, true)
      const onLeave = () => finePointer && scheduleClose()
      const onFocus = () => show(step, element)
      const onBlur = () => scheduleClose()
      const onClick = () => {
        if (!finePointer) {
          setActive((current) => current?.element === element
            ? null
            : { step, element, rect: element.getBoundingClientRect() })
        }
      }
      element.addEventListener("pointerenter", onEnter)
      element.addEventListener("pointerleave", onLeave)
      element.addEventListener("focus", onFocus)
      element.addEventListener("blur", onBlur)
      element.addEventListener("click", onClick)

      cleanupsRef.current.push(() => {
        element.classList.remove("cw-guide-keyword")
        if (previousAriaLabel == null) element.removeAttribute("aria-label")
        else element.setAttribute("aria-label", previousAriaLabel)
        if (previousTabIndex == null) element.removeAttribute("tabindex")
        else element.setAttribute("tabindex", previousTabIndex)
        element.removeEventListener("pointerenter", onEnter)
        element.removeEventListener("pointerleave", onLeave)
        element.removeEventListener("focus", onFocus)
        element.removeEventListener("blur", onBlur)
        element.removeEventListener("click", onClick)
      })
    })
  }, [clearTargets, scheduleClose, show])

  useEffect(() => {
    const onHighlights = (event) => apply(event?.detail)
    const onClear = () => {
      clearTargets()
      setActive(null)
    }
    window.addEventListener("cw:guide:highlights", onHighlights)
    window.addEventListener("cw:guide:clear", onClear)
    return () => {
      window.removeEventListener("cw:guide:highlights", onHighlights)
      window.removeEventListener("cw:guide:clear", onClear)
      clearTargets()
    }
  }, [apply, clearTargets])

  useEffect(() => {
    if (!active?.element) return
    const update = () => setActive((current) => current?.element
      ? { ...current, rect: current.element.getBoundingClientRect() }
      : current)
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [active?.element])

  if (typeof document === "undefined" || !active) return null
  const { step, element, rect } = active
  return createPortal(
    <div
      className="cw-guide-hover-card"
      style={cardPosition(rect)}
      role="dialog"
      aria-label={step.card.title}
      onPointerEnter={clearTimers}
      onPointerLeave={scheduleClose}
    >
      <span className="cw-guide-hover-label">{step.title}</span>
      <p>{step.card.content}</p>
      <button
        type="button"
        onClick={() => {
          element.scrollIntoView({ behavior: "smooth", block: "center" })
          setActive(null)
        }}
      >
        {step.card.action}
        <ArrowUpRight size={15} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  )
}
