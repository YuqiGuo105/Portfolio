import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { consumePendingWebGuide } from "../lib/webGuide"
import TourDock from "./tour/TourDock"
import TourArrival from "./tour/TourArrival"
import TourPet from "./tour/TourPet"
import useTourNarration from "./tour/useTourNarration"
import { localizeTourStep, narrationAudio, narrationText, readingTime, tourNarrative } from "../lib/tourNarrative.mjs"
import { collectTourDiscoveries, frameTourTarget, tourPetGround } from "../lib/tourScene.mjs"

const DEFAULT_CONTROLS = { previous: "Prev", next: "Next", done: "Done", close: "Close" }
const CHINESE_NAME_AUDIO = "/assets/audio/tour/v3/chinese-name.wav"
// After a chapter's narration ends, autoplay lingers this long before walking on.
const AFTER_NARRATION_MS = 1200

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
            },
            {
                id: "life",
                targetKey: "home.lifeBlogs",
                targetId: "tour-life",
                title: "My Vibrant Life",
                content: "Get a glimpse of my hobbies, travels, and the moments outside of code that keep me inspired.",
                meta: "Travel · Photography · Life outside code",
                action: { href: "/blogs?type=life", label: "Explore life stories" },
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
            },
        ].map(step => ({ ...step, editorial: true })),
        []
    )

    // steps state supports both static default and dynamic AI-generated overrides
    const [steps, setSteps] = useState(null) // null = use STATIC_STEPS
    const [controls, setControls] = useState(DEFAULT_CONTROLS)
    const stepsRef = useRef(null)            // always mirrors current effective steps

    const [guideLanguage, setGuideLanguage] = useState("en")
    // Editorial chapters carry Chinese titles and notes; AI-generated plans arrive already in their language.
    const effectiveSteps = useMemo(
        () => (steps || STATIC_STEPS).map(step => localizeTourStep(step, guideLanguage)),
        [steps, STATIC_STEPS, guideLanguage]
    )
    // Keep ref in sync so go() always reads latest without stale closures
    stepsRef.current = effectiveSteps

    const { speaking: petSpeaking, play: playNarration, stop: stopNarration, unlock: unlockAudio } = useTourNarration()

    const [open, setOpen] = useState(false)
    const [arriving, setArriving] = useState(false)
    // Where Mr. Pot stood on the opening screen, so the guide can pick him up from that very spot.
    const stageRef = useRef(null)
    const enterGuide = useCallback(() => {
        const actor = document.querySelector("[data-tour-actor]")?.getBoundingClientRect()
        stageRef.current = actor ? { centre: actor.left + actor.width / 2, ground: actor.top + tourPetGround(actor.width, actor.height), width: actor.width } : null
        unlockAudio()
        setArriving(false)
    }, [unlockAudio])
    const [idx, setIdx] = useState(0)
    const [anchorRect, setAnchorRect] = useState(null)
    const [discoveries, setDiscoveries] = useState([])
    const [visited, setVisited] = useState([])
    const [selectedDiscovery, setSelectedDiscovery] = useState(null)
    const travelFrameRef = useRef(0)
    const travelVersionRef = useRef(0)
    const readyStepRef = useRef(-1)
    const openerRef = useRef(null)
    const popRef = useRef(null)
    const activeElRef = useRef(null)
    const rafRef = useRef(0)
    const [uiReady, setUiReady] = useState(false)
    const [mapOpen, setMapOpen] = useState(false)
    const [autoPlay, setAutoPlay] = useState(false)
    const [collapsed, setCollapsed] = useState(false)
    // Autoplay narrates each chapter; "Stop audio" during autoplay keeps it going silently.
    const [muted, setMuted] = useState(false)
    const [petHidden, setPetHidden] = useState(false)
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
        travelVersionRef.current++
        cancelAnimationFrame(travelFrameRef.current)
        openerRef.current?.focus?.({ preventScroll: true })
        setOpen(false)
        setArriving(false)
        setIdx(0)
        setSteps(null) // reset to static steps for next tour
        setControls(DEFAULT_CONTROLS)
        setMapOpen(false)
        setDiscoveries([])
        setVisited([])
        setSelectedDiscovery(null)
        setAutoPlay(false)
        setMuted(false)
        setCollapsed(false)
        stopNarration()
        setPetHidden(false)
        stageRef.current = null
        activeElRef.current = null
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("cw:site-tour:end"))
    }, [stopNarration])
    const go = useCallback(
        (nextIdx, focusFirst = true) => {
            const step = stepsRef.current[nextIdx]
            if (!step) return
            const el = document.getElementById(step.targetId)
            if (!el) return
            const version = ++travelVersionRef.current
            readyStepRef.current = -1
            cancelAnimationFrame(travelFrameRef.current)
            // Switching chapters also activates their real tab, rather than
            // describing life stories while the technical blog panel remains open.
            if (el.getAttribute('role') === 'tab' && el.getAttribute('aria-selected') !== 'true') el.click()
            activeElRef.current = el.closest('section') || el
            setSelectedDiscovery(null)
            setDiscoveries([])
            setUiReady(false)
            setAnchorRect(null)
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            window.scrollTo({ top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - 112), behavior: reduceMotion ? 'auto' : 'smooth' })
            const start = performance.now()
            let lastTop = null
            let stableCount = 0
            const watchStable = () => {
                if (version !== travelVersionRef.current) return
                const r = el.getBoundingClientRect()
                if (lastTop != null && Math.abs(r.top - lastTop) < 0.5) stableCount++
                else stableCount = 0
                lastTop = r.top
                if ((stableCount >= 3 && performance.now() - start > 150) || performance.now() - start > 1100) {
                    const items = collectTourDiscoveries(el.closest('section') || el, window.location.origin)
                    setDiscoveries(items)
                    if (focusFirst && items.length) {
                        setSelectedDiscovery(items[0])
                        activeElRef.current = items[0].element
                        window.scrollTo({ top: Math.max(0, window.scrollY + items[0].element.getBoundingClientRect().top - 112), behavior: reduceMotion ? 'auto' : 'smooth' })
                    }
                    setAnchorRect(getRect(activeElRef.current))
                    setVisited(previous => previous.includes(nextIdx) ? previous : [...previous, nextIdx])
                    readyStepRef.current = nextIdx
                    setUiReady(true)
                    return
                }
                travelFrameRef.current = requestAnimationFrame(watchStable)
            }
            travelFrameRef.current = requestAnimationFrame(watchStable)
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
            unlockAudio()
            openerRef.current = document.activeElement
            // The page is always <html lang="en">; the browser language is what the chat widget's
            // "Start web guide" button was labelled in, so the tour follows it too.
            const requestedLanguage = e?.detail?.language
                || navigator.language
                || document.documentElement.lang
            setGuideLanguage(String(requestedLanguage).toLowerCase().startsWith("zh") ? "zh" : "en")
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
            setArriving(true)
            setIdx(0)
            setCollapsed(false)
            setPetHidden(false)
        }
        const onDynamic = (e) => {
            if (e?.detail?.steps?.length > 0) {
                openerRef.current = document.activeElement
                setGuideLanguage(String(e?.detail?.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en")
                const dynamic = e.detail.steps
                setSteps(dynamic)
                stepsRef.current = dynamic
                if (e?.detail?.controls) setControls(e.detail.controls)
                // Start tour automatically with the new steps
                setOpen(true)
                setArriving(false)
                setIdx(0)
                setCollapsed(false)
                setPetHidden(false)
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
    }, [go, unlockAudio])

    useEffect(() => {
        if (typeof window === "undefined") return
        const syncVisibility = (active) => {
            window.dispatchEvent(new CustomEvent("cw:site-tour:visibility", {
                detail: { active },
            }))
        }
        syncVisibility(open)
        return () => {
            if (open) syncVisibility(false)
        }
    }, [open])

    useEffect(() => {
        if (!open || arriving) return
        go(idx)
        stopNarration()
        const travelVersion = travelVersionRef
        return () => {
            travelVersion.current++
            cancelAnimationFrame(travelFrameRef.current)
        }
    }, [open, arriving, idx, go, effectiveSteps, stopNarration])

    useEffect(() => {
        if (!open || typeof window === "undefined") return undefined

        const currentNarration = narrationAudio(effectiveSteps[idx], guideLanguage)
        const nextNarration = narrationAudio(effectiveSteps[idx + 1], guideLanguage)
        const controller = new AbortController()
        let idleHandle = null
        let timeoutHandle = null
        const warm = (url) => {
            if (!url) return
            window.fetch(url, {
                cache: "force-cache",
                priority: "low",
                signal: controller.signal,
            }).catch(() => {})
        }

        warm(currentNarration)
        if (effectiveSteps[idx]?.pronunciation) warm(CHINESE_NAME_AUDIO)
        if (nextNarration) {
            if ("requestIdleCallback" in window) {
                idleHandle = window.requestIdleCallback(() => warm(nextNarration), { timeout: 1800 })
            } else {
                timeoutHandle = window.setTimeout(() => warm(nextNarration), 800)
            }
        }

        return () => {
            controller.abort()
            if (idleHandle !== null) window.cancelIdleCallback?.(idleHandle)
            if (timeoutHandle !== null) window.clearTimeout(timeoutHandle)
        }
    }, [effectiveSteps, guideLanguage, idx, open])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (event) => {
            if (event.target?.closest?.("input, textarea, select, [contenteditable=true]")) return
            if (event.key === "Escape") { if (mapOpen) setMapOpen(false); else close(); return }
            if (event.target?.closest?.("button, a") || mapOpen || arriving) return
            if (event.key === "ArrowLeft" && idx > 0) { event.preventDefault(); unlockAudio(); setIdx((value) => value - 1) }
            if (event.key === "ArrowRight") {
                event.preventDefault()
                unlockAudio()
                if (idx >= effectiveSteps.length - 1) close()
                else setIdx((value) => value + 1)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [close, effectiveSteps.length, idx, open, mapOpen, arriving, unlockAudio])

    // Autoplay is paced by the narration: each chapter is read aloud, then the tour walks on. Muted (or when
    // the audio cannot play) it waits for a reading time based on the chapter's text instead.
    useEffect(() => {
        if (!open || arriving || !autoPlay || !uiReady || mapOpen || readyStepRef.current !== idx) return undefined
        const step = effectiveSteps[idx]
        let cancelled = false
        let timer = 0
        const walkOn = (delay) => {
            timer = window.setTimeout(() => {
                if (cancelled) return
                if (idx >= effectiveSteps.length - 1) setAutoPlay(false)
                else setIdx((value) => value + 1)
            }, delay)
        }
        if (muted) {
            walkOn(readingTime(step, guideLanguage))
        } else {
            playNarration({
                src: narrationAudio(step, guideLanguage),
                text: narrationText(step, guideLanguage),
                locale: guideLanguage === "zh" ? "zh-CN" : "en-US",
                onDone: (played) => { if (!cancelled) walkOn(played ? AFTER_NARRATION_MS : readingTime(step, guideLanguage)) },
            })
        }
        return () => {
            cancelled = true
            window.clearTimeout(timer)
            if (!muted) stopNarration()
        }
    }, [autoPlay, effectiveSteps, guideLanguage, idx, open, arriving, uiReady, mapOpen, muted, playNarration, stopNarration])

    useEffect(() => {
        const pauseWhenHidden = () => {
            if (!document.hidden) return
            setAutoPlay(false)
            stopNarration()
        }
        document.addEventListener('visibilitychange', pauseWhenHidden)
        return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
    }, [stopNarration])

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

    useEffect(() => {
        if (!open || arriving || !popRef.current || typeof ResizeObserver === "undefined") return undefined
        const observer = new ResizeObserver(scheduleUpdateRect)
        observer.observe(popRef.current)
        return () => observer.disconnect()
    }, [open, arriving, scheduleUpdateRect])

    // The opening screen's spot is for the first Mr. Pot only: one shown again later jumps in from the side.
    useEffect(() => {
        if (open && !arriving) stageRef.current = null
    }, [open, arriving])

    if (typeof window === "undefined") return null
    if (!open) return null

    const current = effectiveSteps[idx]
    const narrative = tourNarrative(current, guideLanguage)
    const currentAction = current?.action || (current?.card?.href
        ? { href: current.card.href, label: current.card.action || "Open section" }
        : current?.href
            ? { href: current.href, label: "Open section" }
            : null)
    const frame = frameTourTarget(anchorRect, window.innerWidth, window.innerHeight,
        popRef.current?.getBoundingClientRect().top || window.innerHeight - 280)

    const selectDiscovery = (item) => {
        setAutoPlay(false)
        setSelectedDiscovery(item)
        if (!item) { go(idx, false); return }
        activeElRef.current = item.element
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        window.scrollTo({ top: Math.max(0, window.scrollY + item.element.getBoundingClientRect().top - 112), behavior: reduced ? 'auto' : 'smooth' })
        scheduleUpdateRect()
    }

    const pronounceName = () => {
        setAutoPlay(false)
        if (petSpeaking) { stopNarration(); return }
        playNarration({ src: CHINESE_NAME_AUDIO, text: "郭育奇", locale: "zh-CN", rate: 0.76 })
    }

    // Listen / Stop audio, and clicking Mr. Pot. During autoplay this mutes or unmutes the narration, and the
    // autoplay effect follows; otherwise it reads the current chapter once.
    const speakCurrentStep = () => {
        if (!current) return
        if (autoPlay) {
            setMuted(value => !value)
            return
        }
        if (petSpeaking) { stopNarration(); return }
        playNarration({
            src: narrationAudio(current, guideLanguage),
            text: narrationText(current, guideLanguage),
            locale: guideLanguage === "zh" ? "zh-CN" : "en-US",
        })
    }

    const toggleAutoPlay = () => {
        unlockAudio()
        setMuted(false)
        setAutoPlay(value => !value)
    }

    const askMrPot = (suggestion) => {
        const question = typeof suggestion === "string" && suggestion.trim()
            ? `${suggestion}\n${guideLanguage === "zh" ? "当前内容" : "Current context"}: ${selectedDiscovery?.title || current?.title}${selectedDiscovery?.href ? ` (${selectedDiscovery.href})` : ""}`
            : guideLanguage === "zh"
            ? `请解释「${selectedDiscovery?.title || current?.title}」这一部分的重点，并引用相关的文章或项目作为依据。`
            : `Explain the key ideas in "${selectedDiscovery?.title || current?.title}" and cite the relevant articles or projects.`
        close()
        window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("cw:chat:open", { detail: { question } }))
        }, 0)
    }

    const hidePet = () => {
        stopNarration()
        setAutoPlay(false)
        setPetHidden(true)
    }

    return createPortal(
        <>
            {arriving && <TourArrival language={guideLanguage} onEnter={enterGuide} onClose={close} />}
            {!arriving && uiReady && frame && !mapOpen && (
                <div
                    className="st-scene-frame"
                    style={{
                        ...frame,
                    }}
                    aria-hidden="true"
                ><i /><i /><i /><i /><span className="st-scene-caption" key={idx}>{String(idx + 1).padStart(2, "0")} / {current?.title}</span></div>
            )}

            {!petHidden && !arriving ? <TourPet language={guideLanguage} title={narrative.title} chapter={current?.id}
                stop={`${idx}:${selectedDiscovery?.href || ""}`} frame={uiReady ? frame : null} dockRef={popRef}
                ready={uiReady} collapsed={collapsed} speaking={petSpeaking} mapOpen={mapOpen}
                finale={effectiveSteps.length > 1 && idx === effectiveSteps.length - 1}
                from={stageRef.current} onSpeak={speakCurrentStep} onHide={hidePet} /> : null}

            {!arriving && <TourDock ref={popRef} steps={effectiveSteps} index={idx} current={current} visited={visited}
                action={currentAction} language={guideLanguage} ready={uiReady}
                collapsed={collapsed} mapOpen={mapOpen} autoPlay={autoPlay}
                speaking={petSpeaking} petHidden={petHidden} discoveries={discoveries}
                selected={selectedDiscovery} onSelect={selectDiscovery}
                onJump={(position) => { setIdx(position); setMapOpen(false); setAutoPlay(false); if (position === idx) go(position) }}
                onClose={close} onCollapse={() => setCollapsed(value => !value)}
                onMap={() => { setMapOpen(value => !value); setAutoPlay(false) }}
                onLanguage={steps ? undefined : () => { stopNarration(); setGuideLanguage(value => value === "zh" ? "en" : "zh") }}
                onAutoPlay={toggleAutoPlay} onSpeak={speakCurrentStep} listening={autoPlay ? !muted : petSpeaking}
                timedMs={autoPlay && muted && uiReady && !mapOpen ? readingTime(current, guideLanguage) : 0}
                onAsk={askMrPot} onPronounce={pronounceName} onShowPet={() => setPetHidden(false)}
                onPrev={() => { unlockAudio(); prev() }} onNext={() => { unlockAudio(); next() }} />}

            <style jsx global>{`
                .st-scene-frame { position: fixed; z-index: 9999; pointer-events: none; border: 1px solid rgba(22, 127, 108, .22); border-radius: 5px; box-shadow: 0 0 0 100vmax rgba(21, 35, 30, .12); transition: top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease; }
                .st-scene-caption { position: absolute; top: -26px; left: 0; padding: 4px 9px; background: #171b1b; border-radius: 3px; color: #c2f6db; font: 10px/1.4 ui-monospace, monospace; letter-spacing: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: st-caption-enter 400ms ease both; }
                @keyframes st-caption-enter { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
                .st-scene-frame i { position: absolute; width: 20px; height: 20px; border: solid #219c7d; }
                .st-scene-frame i:nth-child(1) { top: -2px; left: -2px; border-width: 2px 0 0 2px; border-radius: 5px 0 0 0; }
                .st-scene-frame i:nth-child(2) { top: -2px; right: -2px; border-width: 2px 2px 0 0; border-radius: 0 5px 0 0; }
                .st-scene-frame i:nth-child(3) { bottom: -2px; left: -2px; border-width: 0 0 2px 2px; border-radius: 0 0 0 5px; }
                .st-scene-frame i:nth-child(4) { bottom: -2px; right: -2px; border-width: 0 2px 2px 0; border-radius: 0 0 5px 0; }
                @keyframes st-point-out { 0%, 100% { transform: rotate(0); } 25%, 70% { transform: rotate(22deg) translateX(18px); } }
                @keyframes st-friendly-bow { 0%, 100% { transform: rotate(0); } 30% { transform: rotate(7deg) translateY(8px); } }
                @keyframes st-hello-wave { 0%, 100% { transform: rotate(0); } 35% { transform: rotate(-9deg); } 70% { transform: rotate(7deg); } }
                @media (prefers-reduced-motion: reduce) { .st-scene-frame { transition: none; } .st-scene-caption { animation: none !important; } }
                .st-highlight {
                    position: fixed;
                    z-index: 9999;
                    border-radius: 10px;
                    border: 2px solid rgba(20, 130, 116, 0.55);
                    box-shadow: 0 0 0 5px rgba(20, 130, 116, 0.08);
                    pointer-events: none;
                }

                .st-pop {
                    position: fixed;
                    bottom: max(20px, env(safe-area-inset-bottom));
                    left: 20px;
                    width: min(390px, calc(100vw - 40px));
                    z-index: 10000;
                    background: #fff;
                    border: 1px solid #ebeef5;
                    border-radius: 8px;
                    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.2);
                    padding: 18px;
                    transition: opacity 160ms ease;
                    max-height: min(600px, calc(100dvh - 100px));
                    overflow-y: auto;
                }
                .st-explore-question { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 11px 0; margin-top: 10px; border: 0; border-top: 1px solid #e2e8e7; background: transparent; color: #137a70; font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
                .st-explore-question svg { flex-shrink: 0; }
                @media (max-width: 639px) {
                    .st-pop { left: 12px; bottom: max(12px, env(safe-area-inset-bottom)); width: calc(100vw - 24px); max-height: 48dvh; padding: 14px; }
                }

                .st-pop.is-collapsed {
                    padding: 13px 15px;
                    overflow: hidden;
                }

                .st-hd {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 10px;
                }

                .st-guide-heading {
                    display: flex;
                    align-items: center;
                    min-width: 0;
                    gap: 14px;
                }

                .st-heading-copy {
                    min-width: 0;
                }

                .st-roaming-pet {
                    position: fixed;
                    top: 0;
                    left: 0;
                    z-index: 10002;
                    width: var(--st-pet-width, 144px);
                    height: var(--st-pet-height, 168px);
                    opacity: 0;
                    cursor: grab;
                    outline: none;
                    pointer-events: none;
                    touch-action: none;
                    user-select: none;
                    transition: opacity 180ms ease;
                    will-change: transform;
                }

                .st-roaming-pet.is-ready {
                    opacity: 1;
                    pointer-events: auto;
                }

                .st-roaming-pet.is-dragging {
                    cursor: grabbing;
                }

                .st-roaming-pet:focus-visible .st-roaming-pet-body {
                    filter: drop-shadow(0 0 0.32rem rgba(45, 212, 191, 0.95));
                }

                .st-roaming-pet-body {
                    position: relative;
                    z-index: 2;
                    width: 100%;
                    height: 100%;
                    filter: drop-shadow(0 8px 9px rgba(15, 23, 42, 0.2));
                    overflow: visible;
                    transform-origin: 50% var(--st-pet-ground, 87%);
                    will-change: transform;
                }

                .st-pet-close {
                    position: absolute;
                    top: 7px;
                    right: -8px;
                    z-index: 6;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 23px;
                    height: 23px;
                    padding: 0;
                    border: 1px solid rgba(15, 23, 42, 0.15);
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.96);
                    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.16);
                    color: #334155;
                    cursor: pointer;
                    opacity: 0.82;
                    transform: scale(0.96);
                    transition: opacity 160ms ease, transform 160ms ease, background 160ms ease;
                }

                .st-roaming-pet:hover .st-pet-close,
                .st-roaming-pet:focus-within .st-pet-close,
                .st-pet-close:focus-visible {
                    opacity: 1;
                    transform: scale(1);
                }

                .st-pet-close:hover {
                    background: #f8fafc;
                }

                .st-pet-close::before,
                .st-pet-close::after {
                    display: none !important;
                    content: none !important;
                }

                body.dark-skin .st-pet-close {
                    border-color: rgba(255, 255, 255, 0.2);
                    background: rgba(30, 41, 59, 0.96);
                    color: #f8fafc;
                }

                body.dark-skin .st-pet-close:hover {
                    background: #334155;
                }

                .st-roaming-shadow {
                    position: absolute;
                    right: 19%;
                    top: calc(var(--st-pet-ground, 87%) - 3px);
                    left: 19%;
                    z-index: 1;
                    height: 8px;
                    border-radius: 50%;
                    background: rgba(15, 23, 42, 0.22);
                    filter: blur(3px);
                    will-change: transform, opacity;
                }

                .st-roaming-bubble {
                    position: absolute;
                    bottom: calc(100% + 1px);
                    left: 50%;
                    z-index: 4;
                    width: max-content;
                    max-width: 190px;
                    padding: 8px 10px;
                    border: 1px solid rgba(15, 118, 110, 0.2);
                    border-radius: 7px;
                    background: rgba(255, 255, 255, 0.96);
                    box-shadow: 0 8px 22px rgba(15, 23, 42, 0.14);
                    color: #45545c;
                    opacity: 1;
                    transform: translateX(-50%) translateY(0) scale(1);
                    transform-origin: 50% calc(100% + 6px);
                    transition: opacity 140ms ease, transform 320ms cubic-bezier(0.3, 1.5, 0.5, 1);
                    text-align: center;
                    pointer-events: none;
                }

                .st-roaming-bubble::after {
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    border: 6px solid transparent;
                    border-top-color: rgba(255, 255, 255, 0.96);
                    content: "";
                    transform: translateX(-50%);
                }

                .st-roaming-bubble strong,
                .st-roaming-bubble span {
                    display: block;
                }

                .st-roaming-bubble strong {
                    color: #0f766e;
                    font-size: 9px;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                }

                .st-roaming-bubble span {
                    max-width: 166px;
                    overflow: hidden;
                    font-size: 11px;
                    font-weight: 800;
                    white-space: normal;
                    line-height: 1.35;
                }

                .st-roaming-pet.is-walking.is-leading .st-roaming-bubble,
                .st-roaming-pet.is-dragging .st-roaming-bubble {
                    opacity: 0;
                    transform: translateX(-50%) translateY(8px) scale(0.7);
                    transition: opacity 100ms ease, transform 120ms ease-in;
                }

                .st-roaming-pet.is-speaking .st-roaming-pet-body::before,
                .st-roaming-pet.is-speaking .st-roaming-pet-body::after {
                    position: absolute;
                    top: 23px;
                    right: -5px;
                    width: 8px;
                    height: 14px;
                    border: 2px solid #0f766e;
                    border-top-color: transparent;
                    border-bottom-color: transparent;
                    border-left: 0;
                    border-radius: 0 14px 14px 0;
                    content: "";
                    animation: st-pet-sound 900ms ease-out infinite;
                }

                .st-roaming-pet.is-speaking .st-roaming-pet-body::after {
                    top: 17px;
                    right: -12px;
                    width: 13px;
                    height: 26px;
                    animation-delay: 180ms;
                }

                .st-pet-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 5px;
                    margin-top: 8px;
                }

                .st-pet-actions button {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    min-height: 27px;
                    padding: 5px 8px;
                    border: 1px solid rgba(15, 118, 110, 0.2);
                    border-radius: 4px;
                    background: rgba(15, 118, 110, 0.05);
                    color: #0f766e;
                    cursor: pointer;
                    font-size: 9px;
                    font-weight: 800;
                }

                .st-pet-actions button:hover {
                    border-color: rgba(15, 118, 110, 0.42);
                    background: rgba(15, 118, 110, 0.1);
                }

                .st-ai-voice {
                    align-self: center;
                    color: #7b8794;
                    font-size: 8px;
                    font-weight: 700;
                    letter-spacing: 0;
                }

                .st-pop.is-collapsed .st-guide-heading {
                    gap: 9px;
                }

                .st-pop.is-collapsed .st-title {
                    max-width: 245px;
                    margin-top: 3px;
                    overflow: hidden;
                    font-size: 14px;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                @keyframes st-pet-sound {
                    0% { opacity: 0; transform: scale(0.75); }
                    45% { opacity: 0.9; }
                    100% { opacity: 0; transform: scale(1.12); }
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
                    font-size: 24px;
                    overflow-wrap: anywhere;
                    font-weight: 800;
                    line-height: 1.25;
                    color: #303133;
                }

                .st-kicker {
                    display: block;
                    color: #0f766e;
                    font-size: 10px;
                    font-weight: 800;
                    letter-spacing: 0;
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
                    margin-top: 13px;
                }

                .st-rail button {
                    height: 24px;
                    padding: 10px 0;
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

                .st-context-link {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    margin-top: 9px;
                    color: #0f766e;
                    font-size: 11px;
                    font-weight: 800;
                    text-decoration: none;
                }

                .st-context-link:hover {
                    color: #0b8b7d;
                    text-decoration: underline;
                    text-underline-offset: 3px;
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
                    margin-top: 5px;
                    color: #7b858a;
                    font-size: 10px;
                    font-weight: 700;
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

                body.dark-skin .st-pet-actions button {
                    border-color: rgba(94, 234, 212, 0.22);
                    background: rgba(94, 234, 212, 0.08);
                    color: #5eead4;
                }

                body.dark-skin .st-roaming-bubble {
                    border-color: rgba(94, 234, 212, 0.24);
                    background: rgba(15, 23, 42, 0.96);
                    color: rgba(226, 232, 240, 0.86);
                }

                body.dark-skin .st-roaming-bubble::after {
                    border-top-color: rgba(15, 23, 42, 0.96);
                }

                body.dark-skin .st-roaming-bubble strong {
                    color: #5eead4;
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

                    .st-guide-heading {
                        gap: 9px;
                    }

                    .st-roaming-pet {
                        width: var(--st-pet-width, 104px);
                        height: var(--st-pet-height, 122px);
                    }

                    .st-roaming-pet-body {
                        width: 100%;
                        height: 100%;
                    }

                    .st-pet-close {
                        top: 4px;
                        right: -9px;
                        width: 25px;
                        height: 25px;
                        opacity: 1;
                        transform: scale(1);
                    }

                    .st-roaming-bubble {
                        max-width: 142px;
                        padding: 6px 8px;
                    }

                    .st-roaming-bubble span {
                        max-width: 122px;
                        font-size: 10px;
                    }

                    .st-title {
                        font-size: 20px;
                    }

                    .st-bd {
                        font-size: 13px;
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

                @media (prefers-reduced-motion: reduce) {
                    .st-roaming-pet,
                    .st-roaming-bubble,
                    .st-roaming-pet.is-speaking .st-roaming-pet-body::before,
                    .st-roaming-pet.is-speaking .st-roaming-pet-body::after {
                        animation: none !important;
                        transition: none !important;
                    }
                }
            `}</style>
        </>,
        document.body
    )
}
