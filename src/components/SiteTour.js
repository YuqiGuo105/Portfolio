import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n))
}

function getRect(el) {
    const r = el.getBoundingClientRect()
    return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function computePopover(anchorRect, popEl) {
    if (!anchorRect) return { style: { top: 0, left: 0, opacity: 0 }, placement: "bottom" }
    const pad = 12
    const gap = 10
    const popW = 320
    const viewportW = window.innerWidth || 1200
    const viewportH = window.innerHeight || 800
    const left = clamp(anchorRect.left, pad, viewportW - popW - pad)
    const popH = popEl?.getBoundingClientRect?.().height || 160
    const bottomTop = anchorRect.top + anchorRect.height + gap
    const topTop = anchorRect.top - popH - gap
    const canBottom = bottomTop + popH + pad <= viewportH
    const canTop = topTop >= pad
    const useBottom = canBottom || !canTop
    const top = useBottom ? bottomTop : Math.max(pad, topTop)

    return {
        style: { top, left, width: popW, opacity: 1 },
        placement: useBottom ? "bottom" : "top",
    }
}

export default function SiteTour() {
    const steps = useMemo(
        () => [
            {
                id: "about",
                targetId: "tour-about",
                title: "About Me",
                content: "Start with a quick snapshot of who I am, what I love building, and how to pronounce my name.",
            },
            {
                id: "background",
                targetId: "tour-background",
                title: "My Background",
                content: "See where I've studied, the teams I've contributed to, and the technical domains I've focused on.",
            },
            {
                id: "projects",
                targetId: "tour-projects",
                title: "My Projects",
                content: "Browse the flagship projects I've shipped, the problems they solve, and the stacks I used to build them.",
            },
            {
                id: "techblogs",
                targetId: "tour-techblogs",
                title: "My Technical Blogs",
                content: "Explore deep dives, system design notes, and hands-on write-ups that showcase how I approach new challenges.",
            },
            {
                id: "life",
                targetId: "tour-life",
                title: "My Vibrant Life",
                content: "Get a glimpse of my hobbies, travels, and the moments outside of code that keep me inspired.",
            },
            {
                id: "realtime",
                targetId: "tour-real-time-data",
                title: "Real-Time Data",
                content: "See live market moves, quick currency conversions, and a snapshot of the weather I'm tracking right now.",
            },
            {
                id: "contact",
                targetId: "tour-contact",
                title: "Contact Me",
                content: "Wrap up with the best ways to reach me, whether you want to collaborate, hire, or just say hello.",
            },
        ],
        []
    )

    const [open, setOpen] = useState(false)
    const [idx, setIdx] = useState(0)
    const [anchorRect, setAnchorRect] = useState(null)
    const popRef = useRef(null)
    const activeElRef = useRef(null)
    const rafRef = useRef(0)
    const [uiReady, setUiReady] = useState(false)
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
        activeElRef.current = null
    }, [])
    const go = useCallback(
        (nextIdx) => {
            const step = steps[nextIdx]
            if (!step) return
            const el = document.getElementById(step.targetId)
            if (!el) return
            activeElRef.current = el
            setUiReady(false)
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
        [steps],
    )



    const next = () => {
        if (idx >= steps.length - 1) return close()
        setIdx((v) => v + 1)
    }
    const prev = () => {
        if (idx <= 0) return
        setIdx((v) => v - 1)
    }

    useEffect(() => {
        const onStart = () => {
            setOpen(true)
            setIdx(0)
            requestAnimationFrame(() => go(0))
        }
        window.addEventListener("cw:site-tour:start", onStart)
        return () => window.removeEventListener("cw:site-tour:start", onStart)
    }, [go])

    useEffect(() => {
        if (!open) return
        go(idx)
    }, [open, idx, go])

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

    if (typeof window === "undefined") return null
    if (!open) return null

    const current = steps[idx]
    const { style: baseStyle, placement } = computePopover(anchorRect, popRef.current)

    const popStyle = {
        ...baseStyle,
        opacity: uiReady ? 1 : 0,
        pointerEvents: uiReady ? "auto" : "none",
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
                className={`st-pop st-${placement}`}
                style={popStyle}
                role="dialog"
                aria-modal="true"
            >
                <div className="st-hd">
                    <div className="st-title">{current?.title}</div>
                    <button className="st-x" onClick={close} aria-label="Close">×</button>
                </div>

                <div className="st-bd">{current?.content}</div>

                <div className="st-ft">
                    <div className="st-count">{idx + 1} / {steps.length}</div>
                    <div className="st-actions">
                        <button className="st-btn st-plain" onClick={prev} disabled={idx === 0}>Prev</button>
                        <button className="st-btn st-primary" onClick={next}>
                            {idx === steps.length - 1 ? "Done" : "Next"}
                        </button>
                    </div>
                </div>

                <div className="st-arrow" />
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
                    border-radius: 6px;
                    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
                    padding: 12px 12px 10px;
                    transition: opacity 160ms ease;
                }

                .st-hd {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                }

                .st-title {
                    font-size: 14px;
                    font-weight: 700;
                    color: #303133;
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
                    margin-top: 8px;
                    font-size: 13px;
                    color: #606266;
                    line-height: 1.5;
                }

                .st-ft {
                    margin-top: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }

                .st-count {
                    font-size: 12px;
                    color: #909399;
                }

                .st-actions {
                    display: flex;
                    gap: 8px;
                }

                .st-btn {
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
            `}</style>
        </>,
        document.body
    )
}
