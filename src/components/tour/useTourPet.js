import { useEffect, useRef } from "react"
import { createTourPetRig } from "../../lib/tourPetRig.mjs"
import { PET_ART } from "../../lib/tourPetDrawing.mjs"

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * Runs one Mr. Pot: owns his rig, steps it every frame and draws the result into the refs it
 * returns (the element that carries him, his body, his shadow and the figure). Nothing here
 * re-renders React; `onChange` reports only when what he is doing changes.
 */
export default function useTourPet({ width, onChange }) {
    const rig = useRef(null)
    const wrapper = useRef(null)
    const body = useRef(null)
    const shadow = useRef(null)
    const figure = useRef(null)
    const still = useRef(false)
    const size = useRef(width)
    const report = useRef(onChange)
    report.current = onChange
    size.current = width
    if (!rig.current) rig.current = createTourPetRig({ width, still: () => still.current })

    useEffect(() => { rig.current.resize(width) }, [width])

    useEffect(() => {
        const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
        const sync = () => { still.current = motion.matches }
        sync()
        motion.addEventListener("change", sync)
        const drawn = {}
        const style = (name, node, property, value) => {
            if (!node || drawn[name] === value) return
            drawn[name] = value
            node.style[property] = value
        }
        let frame = 0, last = performance.now(), seen = "", lively = true, rested = false
        const tick = now => {
            frame = requestAnimationFrame(tick)
            // At rest every other frame is plenty; travelling, being carried and keeping up with a scrolling page get them all.
            if (!lively && (rested = !rested)) return
            const elapsed = clamp((now - last) / 1000, 0, 0.066)
            last = now
            const pose = rig.current.step(elapsed)
            lively = pose.moving || pose.held || pose.carried || pose.leaping
            const summary = `${pose.moving ? 1 : 0}${pose.held ? 1 : 0}${rig.current.placed ? 1 : 0}${pose.shown}`
            if (summary !== seen) {
                seen = summary
                report.current?.({ moving: pose.moving, held: pose.held, placed: rig.current.placed, shown: pose.shown })
            }
            // How far off the ground he is, in body widths: a jump, a hop on the spot or a visitor's hand.
            const high = clamp((pose.air - pose.lift * size.current / PET_ART.width) / size.current + pose.hold * 0.55, 0, 1)
            style("at", wrapper.current, "transform", `translate3d(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px, 0)`)
            style("body", body.current, "transform", `translateY(${(-pose.air).toFixed(2)}px) scale(${pose.scale.toFixed(4)})`)
            style("shade", shadow.current, "transform", `scale(${((1 - 0.42 * high + pose.squash * 0.5) * pose.scale).toFixed(3)}, ${(1 - 0.3 * high).toFixed(3)})`)
            style("shadeOpacity", shadow.current, "opacity", (1 - 0.6 * high).toFixed(3))
            figure.current?.draw(pose)
        }
        frame = requestAnimationFrame(tick)
        return () => {
            cancelAnimationFrame(frame)
            motion.removeEventListener("change", sync)
        }
    }, [])

    return { rig, wrapper, body, shadow, figure }
}
