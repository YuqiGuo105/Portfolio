import { useCallback, useEffect, useRef, useState } from "react"
import { Sparkles, X } from "lucide-react"
import TourPetFigure from "./TourPetFigure"
import useTourPet from "./useTourPet"
import usePetPerformance from "./usePetPerformance"
import styles from "./PetPerformance.module.css"
import { placeTourPet, tourPetDimensions, tourPetGround } from "../../lib/tourScene.mjs"

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const overlaps = (a, b, padding) => !(a.right + padding < b.left || a.left - padding > b.right || a.bottom + padding < b.top || a.top - padding > b.bottom)
const DRAG_STARTS_AT = 5      // pixels the pointer travels before a press becomes a carry
const POINTER_REACH = 360     // pixels within which his eyes follow the pointer

/**
 * Mr. Pot as the guide: he stands by the section being shown, jumps or walks to the next one,
 * narrates when clicked, plays when asked and can be picked up and put down anywhere.
 * `stop` names what he is standing by: when it changes he travels; when only the frame moves
 * (the page scrolls) he is carried with it. `from` is where he stood on the opening screen;
 * `finale` marks the last chapter, which he celebrates.
 */
export default function TourPet({ language, title, chapter, stop, frame, dockRef, ready, collapsed, speaking, mapOpen, finale, from, onSpeak, onHide }) {
    const zh = language === "zh"
    const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
    const dims = tourPetDimensions(viewport.width, viewport.height)
    const ground = tourPetGround(dims.width, dims.height)
    const [doing, setDoing] = useState({ moving: false, held: false, placed: false, shown: "idle" })
    const [leading, setLeading] = useState(false)
    // Until his first jump is over he belongs to the opening screen: nothing is pinned to him yet, and he
    // passes in front of the dock on his way out.
    const [staged, setStaged] = useState(Boolean(from))
    const left = useRef(false)
    const { rig, wrapper, body, shadow, figure } = useTourPet({ width: dims.width, onChange: setDoing })
    const { gesture, duration, interact } = usePetPerformance({
        enabled: ready && doing.placed,
        busy: doing.moving || doing.held || speaking || mapOpen,
    })
    const base = useRef(null)
    const stopped = useRef(null)
    const drag = useRef({ pointerId: null, offsetX: 0, offsetY: 0, startX: 0, startY: 0, carried: false, moved: false })

    useEffect(() => {
        const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
        window.addEventListener("resize", resize)
        return () => window.removeEventListener("resize", resize)
    }, [])

    // He starts where the opening screen left him, at the size he had there.
    useEffect(() => {
        if (!from || rig.current.placed) return
        rig.current.place({ x: from.centre - dims.width / 2, y: from.ground - ground }, { scale: from.width / dims.width })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        const pet = rig.current
        if (!ready) { pet.wait(true); setLeading(true); return }
        pet.wait(false)
        const dock = dockRef.current?.getBoundingClientRect()
        const spot = placeTourPet({ target: frame, dock, viewport, pet: dims })
        pet.attend(frame ? { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 } : null)
        base.current = spot
        if (!pet.placed) {
            // Shown again after being put away: he jumps in from the nearer side.
            const side = spot.x > viewport.width / 2 ? 1 : -1
            pet.place({ x: clamp(spot.x + side * dims.width * 0.9, 0, viewport.width - dims.width), y: Math.min(spot.y + dims.height * 0.6, viewport.height - dims.height) })
        }
        if (stopped.current !== stop) {
            stopped.current = stop
            pet.travel(spot)
        } else pet.follow(spot)
        setLeading(pet.moving)
        // With reduced motion he is simply there, with no jump to wait for.
        if (!pet.moving) setStaged(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, stop, frame?.left, frame?.top, frame?.width, frame?.height, collapsed, viewport.width, viewport.height])

    useEffect(() => {
        if (doing.moving) { left.current = true; return }
        setLeading(false)
        if (left.current) setStaged(false)
    }, [doing.moving])
    // He bows when he has finished saying a chapter, unless it was cut short.
    const spokeSince = useRef(0)
    useEffect(() => {
        rig.current.speak(speaking)
        if (speaking) { spokeSince.current = performance.now(); return }
        if (spokeSince.current && performance.now() - spokeSince.current > 1500) rig.current.perform("bow", 1.5)
        spokeSince.current = 0
    }, [rig, speaking])
    // Reaching the last chapter is worth going head over heels for, once.
    const celebrated = useRef(false)
    useEffect(() => { celebrated.current = false }, [stop])
    useEffect(() => {
        if (!finale || !ready || doing.moving || doing.held || celebrated.current || !doing.placed) return
        celebrated.current = true
        rig.current.perform("flip", 2.4)
    }, [rig, finale, ready, doing.moving, doing.held, doing.placed])
    useEffect(() => {
        if (gesture === "rest") rig.current.rest()
        else rig.current.perform(gesture, duration / 1000)
    }, [rig, gesture, duration])

    // Now and then he strolls a few steps aside and back, if there is room beside him.
    useEffect(() => {
        if (!ready || speaking || mapOpen) return undefined
        let back = 0
        const stroll = window.setInterval(() => {
            const pet = rig.current
            if (!base.current || pet.moving || pet.held || pet.shown !== "idle" || document.hidden) return
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
            const aside = { x: clamp(base.current.x + (Math.random() < 0.5 ? -1 : 1) * dims.width * 0.62, dims.margin, viewport.width - dims.width - dims.margin), y: base.current.y }
            const dock = dockRef.current?.getBoundingClientRect()
            if (dock && overlaps({ left: aside.x, top: aside.y, right: aside.x + dims.width, bottom: aside.y + dims.height }, dock, 14)) return
            pet.travel(aside)
            back = window.setTimeout(() => { if (base.current && !rig.current.held) rig.current.travel(base.current) }, 2200)
        }, 17000)
        return () => { window.clearInterval(stroll); window.clearTimeout(back) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, speaking, mapOpen, dims.width, viewport.width])

    useEffect(() => {
        const watch = event => {
            if (event.pointerType !== "mouse" || !wrapper.current) return
            const box = wrapper.current.getBoundingClientRect()
            const dx = event.clientX - (box.left + box.width / 2), dy = event.clientY - (box.top + box.height * 0.45)
            if (Math.hypot(dx, dy) < POINTER_REACH) rig.current.look(dx / 180, dy / 180)
        }
        window.addEventListener("pointermove", watch, { passive: true })
        return () => window.removeEventListener("pointermove", watch)
    }, [rig, wrapper])

    const letGo = useCallback(() => {
        if (drag.current.pointerId === null) return
        drag.current.pointerId = null
        if (drag.current.carried) {
            drag.current.carried = false
            base.current = rig.current.position
            rig.current.release()
        }
    }, [rig])
    useEffect(() => {
        window.addEventListener("pointerup", letGo)
        window.addEventListener("pointercancel", letGo)
        window.addEventListener("blur", letGo)
        return () => {
            window.removeEventListener("pointerup", letGo)
            window.removeEventListener("pointercancel", letGo)
            window.removeEventListener("blur", letGo)
        }
    }, [letGo])

    const press = event => {
        if (!doing.placed || (event.pointerType === "mouse" && event.button !== 0)) return
        const box = event.currentTarget.getBoundingClientRect()
        drag.current = { pointerId: event.pointerId, offsetX: event.clientX - box.left, offsetY: event.clientY - box.top,
            startX: event.clientX, startY: event.clientY, carried: false, moved: false }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        event.preventDefault()
    }
    const carry = event => {
        const held = drag.current
        if (held.pointerId !== event.pointerId) return
        if (!held.carried) {
            if (Math.hypot(event.clientX - held.startX, event.clientY - held.startY) <= DRAG_STARTS_AT) return
            held.carried = held.moved = true
            rig.current.grab()
        }
        rig.current.carry({
            x: clamp(event.clientX - held.offsetX, dims.margin, window.innerWidth - dims.width - dims.margin),
            y: clamp(event.clientY - held.offsetY, dims.minY, window.innerHeight - dims.height - dims.margin),
        })
        event.preventDefault()
    }
    const drop = event => {
        if (drag.current.pointerId !== event.pointerId) return
        event.currentTarget.releasePointerCapture?.(event.pointerId)
        letGo()
    }
    const activate = () => {
        // The click that ends a carry is not a request to narrate.
        if (drag.current.moved) { drag.current.moved = false; return }
        rig.current.nudge()
        onSpeak()
    }

    const away = leading || !ready
    return (
        <div
            ref={wrapper}
            className={`st-roaming-pet ${styles.performer}${doing.placed ? " is-ready" : ""}${doing.moving ? " is-walking" : ""}${speaking ? " is-speaking" : ""}${doing.held ? " is-dragging" : ""}${away ? " is-leading" : ""}${staged ? " is-staged" : ""}`}
            data-chapter={chapter}
            data-gesture={gesture}
            data-doing={doing.shown}
            style={{ "--st-pet-width": `${dims.width}px`, "--st-pet-height": `${dims.height}px`, "--st-pet-ground": `${ground.toFixed(1)}px` }}
            role="group"
            draggable={false}
            aria-grabbed={doing.held}
            onDragStart={event => event.preventDefault()}
            onPointerEnter={event => { if (event.pointerType === "mouse") rig.current.notice() }}
            onPointerDown={press}
            onPointerMove={carry}
            onPointerUp={drop}
            onPointerCancel={drop}
            onLostPointerCapture={drop}
        >
            <button type="button" className="st-pet-play"
                aria-label={zh ? "和 Mr.Pot 互动" : "Play with Mr.Pot"}
                title={zh ? "和 Mr.Pot 互动" : "Play with Mr.Pot"}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); interact() }}>
                <Sparkles size={17} aria-hidden="true" />
            </button>
            <button type="button" className="st-pet-close"
                aria-label={zh ? "关闭 Mr.Pot" : "Close Mr.Pot"}
                title={zh ? "关闭 Mr.Pot" : "Close Mr.Pot"}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); onHide() }}>
                <X size={13} aria-hidden="true" />
            </button>
            <div className="st-roaming-bubble">
                <strong>{away ? zh ? "跟我来" : "Follow me" : speaking ? zh ? "正在讲解" : "Speaking" : zh ? "我们到了" : "Here we are"}</strong>
                <span>{away ? zh ? "这边，有东西想给你看。" : "Something to show you." : title}</span>
            </div>
            <div
                ref={body}
                className="st-roaming-pet-body"
                role="button"
                tabIndex={0}
                aria-label={zh ? "点击 Mr.Pot 听当前区域讲解" : "Click Mr.Pot to narrate this section"}
                onClick={activate}
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onSpeak()
                    }
                }}
            >
                <TourPetFigure ref={figure} />
            </div>
            <span ref={shadow} className="st-roaming-shadow" />
        </div>
    )
}
