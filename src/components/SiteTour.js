import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { consumePendingWebGuide } from "../lib/webGuide"
import TourDock from "./tour/TourDock"
import TourArrival from "./tour/TourArrival"
import { tourNarrative } from "../lib/tourNarrative.mjs"
import { collectTourDiscoveries, frameTourTarget, tourPetDimensions } from "../lib/tourScene.mjs"

const DEFAULT_CONTROLS = { previous: "Prev", next: "Next", done: "Done", close: "Close" }
const CHINESE_NAME_AUDIO = "/assets/audio/tour/v3/chinese-name.wav"
const HIGH_QUALITY_VOICE_HINT = /enhanced|premium|neural|natural|siri|online/i
const LOW_QUALITY_VOICE_HINT = /compact|espeak|festival|novelty/i

function selectNaturalVoice(voices, locale) {
    if (!Array.isArray(voices) || voices.length === 0) return null
    const target = String(locale || "en-US").toLowerCase()
    const language = target.split("-")[0]

    return voices
        .map((voice, index) => {
            const voiceLocale = String(voice.lang || "").toLowerCase()
            const searchable = `${voice.name || ""} ${voice.voiceURI || ""}`
            let score = 0
            if (voiceLocale === target) score += 120
            else if (voiceLocale.split("-")[0] === language) score += 80
            if (HIGH_QUALITY_VOICE_HINT.test(searchable)) score += 45
            if (voice.localService) score += 18
            if (voice.default) score += 12
            if (LOW_QUALITY_VOICE_HINT.test(searchable)) score -= 80
            return { voice, index, score }
        })
        .filter(({ voice }) => String(voice.lang || "").toLowerCase().split("-")[0] === language)
        .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.voice || null
}

function createNaturalUtterance(text, locale, voices) {
    const utterance = new SpeechSynthesisUtterance(text)
    const selectedVoice = selectNaturalVoice(voices, locale)
    utterance.lang = locale
    utterance.voice = selectedVoice
    utterance.rate = locale.toLowerCase().startsWith("zh") ? 0.84 : 0.9
    utterance.pitch = 1.02
    utterance.volume = 1
    return utterance
}

