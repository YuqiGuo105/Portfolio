import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Copy, ExternalLink, ListTree, Mail, Pause, Play, Volume2 } from "lucide-react"
import { consumePendingWebGuide } from "../lib/webGuide"

const DEFAULT_CONTROLS = { previous: "Prev", next: "Next", done: "Done", close: "Close" }

function getRect(el) {
    const r = el.getBoundingClientRect()
    return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export default function SiteTour() {
    const STATIC_STEPS = useMemo(
        () => [
            {
                id: "hero",
                targetKey: "home.hero",
                targetId: "tour-hero",
                title: "Yuqi Guo",
                content: "Full-stack, backend, and mobile engineer building production-minded distributed systems, AI platforms, and polished user experiences.",
                meta: "Software engineering · Microservices · Distributed systems",
                pronunciation: true,
            },
            {
                id: "about",
                targetKey: "home.about",
                targetId: "tour-about",
                title: "About Me",
                content: "Start with a quick snapshot of who I am, what I love building, and how to pronounce my name.",
                meta: "Profile · Engineering focus · Current role",
            },
            {
                id: "background",
                targetKey: "home.background",
                targetId: "tour-background",
                title: "My Background",
                content: "See where I've studied, the teams I've contributed to, and the technical domains I've focused on.",
                meta: "Experience · Education · Technical foundation",
                action: { href: "/cv", label: "View CV" },
            },
            {
                id: "projects",
                targetKey: "home.projects",
                targetId: "tour-projects",
                title: "My Projects",
                content: "Browse the flagship projects I've shipped, the problems they solve, and the stacks I used to build them.",
                meta: "Distributed systems · AI platform · Production operations",
                action: { href: "/works-list", label: "Explore all projects" },
            },
            {
                id: "techblogs",
                targetKey: "home.techBlogs",
                targetId: "tour-techblogs",
                title: "My Technical Blogs",
                content: "Explore deep dives, system design notes, and hands-on write-ups that showcase how I approach new challenges.",
                meta: "System design · Backend · Infrastructure",
                action: { href: "/blogs?type=technical", label: "Read technical writing" },
                interaction: { type: "activate", targetId: "tour-techblogs", label: "Show Tech Blogs" },
            },
            {
                id: "life",
                targetKey: "home.lifeBlogs",
                targetId: "tour-life",
                title: "My Vibrant Life",
                content: "Get a glimpse of my hobbies, travels, and the moments outside of code that keep me inspired.",
                meta: "Travel · Photography · Life outside code",
                action: { href: "/blogs?type=life", label: "Explore life stories" },
                interaction: { type: "activate", targetId: "tour-life", label: "Show Life Blogs" },
            },
            {
                id: "realtime",
                targetKey: "home.dashboard",
                targetId: "tour-real-time-data",
                title: "Real-Time Data",
                content: "See live market moves, quick currency conversions, and a snapshot of the weather I'm tracking right now.",
                meta: "Live services · Visitor intelligence · Observability",
                action: { href: "/analytics", label: "Open analytics" },
            },
            {
                id: "contact",
                targetKey: "home.contact",
                targetId: "tour-contact",
                title: "Contact Me",
                content: "Wrap up with the best ways to reach me, whether you want to collaborate, hire, or just say hello.",
                meta: "Recruiting · Collaboration · Direct contact",
                interaction: { type: "copy", value: "yuqi.guo17@gmail.com", label: "Copy email" },
                action: { href: "mailto:yuqi.guo17@gmail.com", label: "Write an email" },
            },
        ],
        []
    )

    // steps state supports both static default and dynamic AI-generated overrides
    const [steps, setSteps] = useState(null) // null = use STATIC_STEPS
    const [controls, setControls] = useState(DEFAULT_CONTROLS)
    const stepsRef = useRef(null)            // always mirrors current effective steps

    const effectiveSteps = steps || STATIC_STEPS
    // Keep ref in sync so go() always reads latest without stale closures
    stepsRef.current = effectiveSteps

    const [open, setOpen] = useState(false)
    const [idx, setIdx] = useState(0)
    const [anchorRect, setAnchorRect] = useState(null)
    const popRef = useRef(null)
    const activeElRef = useRef(null)
    const rafRef = useRef(0)
    const [uiReady, setUiReady] = useState(false)
    const [mapOpen, setMapOpen] = useState(false)
    const [autoPlay, setAutoPlay] = useState(false)
    const [collapsed, setCollapsed] = useState(false)
    const [interactionDone, setInteractionDone] = useState(false)
    const scheduleUpdateRect = useCallback(() => {
        if (!open) return
        if (!activeElRef.current) return
        if (rafRef.current) return

        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0
            const el = activeElRef.current
            if (!el) return
            setAnchorRect(getRect(el))
        })
    }, [open])

    const close = useCallback(() => {
        setOpen(false)
        setIdx(0)
        setSteps(null) // reset to static steps for next tour
        setControls(DEFAULT_CONTROLS)
        setMapOpen(false)
        setAutoPlay(false)
        setCollapsed(false)
        setInteractionDone(false)
        activeElRef.current = null
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("cw:site-tour:end"))
        }
    }, [])
    const go = useCallback(
        (nextIdx) => {
            const step = stepsRef.current[nextIdx]
            if (!step) return
            const el = document.getElementById(step.targetId)
            if (!el) return
            activeElRef.current = el
            setUiReady(false)
            setInteractionDone(false)
            setAnchorRect(null)
            el.scrollIntoView({ behavior: "smooth", block: "center" })
            const start = performance.now()
            let lastTop = null
            let stableCount = 0
            const watchStable = () => {
                const r = el.getBoundingClientRect()
                if (lastTop != null && Math.abs(r.top - lastTop) < 0.5) stableCount++
                else stableCount = 0
                lastTop = r.top
                if (stableCount >= 2 || performance.now() - start > 900) {
                    setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height })
                    setUiReady(true)
                    return
                }
                requestAnimationFrame(watchStable)
            }
            requestAnimationFrame(watchStable)
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [], // intentionally empty — reads from stepsRef to avoid stale closure
    )



    const next = () => {
        if (idx >= effectiveSteps.length - 1) return close()
        setIdx((v) => v + 1)
    }
    const prev = () => {
        if (idx <= 0) return
        setIdx((v) => v - 1)
    }

    useEffect(() => {
        const onStart = (e) => {
            // Allow dynamic steps to be passed directly with the start event
            if (e?.detail?.steps?.length > 0) {
                const dynamic = e.detail.steps
                setSteps(dynamic)
                stepsRef.current = dynamic
            }
            if (e?.detail?.controls) setControls(e.detail.controls)
            window.dispatchEvent(new CustomEvent("cw:guide:highlights", {
                detail: {
                    language: e?.detail?.language || "en",
                    controls: e?.detail?.controls || DEFAULT_CONTROLS,
                    steps: e?.detail?.steps || stepsRef.current,
                },
            }))
            setOpen(true)
            setIdx(0)
            setCollapsed(false)
            requestAnimationFrame(() => go(0))
        }
        const onDynamic = (e) => {
            if (e?.detail?.steps?.length > 0) {
                const dynamic = e.detail.steps
                setSteps(dynamic)
                stepsRef.current = dynamic
                if (e?.detail?.controls) setControls(e.detail.controls)
                // Start tour automatically with the new steps
                setOpen(true)
                setIdx(0)
                setCollapsed(false)
                requestAnimationFrame(() => go(0))
            }
        }
        window.addEventListener("cw:site-tour:start", onStart)
        window.addEventListener("cw:site-tour:dynamic", onDynamic)

        const pendingGuide = consumePendingWebGuide()
        if (pendingGuide) {
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent("cw:guide:highlights", { detail: pendingGuide.plan }))
                if (pendingGuide.start) onStart({ detail: pendingGuide.plan })
            }, 600)
        } else {
            try {
                if (sessionStorage.getItem("__pending_site_tour") === "1") {
                    sessionStorage.removeItem("__pending_site_tour")
                    setTimeout(() => onStart({}), 600)
                }
            } catch {}
        }

        return () => {
            window.removeEventListener("cw:site-tour:start", onStart)
            window.removeEventListener("cw:site-tour:dynamic", onDynamic)
        }
    }, [go])

    useEffect(() => {
        if (!open) return
        go(idx)
    }, [open, idx, go])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (event) => {
            if (event.key === "Escape") close()
            if (event.key === "ArrowLeft" && idx > 0) setIdx((value) => value - 1)
            if (event.key === "ArrowRight") {
                if (idx >= effectiveSteps.length - 1) close()
                else setIdx((value) => value + 1)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [close, effectiveSteps.length, idx, open])

    useEffect(() => {
        if (!open || !autoPlay) return
        const timer = window.setTimeout(() => {
            if (idx >= effectiveSteps.length - 1) setAutoPlay(false)
            else setIdx((value) => value + 1)
        }, 5200)
        return () => window.clearTimeout(timer)
    }, [autoPlay, effectiveSteps.length, idx, open])

    useEffect(() => {
        if (!open) return

        const onAny = () => scheduleUpdateRect()

        window.addEventListener("scroll", onAny, true)
        window.addEventListener("resize", onAny)

        const vv = window.visualViewport
        vv?.addEventListener("scroll", onAny)
        vv?.addEventListener("resize", onAny)

        return () => {
            window.removeEventListener("scroll", onAny, true)
            window.removeEventListener("resize", onAny)
            vv?.removeEventListener("scroll", onAny)
            vv?.removeEventListener("resize", onAny)
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
        }
    }, [open, scheduleUpdateRect])

    useEffect(() => {
        if (!open) return
        const el = activeElRef.current
        if (!el || typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver(() => scheduleUpdateRect())
        ro.observe(el)
        return () => ro.disconnect()
    }, [open, idx, scheduleUpdateRect])

    useEffect(() => {
        if (!open || !activeElRef.current) return
        const frame = requestAnimationFrame(() => {
            const rect = getRect(activeElRef.current)
            setAnchorRect({ ...rect })
        })
        return () => cancelAnimationFrame(frame)
    }, [mapOpen, open])

    if (typeof window === "undefined") return null
    if (!open) return null

    const current = effectiveSteps[idx]
    const currentAction = current?.action || (current?.card?.href
        ? { href: current.card.href, label: current.card.action || "Open section" }
        : current?.href
            ? { href: current.href, label: "Open section" }
            : null)
    const popStyle = {
        top: collapsed ? 18 : "50%",
        left: "50%",
        width: collapsed ? "min(420px, calc(100vw - 24px))" : "min(540px, calc(100vw - 24px))",
        transform: collapsed ? "translateX(-50%)" : "translate(-50%, -50%)",
        opacity: uiReady ? 1 : 0,
        pointerEvents: uiReady ? "auto" : "none",
    }

    const pronounceName = () => {
        if (!("speechSynthesis" in window)) return
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance("郭育奇")
        utterance.lang = "zh-CN"
        utterance.rate = 0.72
        window.speechSynthesis.speak(utterance)
    }

    const runInteraction = async () => {
        const interaction = current?.interaction
        if (!interaction) return
        if (interaction.type === "activate") {
            document.getElementById(interaction.targetId)?.click()
            setInteractionDone(true)
            return
        }
        if (interaction.type === "copy") {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(interaction.value)
            } else {
                const input = document.createElement("textarea")
                input.value = interaction.value
                input.setAttribute("readonly", "")
                input.style.position = "fixed"
                input.style.opacity = "0"
                document.body.appendChild(input)
                input.select()
                document.execCommand("copy")
                input.remove()
            }
            setInteractionDone(true)
            window.setTimeout(() => setInteractionDone(false), 1800)
        }
    }

    return createPortal(
        <>
            <div className="st-mask" onClick={close} />

            {uiReady && anchorRect && (
                <div
                    className="st-highlight"
                    style={{
                        top: anchorRect.top - 6,
                        left: anchorRect.left - 10,
                        width: anchorRect.width + 20,
                        height: anchorRect.height + 12,
                    }}
                />
            )}

            <div
                ref={popRef}
                className={`st-pop st-center${collapsed ? " is-collapsed" : ""}`}
                style={popStyle}
                role="dialog"
                aria-modal="true"
            >
                <div className="st-hd">
                    <div>
                        <span className="st-kicker">Portfolio tour</span>
                        <div className="st-title">{current?.title}</div>
                    </div>
                    <div className="st-window-actions">
                        <button
                            type="button"
                            className="st-collapse"
                            onClick={() => setCollapsed((value) => !value)}
                            aria-label={collapsed ? "Expand tour" : "Collapse tour"}
                            title={collapsed ? "Expand" : "Collapse"}
                        >
                            {collapsed ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
                        </button>
                        <button className="st-x" onClick={close} aria-label={controls.close}>×</button>
                    </div>
                </div>

                {!collapsed ? <div className="st-bd">{current?.content}</div> : null}
                {!collapsed && current?.meta ? <div className="st-meta">{current.meta}</div> : null}

                {!collapsed && current?.pronunciation ? (
                    <button type="button" className="st-pronounce" onClick={pronounceName}>
                        <Volume2 size={17} aria-hidden="true" />
                        <span>
                            <strong>郭育奇</strong>
                            Hear my name
                        </span>
                    </button>
                ) : null}

                {!collapsed ? <button
                    type="button"
                    className="st-map-toggle"
                    onClick={() => setMapOpen((value) => !value)}
                    aria-expanded={mapOpen}
                >
                    <ListTree size={14} aria-hidden="true" />
                    Tour map
                    <span>{String(idx + 1).padStart(2, "0")} / {String(effectiveSteps.length).padStart(2, "0")}</span>
                </button> : null}

                {!collapsed && mapOpen ? (
                    <ol className="st-map">
                        {effectiveSteps.map((step, stepIndex) => (
                            <li key={step.id || stepIndex}>
                                <button
                                    type="button"
                                    className={stepIndex === idx ? "is-current" : ""}
                                    onClick={() => {
                                        setIdx(stepIndex)
                                        setMapOpen(false)
                                    }}
                                >
                                    <span>{String(stepIndex + 1).padStart(2, "0")}</span>
                                    {step.title || `Step ${stepIndex + 1}`}
                                </button>
                            </li>
                        ))}
                    </ol>
                ) : null}

                {!collapsed && (currentAction || current?.interaction) ? (
                    <div className="st-step-actions">
                        {current?.interaction ? (
                            <button type="button" className="st-interaction" onClick={runInteraction}>
                                {interactionDone
                                    ? <Check size={14} aria-hidden="true" />
                                    : current.interaction.type === "copy"
                                        ? <Copy size={14} aria-hidden="true" />
                                        : <Play size={14} aria-hidden="true" />}
                                {interactionDone ? "Done" : current.interaction.label}
                            </button>
                        ) : null}
                        {currentAction ? (
                            <a className="st-context-link" href={currentAction.href}>
                                {currentAction.href.startsWith("mailto:")
                                    ? <Mail size={14} aria-hidden="true" />
                                    : <ExternalLink size={14} aria-hidden="true" />}
                                {currentAction.label}
                            </a>
                        ) : null}
                    </div>
                ) : null}

                {!collapsed ? <div className="st-rail" aria-label={`Step ${idx + 1} of ${effectiveSteps.length}`}>
                    {effectiveSteps.map((step, stepIndex) => (
                        <button
                            key={step.id || stepIndex}
                            type="button"
                            className={stepIndex === idx ? "is-current" : stepIndex < idx ? "is-complete" : ""}
                            onClick={() => setIdx(stepIndex)}
                            aria-label={`Go to ${step.title || `step ${stepIndex + 1}`}`}
                            aria-current={stepIndex === idx ? "step" : undefined}
                            title={step.title}
                        >
                            <span />
                        </button>
                    ))}
                </div> : null}

                {!collapsed ? <div className="st-ft">
                    <button
                        type="button"
                        className="st-autoplay"
                        onClick={() => setAutoPlay((value) => !value)}
                        aria-pressed={autoPlay}
                    >
                        {autoPlay ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                        {autoPlay ? "Pause" : "Auto play"}
                    </button>
                    <div className="st-actions">
                        <button className="st-btn st-plain" onClick={prev} disabled={idx === 0} aria-label={controls.previous}>
                            <ArrowLeft size={14} aria-hidden="true" />
                            {controls.previous}
                        </button>
                        <button className="st-btn st-primary" onClick={next}>
                            {idx === effectiveSteps.length - 1 ? controls.done : controls.next}
                            {idx === effectiveSteps.length - 1 ? null : <ArrowRight size={14} aria-hidden="true" />}
                        </button>
                    </div>
                </div> : <div className="st-collapsed-status">{idx + 1} / {effectiveSteps.length}</div>}
            </div>

            <style jsx global>{`
                .st-mask {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.28);
                    z-index: 9998;
                }

                .st-highlight {
                    position: fixed;
                    z-index: 9999;
                    border-radius: 10px;
                    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.22);
                    pointer-events: none;
                }

                .st-pop {
                    position: fixed;
                    z-index: 10000;
                    background: #fff;
                    border: 1px solid #ebeef5;
                    border-radius: 8px;
                    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.2);
                    padding: 22px;
                    transition: opacity 160ms ease;
                    max-height: calc(100vh - 32px);
                    overflow-y: auto;
                    -webkit-user-select: none;
                    user-select: none;
                }

                .st-pop.is-collapsed {
                    padding: 9px 12px;
                    overflow: hidden;
                }

                .st-pop.is-collapsed .st-hd {
                    min-height: 32px;
                }

                .st-pop.is-collapsed .st-kicker {
                    display: none;
                }

                .st-pop.is-collapsed .st-title {
                    margin-top: 0;
                    overflow: hidden;
                    font-size: 14px;
                    line-height: 1.2;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .st-pop.is-collapsed .st-collapse,
                .st-pop.is-collapsed .st-x {
                    width: 28px;
                    height: 28px;
                }

                .st-hd {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                }

                .st-window-actions {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                }

                .st-collapse {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 30px;
                    height: 30px;
                    padding: 0;
                    border: 0;
                    border-radius: 5px;
                    background: transparent;
                    color: #718087;
                    cursor: pointer;
                }

                .st-collapse:hover {
                    background: rgba(15, 118, 110, 0.08);
                    color: #0f766e;
                }

                .st-title {
                    margin-top: 7px;
                    font-size: 27px;
                    font-weight: 800;
                    line-height: 1.25;
                    color: #303133;
                }

                .st-kicker {
                    display: block;
                    color: #0f766e;
                    font-size: 10px;
                    font-weight: 800;
                    letter-spacing: 0.1em;
                    line-height: 1;
                    text-transform: uppercase;
                }

                .st-x {
                    height: 25px;
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    font-size: 18px;
                    line-height: 1;
                    color: #909399;
                    padding: 2px 6px;
                    border-radius: 6px;
                    transition: background-color 320ms ease;
                }

                .st-pop button::before,
                .st-pop button::after {
                    content: none !important;
                    display: none !important;
                }
                
                .st-x:hover {
                    color: #1c2528 !important;
                    background: rgba(144, 147, 153, 0.12);
                }
                
                :global(body.dark-skin) .st-x:hover,
                :global(.dark) .st-x:hover {
                    color: #909399 !important;
                    background: rgba(255, 255, 255, 0.10);
                }
                
                .st-bd {
                    max-width: 470px;
                    margin-top: 13px;
                    font-size: 15px;
                    color: #606266;
                    line-height: 1.5;
                }

                .st-meta {
                    margin-top: 10px;
                    color: #0f766e;
                    font-size: 11px;
                    font-weight: 700;
                    line-height: 1.4;
                }

                .st-pronounce {
                    display: flex;
                    align-items: center;
                    gap: 11px;
                    width: 100%;
                    margin-top: 16px;
                    padding: 11px 13px;
                    border: 1px solid rgba(15, 118, 110, 0.2);
                    border-radius: 6px;
                    background: rgba(15, 118, 110, 0.06);
                    color: #0f766e;
                    cursor: pointer;
                    text-align: left;
                }

                .st-pronounce span {
                    display: flex;
                    align-items: baseline;
                    gap: 9px;
                    font-size: 11px;
                    font-weight: 700;
                }

                .st-pronounce strong {
                    color: #1f2933;
                    font-size: 16px;
                }

                .st-rail {
                    display: grid;
                    grid-template-columns: repeat(${effectiveSteps.length}, minmax(0, 1fr));
                    gap: 4px;
                    margin-top: 12px;
                    padding-top: 10px;
                    border-top: 1px solid #ebeef5;
                }

                .st-rail button {
                    height: 12px;
                    padding: 4px 0;
                    border: 0;
                    background: transparent;
                    cursor: pointer;
                }

                .st-rail button span {
                    display: block;
                    width: 100%;
                    height: 3px;
                    border-radius: 3px;
                    background: #dfe5e7;
                    transition: background-color 160ms ease, transform 160ms ease;
                }

                .st-rail button:hover span,
                .st-rail button.is-current span {
                    background: #0f766e;
                    transform: scaleY(1.7);
                }

                .st-rail button.is-complete span {
                    background: #82c7bd;
                }

                .st-map-toggle {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    gap: 7px;
                    margin-top: 7px;
                    padding: 7px 0;
                    border: 0;
                    border-bottom: 1px solid #ebeef5;
                    background: transparent;
                    color: #606b70;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: 700;
                    text-align: left;
                }

                .st-map-toggle > span {
                    margin-left: auto;
                    color: #8b969b;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 9px;
                }

                .st-map {
                    display: grid;
                    gap: 2px;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    max-height: 170px;
                    margin: 6px 0 0;
                    padding: 0;
                    overflow-y: auto;
                    list-style: none;
                }

                .st-map button {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    gap: 9px;
                    padding: 7px 8px;
                    border: 0;
                    border-radius: 4px;
                    background: transparent;
                    color: #596469;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: 650;
                    text-align: left;
                }

                .st-map button:hover,
                .st-map button.is-current {
                    background: rgba(15, 118, 110, 0.08);
                    color: #0f766e;
                }

                .st-map button span {
                    color: #8b969b;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 9px;
                }

                .st-step-actions {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 10px;
                }

                .st-context-link,
                .st-interaction {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 7px;
                    min-height: 34px;
                    padding: 7px 10px;
                    border: 1px solid rgba(15, 118, 110, 0.22);
                    border-radius: 5px;
                    background: rgba(15, 118, 110, 0.05);
                    color: #0f766e;
                    font-size: 11px;
                    font-weight: 800;
                    text-decoration: none;
                }

                .st-interaction {
                    cursor: pointer;
                }

                .st-context-link:hover,
                .st-interaction:hover {
                    border-color: #82c7bd;
                    background: rgba(15, 118, 110, 0.1);
                    color: #0b8b7d;
                }

                .st-ft {
                    margin-top: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }

                .st-count {
                    font-size: 9px;
                    color: #909399;
                }

                .st-autoplay {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 7px 0;
                    border: 0;
                    background: transparent;
                    color: #6d787d;
                    cursor: pointer;
                    font-size: 10px;
                    font-weight: 800;
                }

                .st-collapsed-status {
                    position: absolute;
                    top: 50%;
                    right: 82px;
                    max-width: 130px;
                    margin-top: 0;
                    overflow: hidden;
                    color: #7b858a;
                    font-size: 9px;
                    font-weight: 700;
                    line-height: 1;
                    text-overflow: ellipsis;
                    transform: translateY(-50%);
                    white-space: nowrap;
                }

                .st-actions {
                    display: flex;
                    gap: 8px;
                }

                .st-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 5px;
                    height: 40px;
                    border-radius: 4px;
                    border: 1px solid transparent;
                    padding: 6px 10px;
                    font-size: 12px;
                    cursor: pointer;
                    line-height: 1;
                    user-select: none;
                }

                .st-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .st-plain {
                    background: #fff;
                    border-color: #dcdfe6;
                    color: #606266;
                }

                .st-plain:hover:not(:disabled) {
                    border-color: #c6e2ff;
                    color: #409eff;
                }

                .st-primary {
                    background: #409eff;
                    border-color: #409eff;
                    color: #fff;
                }

                .st-primary:hover {
                    background: #66b1ff;
                    border-color: #66b1ff;
                }

                .st-arrow {
                    position: absolute;
                    width: 0;
                    height: 0;
                }

                .st-bottom .st-arrow {
                    top: -8px;
                    left: 18px;
                    border-left: 8px solid transparent;
                    border-right: 8px solid transparent;
                    border-bottom: 8px solid #fff;
                    filter: drop-shadow(0 -1px 0 #ebeef5);
                }

                .st-top .st-arrow {
                    bottom: -8px;
                    left: 18px;
                    border-left: 8px solid transparent;
                    border-right: 8px solid transparent;
                    border-top: 8px solid #fff;
                    filter: drop-shadow(0 1px 0 #ebeef5);
                }

                body.dark-skin .st-pop {
                    background: rgba(15, 23, 42, 0.92);
                    border-color: rgba(255, 255, 255, 0.14);
                    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
                }

                body.dark-skin .st-title {
                    color: rgba(248, 250, 252, 0.92);
                }

                body.dark-skin .st-kicker,
                body.dark-skin .st-meta,
                body.dark-skin .st-context-link {
                    color: #5eead4;
                }

                body.dark-skin .st-map-toggle {
                    border-bottom-color: rgba(255, 255, 255, 0.12);
                    color: rgba(226, 232, 240, 0.78);
                }

                body.dark-skin .st-pronounce {
                    border-color: rgba(94, 234, 212, 0.22);
                    background: rgba(94, 234, 212, 0.08);
                    color: #5eead4;
                }

                body.dark-skin .st-pronounce strong {
                    color: rgba(248, 250, 252, 0.94);
                }

                body.dark-skin .st-context-link,
                body.dark-skin .st-interaction {
                    border-color: rgba(94, 234, 212, 0.22);
                    background: rgba(94, 234, 212, 0.08);
                }

                body.dark-skin .st-autoplay {
                    color: rgba(226, 232, 240, 0.72);
                }

                body.dark-skin .st-collapse {
                    color: rgba(226, 232, 240, 0.75);
                }

                body.dark-skin .st-collapsed-status {
                    color: rgba(226, 232, 240, 0.62);
                }

                body.dark-skin .st-map button {
                    color: rgba(226, 232, 240, 0.74);
                }

                body.dark-skin .st-map button:hover,
                body.dark-skin .st-map button.is-current {
                    background: rgba(94, 234, 212, 0.1);
                    color: #5eead4;
                }

                body.dark-skin .st-rail button span {
                    background: rgba(255, 255, 255, 0.13);
                }

                body.dark-skin .st-rail {
                    border-top-color: rgba(255, 255, 255, 0.12);
                }

                body.dark-skin .st-rail button:hover span,
                body.dark-skin .st-rail button.is-current span {
                    background: #2dd4bf;
                }

                body.dark-skin .st-rail button.is-complete span {
                    background: rgba(45, 212, 191, 0.5);
                }

                body.dark-skin .st-bd {
                    color: rgba(226, 232, 240, 0.82);
                }

                body.dark-skin .st-count {
                    color: rgba(226, 232, 240, 0.65);
                }

                body.dark-skin .st-plain {
                    background: transparent;
                    border-color: rgba(255, 255, 255, 0.2);
                    color: rgba(226, 232, 240, 0.82);
                }

                body.dark-skin .st-bottom .st-arrow {
                    border-bottom-color: rgba(15, 23, 42, 0.92);
                    filter: drop-shadow(0 -1px 0 rgba(255, 255, 255, 0.14));
                }

                body.dark-skin .st-top .st-arrow {
                    border-top-color: rgba(15, 23, 42, 0.92);
                    filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.14));
                }

                @media (max-width: 600px) {
                    .st-pop {
                        padding: 16px;
                    }

                    .st-title {
                        font-size: 22px;
                    }

                    .st-bd {
                        font-size: 13px;
                    }

                    .st-step-actions {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }

                    .st-step-actions > :only-child {
                        grid-column: 1 / -1;
                    }

                    .st-pop.is-collapsed {
                        width: min(330px, calc(100vw - 20px)) !important;
                    }

                    .st-pop.is-collapsed .st-title {
                        max-width: 145px;
                    }

                    .st-pop.is-collapsed .st-collapsed-status {
                        right: 76px;
                        max-width: 92px;
                    }

                    .st-map {
                        grid-template-columns: 1fr;
                    }

                    .st-ft {
                        align-items: flex-end;
                    }

                    .st-btn {
                        height: 38px;
                        padding-inline: 9px;
                    }
                }
            `}</style>
        </>,
        document.body
    )
}