function getRect(el) {
    const r = el.getBoundingClientRect()
    return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

function rectsOverlap(a, b, padding = 0) {
    return !(
        a.right + padding < b.left
        || a.left - padding > b.right
        || a.bottom + padding < b.top
        || a.top - padding > b.bottom
    )
}

function MrPotRig() {
    const imageHref = "/assets/images/mr-pot-tour-guide.png"

    return (
        <svg className="st-pet-rig" viewBox="0 0 1224 1285" aria-hidden="true">
            <defs>
                <clipPath id="st-pet-steam-clip">
                    <rect x="500" y="20" width="205" height="205" />
                </clipPath>
                <clipPath id="st-pet-head-clip">
                    <path d="M238 195H1000V580H880L855 695 795 765H440L322 730 298 590H238Z" />
                </clipPath>
                <clipPath id="st-pet-core-clip">
                    <path d="M438 742H750L780 864 764 1015H438L420 865Z" />
                </clipPath>
                <clipPath id="st-pet-left-arm-clip">
                    <path d="M320 760H465V1020H320Z" />
                </clipPath>
                <clipPath id="st-pet-right-arm-clip">
                    <path d="M750 780L845 722 890 590H1020V870L790 920 740 855Z" />
                </clipPath>
                <clipPath id="st-pet-left-leg-clip">
                    <path d="M405 995H595V1180H405Z" />
                </clipPath>
                <clipPath id="st-pet-right-leg-clip">
                    <path d="M600 995H815V1180H600Z" />
                </clipPath>
            </defs>

            <g className="st-pet-layer st-pet-arm st-pet-arm-left" clipPath="url(#st-pet-left-arm-clip)">
                <image href={imageHref} width="1224" height="1285" />
            </g>
            <g className="st-pet-layer st-pet-arm st-pet-arm-right" clipPath="url(#st-pet-right-arm-clip)">
                <image href={imageHref} width="1224" height="1285" />
            </g>
            <g className="st-pet-layer st-pet-leg st-pet-leg-left" clipPath="url(#st-pet-left-leg-clip)">
                <image href={imageHref} width="1224" height="1285" />
            </g>
            <g className="st-pet-layer st-pet-leg st-pet-leg-right" clipPath="url(#st-pet-right-leg-clip)">
                <image href={imageHref} width="1224" height="1285" />
            </g>
            <g className="st-pet-layer st-pet-core" clipPath="url(#st-pet-core-clip)">
                <image href={imageHref} width="1224" height="1285" />
            </g>
            <g className="st-pet-layer st-pet-head" clipPath="url(#st-pet-head-clip)">
                <image href={imageHref} width="1224" height="1285" />
            </g>
            <g className="st-pet-layer st-pet-steam" clipPath="url(#st-pet-steam-clip)">
                <image href={imageHref} width="1224" height="1285" />
            </g>
        </svg>
    )
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
                narration: "/assets/audio/tour/v1/hero.mp3",
            },
            {
                id: "about",
                targetKey: "home.about",
                targetId: "tour-about",
                title: "About Me",
                content: "Start with a quick snapshot of who I am, what I love building, and how to pronounce my name.",
                meta: "Profile · Engineering focus · Current role",
                narration: "/assets/audio/tour/v1/about.mp3",
            },
            {
                id: "background",
                targetKey: "home.background",
                targetId: "tour-background",
                title: "My Background",
                content: "See where I've studied, the teams I've contributed to, and the technical domains I've focused on.",
                meta: "Experience · Education · Technical foundation",
                action: { href: "/cv", label: "View CV" },
                narration: "/assets/audio/tour/v1/background.mp3",
            },
            {
                id: "projects",
                targetKey: "home.projects",
                targetId: "tour-projects",
                title: "My Projects",
                content: "Browse the flagship projects I've shipped, the problems they solve, and the stacks I used to build them.",
                meta: "Distributed systems · AI platform · Production operations",
                action: { href: "/works-list", label: "Explore all projects" },
                narration: "/assets/audio/tour/v1/projects.mp3",
            },
            {
                id: "techblogs",
                targetKey: "home.techBlogs",
                targetId: "tour-techblogs",
                title: "My Technical Blogs",
                content: "Explore deep dives, system design notes, and hands-on write-ups that showcase how I approach new challenges.",
                meta: "System design · Backend · Infrastructure",
                action: { href: "/blogs?type=technical", label: "Read technical writing" },
                narration: "/assets/audio/tour/v1/tech-blogs.mp3",
            },
            {
                id: "life",
                targetKey: "home.lifeBlogs",
                targetId: "tour-life",
                title: "My Vibrant Life",
                content: "Get a glimpse of my hobbies, travels, and the moments outside of code that keep me inspired.",
                meta: "Travel · Photography · Life outside code",
                action: { href: "/blogs?type=life", label: "Explore life stories" },
                narration: "/assets/audio/tour/v1/life.mp3",
            },
            {
                id: "realtime",
                targetKey: "home.dashboard",
                targetId: "tour-real-time-data",
                title: "Real-Time Data",
                content: "See live market moves, quick currency conversions, and a snapshot of the weather I'm tracking right now.",
                meta: "Live services · Visitor intelligence · Observability",
                action: { href: "/analytics", label: "Open analytics" },
                narration: "/assets/audio/tour/v1/dashboard.mp3",
            },
            {
                id: "contact",
                targetKey: "home.contact",
                targetId: "tour-contact",
                title: "Contact Me",
                content: "Wrap up with the best ways to reach me, whether you want to collaborate, hire, or just say hello.",
                meta: "Recruiting · Collaboration · Direct contact",
                narration: "/assets/audio/tour/v1/contact.mp3",
            },
        ].map(step => ({ ...step, editorial: true })),
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
    const [arriving, setArriving] = useState(false)
    const enterGuide = useCallback(() => setArriving(false), [])
    const [idx, setIdx] = useState(0)
    const [anchorRect, setAnchorRect] = useState(null)
    const [discoveries, setDiscoveries] = useState([])
    const [visited, setVisited] = useState([])
    const [selectedDiscovery, setSelectedDiscovery] = useState(null)
    const travelFrameRef = useRef(0)
    const travelVersionRef = useRef(0)
    const openerRef = useRef(null)
    const popRef = useRef(null)
    const activeElRef = useRef(null)
    const rafRef = useRef(0)
    const [uiReady, setUiReady] = useState(false)
    const [mapOpen, setMapOpen] = useState(false)
    const [autoPlay, setAutoPlay] = useState(false)
    const [collapsed, setCollapsed] = useState(false)
    const [guideLanguage, setGuideLanguage] = useState("en")
    const [petSpeaking, setPetSpeaking] = useState(false)
    const [petFacing, setPetFacing] = useState(1)
    const [petWalking, setPetWalking] = useState(false)
    const [petDragging, setPetDragging] = useState(false)
    const [petReady, setPetReady] = useState(false)
    const [petHidden, setPetHidden] = useState(false)
    const [availableVoices, setAvailableVoices] = useState([])
    const [petTransform, setPetTransform] = useState("translate3d(-120px, 120px, 0)")
    const petPositionRef = useRef({ x: -120, y: 120 })
    const narrationAudioRef = useRef(null)
    const petBaseRef = useRef({ x: -120, y: 120 })
    const petMoveTimerRef = useRef(0)
    const petPatrolTimerRef = useRef(0)
    const petDraggingRef = useRef(false)
    const petDragRef = useRef({
        pointerId: null,
        offsetX: 0,
        offsetY: 0,
        startX: 0,
        startY: 0,
        lastX: 0,
        moved: false,
    })
    const movePetTo = useCallback((position) => {
        setPetTransform(`translate3d(${position.x}px, ${position.y}px, 0)`)
    }, [])
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
        setCollapsed(false)
        setPetSpeaking(false)
        setPetReady(false)
        setPetHidden(false)
        setPetWalking(false)
        setPetDragging(false)
        petDraggingRef.current = false
        petDragRef.current.pointerId = null
        petDragRef.current.moved = false
        activeElRef.current = null
        if (typeof window !== "undefined") {
            narrationAudioRef.current?.pause()
            narrationAudioRef.current = null
            window.speechSynthesis?.cancel()
            window.clearTimeout(petMoveTimerRef.current)
            window.clearInterval(petPatrolTimerRef.current)
            petPositionRef.current = { x: -120, y: 120 }
            setPetTransform("translate3d(-120px, 120px, 0)")
            window.dispatchEvent(new CustomEvent("cw:site-tour:end"))
        }
    }, [])
    const go = useCallback(
        (nextIdx, focusFirst = true) => {
            const step = stepsRef.current[nextIdx]
            if (!step) return
            const el = document.getElementById(step.targetId)
            if (!el) return
            const version = ++travelVersionRef.current
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
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined
        const synth = window.speechSynthesis
        const refreshVoices = () => setAvailableVoices(synth.getVoices())
        refreshVoices()
        synth.addEventListener?.("voiceschanged", refreshVoices)
        return () => synth.removeEventListener?.("voiceschanged", refreshVoices)
    }, [])

    useEffect(() => {
        const onStart = (e) => {
            openerRef.current = document.activeElement
            const requestedLanguage = e?.detail?.language
                || document.documentElement.lang
                || navigator.language
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
    }, [go])

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
        narrationAudioRef.current?.pause()
        narrationAudioRef.current = null
        window.speechSynthesis?.cancel()
        setPetSpeaking(false)
        const travelVersion = travelVersionRef
        return () => {
            travelVersion.current++
            cancelAnimationFrame(travelFrameRef.current)
        }
    }, [open, arriving, idx, go, effectiveSteps])

    useEffect(() => {
        if (!open || typeof window === "undefined") return undefined

        const currentNarration = effectiveSteps[idx]?.narration
        const nextNarration = effectiveSteps[idx + 1]?.narration
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
    }, [effectiveSteps, idx, open])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (event) => {
            if (event.target?.closest?.("input, textarea, select, [contenteditable=true]")) return
            if (event.key === "Escape") { if (mapOpen) setMapOpen(false); else close(); return }
            if (event.target?.closest?.("button, a") || mapOpen || arriving) return
            if (event.key === "ArrowLeft" && idx > 0) { event.preventDefault(); setIdx((value) => value - 1) }
            if (event.key === "ArrowRight") {
                event.preventDefault()
                if (idx >= effectiveSteps.length - 1) close()
                else setIdx((value) => value + 1)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [close, effectiveSteps.length, idx, open, mapOpen, arriving])

    useEffect(() => {
        if (!open || arriving || !autoPlay || !uiReady || petSpeaking || petDragging || mapOpen) return
        const timer = window.setTimeout(() => {
            if (idx >= effectiveSteps.length - 1) setAutoPlay(false)
            else setIdx((value) => value + 1)
        }, 8000)
        return () => window.clearTimeout(timer)
    }, [autoPlay, effectiveSteps.length, idx, open, arriving, uiReady, petSpeaking, petDragging, mapOpen])

    useEffect(() => {
        const pauseWhenHidden = () => { if (document.hidden) setAutoPlay(false) }
        document.addEventListener('visibilitychange', pauseWhenHidden)
        return () => {
            document.removeEventListener('visibilitychange', pauseWhenHidden)
            narrationAudioRef.current?.pause()
            window.speechSynthesis?.cancel()
        }
    }, [])

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

    useEffect(() => {
        if (!open || !uiReady || petHidden || typeof window === "undefined") return

        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const mobile = viewportWidth < 640
        const { width: petWidth, height: petHeight, margin } = tourPetDimensions(viewportWidth, viewportHeight)
        const dialogRect = popRef.current?.getBoundingClientRect()
        const framedRect = frameTourTarget(anchorRect, viewportWidth, viewportHeight, dialogRect?.top || viewportHeight)
        const target = framedRect
            ? {
                left: framedRect.left,
                top: framedRect.top,
                width: framedRect.width,
                height: framedRect.height,
                right: framedRect.left + framedRect.width,
                bottom: framedRect.top + framedRect.height,
              }
            : null

        const candidates = target
            ? [
                { x: target.right - petWidth - 24, y: target.top - petHeight - 16 },
                { x: target.left + 24, y: target.top - petHeight - 16 },
                { x: target.right + 16, y: target.top + Math.min(72, target.height * 0.25) },
                { x: target.left - petWidth - 16, y: target.top + Math.min(72, target.height * 0.25) },
                { x: target.right - petWidth - 24, y: target.bottom + 16 },
                { x: target.left + 24, y: target.bottom + 16 },
              ]
            : []

        candidates.push(
            { x: margin, y: viewportHeight - petHeight - margin },
            { x: viewportWidth - petWidth - margin, y: viewportHeight - petHeight - margin },
            { x: margin, y: mobile ? 92 : 120 },
            { x: viewportWidth - petWidth - margin, y: mobile ? 92 : 120 },
        )

        const safeCandidates = candidates
            .map((candidate) => ({
                x: clamp(candidate.x, margin, viewportWidth - petWidth - margin),
                y: clamp(candidate.y, mobile ? 82 : 96, viewportHeight - petHeight - margin),
            }))
            .filter((candidate) => {
                if (!dialogRect) return true
                const petRect = {
                    left: candidate.x,
                    top: candidate.y,
                    right: candidate.x + petWidth,
                    bottom: candidate.y + petHeight,
                }
                return !rectsOverlap(petRect, dialogRect, 14)
            })

        const destination = safeCandidates[0]
            || { x: margin, y: viewportHeight - petHeight - margin }
        const previous = petPositionRef.current

        petBaseRef.current = destination
        if (Math.abs(destination.x - previous.x) > 4) {
            setPetFacing(destination.x > previous.x ? 1 : -1)
        }
        setPetWalking(true)
        setPetReady(true)
        petPositionRef.current = destination
        movePetTo(destination)
        window.clearTimeout(petMoveTimerRef.current)
        petMoveTimerRef.current = window.setTimeout(() => setPetWalking(false), 820)

        window.clearInterval(petPatrolTimerRef.current)
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) petPatrolTimerRef.current = window.setInterval(() => {
            if (petDraggingRef.current) return
            const base = petBaseRef.current
            const current = petPositionRef.current
            const direction = Math.random() > 0.5 ? 1 : -1
            const next = {
                x: clamp(base.x + direction * (mobile ? 26 : 52), margin, viewportWidth - petWidth - margin),
                y: clamp(base.y + (Math.random() > 0.5 ? 8 : -8), mobile ? 82 : 96, viewportHeight - petHeight - margin),
            }
            if (dialogRect && rectsOverlap({ left: next.x, top: next.y, right: next.x + petWidth, bottom: next.y + petHeight }, dialogRect, 14)) return
            setPetFacing(next.x >= current.x ? 1 : -1)
            setPetWalking(true)
            petPositionRef.current = next
            movePetTo(next)
            window.clearTimeout(petMoveTimerRef.current)
            petMoveTimerRef.current = window.setTimeout(() => setPetWalking(false), 760)
        }, 3600)

        return () => {
            window.clearTimeout(petMoveTimerRef.current)
            window.clearInterval(petPatrolTimerRef.current)
        }
    }, [anchorRect, idx, movePetTo, open, petHidden, uiReady, collapsed])

    useEffect(() => {
        if (!petDragging || typeof window === "undefined") return
        const releaseDrag = () => {
            petDragRef.current.pointerId = null
            petDraggingRef.current = false
            setPetDragging(false)
            setPetWalking(false)
        }
        window.addEventListener("pointerup", releaseDrag)
        window.addEventListener("pointercancel", releaseDrag)
        window.addEventListener("blur", releaseDrag)
        return () => {
            window.removeEventListener("pointerup", releaseDrag)
            window.removeEventListener("pointercancel", releaseDrag)
            window.removeEventListener("blur", releaseDrag)
        }
    }, [petDragging])

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

    const speakWithBrowserFallback = (text, locale, rate = 0.94) => {
        if (!("speechSynthesis" in window)) {
            setPetSpeaking(false)
            return
        }
        const utterance = createNaturalUtterance(text, locale, availableVoices)
        utterance.rate = rate
        utterance.onend = () => setPetSpeaking(false)
        utterance.onerror = () => setPetSpeaking(false)
        setPetSpeaking(true)
        window.speechSynthesis.speak(utterance)
    }

    const pronounceName = () => {
        if (petSpeaking) {
            narrationAudioRef.current?.pause()
            narrationAudioRef.current = null
            window.speechSynthesis?.cancel()
            setPetSpeaking(false)
            return
        }
        narrationAudioRef.current?.pause()
        window.speechSynthesis?.cancel()
        const audio = new Audio(CHINESE_NAME_AUDIO)
        audio.preload = "auto"
        narrationAudioRef.current = audio
        let fallbackStarted = false
        const fallback = () => {
            if (fallbackStarted) return
            fallbackStarted = true
            narrationAudioRef.current = null
            speakWithBrowserFallback("郭育奇", "zh-CN", 0.76)
        }
        audio.onended = () => {
            narrationAudioRef.current = null
            setPetSpeaking(false)
        }
        audio.onerror = fallback
        setPetSpeaking(true)
        audio.load()
        audio.play().catch(fallback)
    }

    const speakCurrentStep = () => {
        if (!current) return
        if (petSpeaking) {
            narrationAudioRef.current?.pause()
            narrationAudioRef.current = null
            window.speechSynthesis?.cancel()
            setPetSpeaking(false)
            return
        }

        if (current.narration) {
            window.speechSynthesis?.cancel()
            const audio = new Audio(current.narration)
            narrationAudioRef.current = audio
            let fallbackStarted = false
            const fallback = () => {
                if (fallbackStarted) return
                fallbackStarted = true
                narrationAudioRef.current = null
                speakWithBrowserFallback(
                    `${current.title}. ${current.content}`,
                    guideLanguage === "zh" ? "zh-CN" : "en-US"
                )
            }
            audio.onended = () => {
                narrationAudioRef.current = null
                setPetSpeaking(false)
            }
            audio.onerror = fallback
            setPetSpeaking(true)
            audio.play().catch(fallback)
            return
        }

        window.speechSynthesis?.cancel()
        const locale = guideLanguage === "zh" ? "zh-CN" : "en-US"
        speakWithBrowserFallback(`${current.title}. ${current.content}`, locale)
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

    const petDimensions = () => {
        return tourPetDimensions(window.innerWidth, window.innerHeight)
    }

    const startPetDrag = (event) => {
        if (!petReady || (event.pointerType === "mouse" && event.button !== 0)) return
        const rect = event.currentTarget.getBoundingClientRect()
        petDragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            moved: false,
        }
        petDraggingRef.current = true
        setPetDragging(true)
        setPetWalking(false)
        petPositionRef.current = { x: rect.left, y: rect.top }
        petBaseRef.current = { x: rect.left, y: rect.top }
        movePetTo({ x: rect.left, y: rect.top })
        window.clearTimeout(petMoveTimerRef.current)
        event.currentTarget.setPointerCapture?.(event.pointerId)
        event.preventDefault()
    }

    const movePetDrag = (event) => {
        const drag = petDragRef.current
        if (!petDraggingRef.current || drag.pointerId !== event.pointerId) return
        const { width, height, margin, minY } = petDimensions()
        const next = {
            x: clamp(event.clientX - drag.offsetX, margin, window.innerWidth - width - margin),
            y: clamp(event.clientY - drag.offsetY, minY, window.innerHeight - height - margin),
        }
        const deltaX = event.clientX - drag.lastX
        if (Math.abs(deltaX) > 2) setPetFacing(deltaX > 0 ? 1 : -1)
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
            drag.moved = true
        }
        drag.lastX = event.clientX
        petPositionRef.current = next
        petBaseRef.current = next
        movePetTo(next)
        event.preventDefault()
    }

    const stopPetDrag = (event) => {
        const drag = petDragRef.current
        if (!petDraggingRef.current || drag.pointerId !== event.pointerId) return
        event.currentTarget.releasePointerCapture?.(event.pointerId)
        drag.pointerId = null
        petDraggingRef.current = false
        setPetDragging(false)
        setPetWalking(false)
    }

    const activatePet = () => {
        if (petDragRef.current.moved) {
            petDragRef.current.moved = false
            return
        }
        speakCurrentStep()
    }

    return createPortal(
        <>
            {arriving && <TourArrival language={guideLanguage} onEnter={enterGuide} onClose={close}><MrPotRig /></TourArrival>}
            {!arriving && uiReady && frame && !mapOpen && (
                <div
                    className="st-scene-frame"
                    style={{
                        ...frame,
                    }}
                    aria-hidden="true"
                ><i /><i /><i /><i /><span className="st-scene-caption" key={idx}>{String(idx + 1).padStart(2, "0")} / {current?.title}</span></div>
            )}

            {!petHidden && !arriving ? <div
                className={`st-roaming-pet${petReady ? " is-ready" : ""}${petWalking ? " is-walking" : ""}${petSpeaking ? " is-speaking" : ""}${petDragging ? " is-dragging" : ""}`}
                data-chapter={current?.id}
                style={{
                    transform: petTransform,
                    "--st-pet-facing": petFacing,
                    "--st-pet-width": `${petDimensions().width}px`,
                    "--st-pet-height": `${petDimensions().height}px`,
                }}
                role="group"
                draggable={false}
                aria-grabbed={petDragging}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={startPetDrag}
                onPointerMove={movePetDrag}
                onPointerUp={stopPetDrag}
                onPointerCancel={stopPetDrag}
                onLostPointerCapture={stopPetDrag}
            >
                <button
                    type="button"
                    className="st-pet-close"
                    aria-label={guideLanguage === "zh" ? "关闭 Mr.Pot" : "Close Mr.Pot"}
                    title={guideLanguage === "zh" ? "关闭 Mr.Pot" : "Close Mr.Pot"}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation()
                        narrationAudioRef.current?.pause()
                        narrationAudioRef.current = null
                        window.speechSynthesis?.cancel()
                        window.clearInterval(petPatrolTimerRef.current)
                        setPetSpeaking(false)
                        setPetWalking(false)
                        setPetHidden(true)
                    }}
                >
                    <X size={13} aria-hidden="true" />
                </button>
                <div className="st-roaming-bubble">
                    <strong>{petWalking ? guideLanguage === "zh" ? "跟我来" : "Follow me" : petSpeaking ? guideLanguage === "zh" ? "正在讲解" : "Speaking" : guideLanguage === "zh" ? "我们到了" : "Here we are"}</strong>
                    <span>{petWalking ? guideLanguage === "zh" ? "这边，有东西想给你看。" : "Something to show you." : narrative.title}</span>
                </div>
                <div
                    className="st-roaming-pet-body"
                    role="button"
                    tabIndex={0}
                    aria-label={guideLanguage === "zh" ? "点击 Mr.Pot 听当前区域讲解" : "Click Mr.Pot to narrate this section"}
                    onClick={activatePet}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            speakCurrentStep()
                        }
                    }}
                >
                    <MrPotRig />
                </div>
                <span className="st-roaming-shadow" />
            </div> : null}

            {!arriving && <TourDock ref={popRef} steps={effectiveSteps} index={idx} current={current} visited={visited}
                action={currentAction} language={guideLanguage} ready={uiReady}
                collapsed={collapsed} mapOpen={mapOpen} autoPlay={autoPlay}
                speaking={petSpeaking} petHidden={petHidden} discoveries={discoveries}
                selected={selectedDiscovery} onSelect={selectDiscovery}
                onJump={(position) => { setIdx(position); setMapOpen(false); setAutoPlay(false); if (position === idx) go(position) }}
                onClose={close} onCollapse={() => setCollapsed(value => !value)}
                onMap={() => { setMapOpen(value => !value); setAutoPlay(false) }}
                onAutoPlay={() => setAutoPlay(value => !value)} onSpeak={speakCurrentStep}
                onAsk={askMrPot} onPronounce={pronounceName} onShowPet={() => setPetHidden(false)}
                onPrev={prev} onNext={next} />}

            <style jsx global>{`
                .st-scene-frame { position: fixed; z-index: 9999; pointer-events: none; border: 1px solid rgba(22, 127, 108, .22); border-radius: 5px; box-shadow: 0 0 0 100vmax rgba(21, 35, 30, .12); transition: top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease; }
                .st-scene-caption { position: absolute; top: -26px; left: 0; padding: 4px 9px; background: #171b1b; border-radius: 3px; color: #c2f6db; font: 10px/1.4 ui-monospace, monospace; letter-spacing: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: st-caption-enter 400ms ease both; }
                @keyframes st-caption-enter { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
                .st-scene-frame i { position: absolute; width: 20px; height: 20px; border: solid #219c7d; }
                .st-scene-frame i:nth-child(1) { top: -2px; left: -2px; border-width: 2px 0 0 2px; border-radius: 5px 0 0 0; }
                .st-scene-frame i:nth-child(2) { top: -2px; right: -2px; border-width: 2px 2px 0 0; border-radius: 0 5px 0 0; }
                .st-scene-frame i:nth-child(3) { bottom: -2px; left: -2px; border-width: 0 0 2px 2px; border-radius: 0 0 0 5px; }
                .st-scene-frame i:nth-child(4) { bottom: -2px; right: -2px; border-width: 0 2px 2px 0; border-radius: 0 0 5px 0; }
                .st-roaming-pet:not(.is-walking):not(.is-dragging)[data-chapter="projects"] .st-pet-arm-right { animation: st-point-out 3.8s ease-in-out infinite; }
                .st-roaming-pet:not(.is-walking):not(.is-dragging)[data-chapter="techblogs"] .st-pet-head { animation: st-reading-nod 4s ease-in-out infinite; }
                .st-roaming-pet:not(.is-walking):not(.is-dragging)[data-chapter="contact"] .st-pet-core { animation: st-friendly-bow 3.6s ease-in-out infinite; }
                .st-roaming-pet:hover:not(.is-dragging) .st-pet-arm-left { animation: st-hello-wave 600ms ease-in-out 3; }
                @keyframes st-point-out { 0%, 100% { transform: rotate(0); } 25%, 70% { transform: rotate(22deg) translateX(18px); } }
                @keyframes st-reading-nod { 0%, 100% { transform: rotate(0); } 30%, 65% { transform: rotate(-5deg) translateY(10px); } }
                @keyframes st-friendly-bow { 0%, 100% { transform: rotate(0); } 30% { transform: rotate(7deg) translateY(8px); } }
                @keyframes st-hello-wave { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(24deg); } }
                @media (prefers-reduced-motion: reduce) { .st-scene-frame { transition: none; } .st-scene-caption, .st-roaming-pet .st-pet-layer { animation: none !important; } }
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
                    transform: translate3d(-120px, 120px, 0);
                    cursor: grab;
                    outline: none;
                    pointer-events: none;
                    touch-action: none;
                    user-select: none;
                    transition:
                        transform 820ms cubic-bezier(0.2, 0.72, 0.22, 1),
                        opacity 180ms ease;
                    will-change: transform;
                }

                .st-roaming-pet.is-ready {
                    opacity: 1;
                    pointer-events: auto;
                }

                .st-roaming-pet.is-dragging {
                    cursor: grabbing;
                    transition: opacity 180ms ease;
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

                .st-pet-rig {
                    display: block;
                    width: 100%;
                    height: 100%;
                    overflow: visible;
                    pointer-events: none;
                    -webkit-user-drag: none;
                    transform: scaleX(var(--st-pet-facing, 1));
                    transform-origin: center;
                    transition: transform 120ms ease;
                }

                .st-pet-layer {
                    transform-box: view-box;
                }

                .st-pet-head,
                .st-pet-core {
                    transform-origin: 600px 760px;
                    animation: st-pet-breathe 2.6s ease-in-out infinite;
                }

                .st-pet-steam {
                    transform-origin: 600px 200px;
                    animation: st-pet-steam-drift 2.1s ease-in-out infinite alternate;
                }

                .st-pet-arm-left {
                    transform-origin: 445px 795px;
                    animation: st-pet-arm-rest-left 3.2s ease-in-out infinite;
                }

                .st-pet-arm-right {
                    transform-origin: 760px 815px;
                    animation: st-pet-wave 3.8s ease-in-out infinite;
                }

                .st-pet-leg-left,
                .st-pet-leg-right {
                    transform-origin: 515px 1000px;
                }
                .st-pet-leg-right { transform-origin: 700px 1000px; }

                .st-roaming-pet.is-walking .st-pet-head,
                .st-roaming-pet.is-walking .st-pet-core {
                    animation: st-pet-step-body 260ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-walking .st-pet-arm-left {
                    animation: st-pet-arm-swing-left 310ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-walking .st-pet-arm-right {
                    animation: st-pet-arm-swing-right 310ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-walking .st-pet-leg-left {
                    animation: st-pet-leg-step-left 260ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-walking .st-pet-leg-right {
                    animation: st-pet-leg-step-right 260ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-walking .st-pet-steam {
                    animation: st-pet-steam-walk 380ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-speaking .st-pet-arm-right {
                    animation: st-pet-talk-wave 520ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-speaking .st-pet-steam {
                    animation: st-pet-steam-speak 700ms ease-in-out infinite;
                }

                .st-roaming-pet.is-dragging .st-pet-head,
                .st-roaming-pet.is-dragging .st-pet-core {
                    animation: st-pet-drag-body 620ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-dragging .st-pet-arm-left {
                    animation: st-pet-drag-arm-left 620ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-dragging .st-pet-arm-right {
                    animation: st-pet-drag-arm-right 620ms ease-in-out infinite alternate;
                }

                .st-roaming-pet.is-dragging .st-pet-leg-left {
                    transform: rotate(1.5deg) translateY(3px);
                }

                .st-roaming-pet.is-dragging .st-pet-leg-right {
                    transform: rotate(-1.5deg) translateY(3px);
                }

                .st-roaming-shadow {
                    position: absolute;
                    right: 17px;
                    bottom: 2px;
                    left: 17px;
                    z-index: 1;
                    height: 8px;
                    border-radius: 50%;
                    background: rgba(15, 23, 42, 0.22);
                    filter: blur(3px);
                    transition: transform 180ms ease, opacity 180ms ease;
                }

                .st-roaming-pet.is-walking .st-roaming-shadow {
                    opacity: 0.6;
                    transform: scaleX(0.82);
                }

                .st-roaming-bubble {
                    position: absolute;
                    bottom: calc(100% - 7px);
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
                    transform: translateX(-50%) translateY(0);
                    transition: opacity 160ms ease, transform 160ms ease;
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

                .st-roaming-pet.is-walking .st-roaming-bubble {
                    opacity: 0.18;
                    transform: translateX(-50%) translateY(5px);
                }

                .st-roaming-pet.is-dragging .st-roaming-bubble {
                    opacity: 0;
                    transform: translateX(-50%) translateY(7px);
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

                @keyframes st-pet-breathe {
                    0%, 100% { transform: translateY(0) scaleY(1); }
                    50% { transform: translateY(-1px) scaleY(1.008); }
                }

                @keyframes st-pet-steam-drift {
                    0% { transform: translateX(-5px) rotate(-4deg) scaleY(0.96); opacity: 0.76; }
                    100% { transform: translateX(5px) rotate(4deg) scaleY(1.04); opacity: 1; }
                }

                @keyframes st-pet-arm-rest-left {
                    0%, 72%, 100% { transform: rotate(0); }
                    82% { transform: rotate(1.8deg) translateY(1px); }
                    91% { transform: rotate(-1deg); }
                }

                @keyframes st-pet-wave {
                    0%, 64%, 100% { transform: rotate(0); }
                    72% { transform: rotate(-2.5deg); }
                    80% { transform: rotate(2.5deg); }
                    88% { transform: rotate(-2deg); }
                    95% { transform: rotate(1.5deg); }
                }

                @keyframes st-pet-step-body {
                    0% { transform: translateY(0) rotate(-0.6deg); }
                    100% { transform: translateY(-4px) rotate(0.6deg); }
                }

                @keyframes st-pet-arm-swing-left {
                    0% { transform: rotate(-2.5deg) translateY(1px); }
                    100% { transform: rotate(3deg) translateY(-1px); }
                }

                @keyframes st-pet-arm-swing-right {
                    0% { transform: rotate(2.5deg) translateY(-1px); }
                    100% { transform: rotate(-3deg) translateY(1px); }
                }

                @keyframes st-pet-leg-step-left {
                    0% { transform: rotate(-2deg) translateY(1px); }
                    100% { transform: rotate(2deg) translateY(-2px); }
                }

                @keyframes st-pet-leg-step-right {
                    0% { transform: rotate(2deg) translateY(-2px); }
                    100% { transform: rotate(-2deg) translateY(1px); }
                }

                @keyframes st-pet-steam-walk {
                    0% { transform: translateX(-8px) rotate(-7deg) scaleY(0.94); }
                    100% { transform: translateX(7px) rotate(6deg) scaleY(1.05); }
                }

                @keyframes st-pet-talk-wave {
                    0% { transform: rotate(-3deg); }
                    100% { transform: rotate(3deg); }
                }

                @keyframes st-pet-steam-speak {
                    0%, 100% { transform: scale(0.96); opacity: 0.72; }
                    50% { transform: scale(1.08) translateY(-4px); opacity: 1; }
                }

                @keyframes st-pet-drag-body {
                    0% { transform: rotate(-1.5deg) translateY(0); }
                    100% { transform: rotate(1.5deg) translateY(2px); }
                }

                @keyframes st-pet-drag-arm-left {
                    0% { transform: rotate(1deg) translateY(1px); }
                    100% { transform: rotate(3deg) translateY(3px); }
                }

                @keyframes st-pet-drag-arm-right {
                    0% { transform: rotate(-1deg) translateY(1px); }
                    100% { transform: rotate(2deg) translateY(3px); }
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
                    .st-pet-rig,
                    .st-pet-layer,
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
