import { useEffect, useRef } from "react"
import { ArrowRight, X } from "lucide-react"
import TourPetFigure from "./TourPetFigure"
import useTourPet from "./useTourPet"
import { tourPetGround } from "../../lib/tourScene.mjs"
import styles from "./TourArrival.module.css"

const ENTRANCE = 1.15   // seconds he takes to walk on
const STAGE_WIDE = 200

// He walks on from the left, stops in the middle and waves.
function Entrance() {
    const stage = useRef(null)
    const { rig, wrapper, body, shadow, figure } = useTourPet({ width: STAGE_WIDE })
    useEffect(() => {
        const pet = rig.current
        const box = stage.current.getBoundingClientRect()
        pet.resize(box.width)
        stage.current.style.setProperty("--st-pet-ground", `${tourPetGround(box.width, box.height)}px`)
        pet.place({ x: -box.width * 1.3, y: 0 })
        pet.travel({ x: 0, y: 0 }, ENTRANCE)
        const wave = window.setTimeout(() => pet.perform("greet", 1.9), ENTRANCE * 1000 + 180)
        return () => window.clearTimeout(wave)
    }, [rig])
    return <div ref={stage} className={styles.performer}>
        <div ref={wrapper} className={styles.actor} data-tour-actor>
            <div ref={body} className={styles.body}><TourPetFigure ref={figure} /></div>
            <span ref={shadow} className={styles.shadow} />
        </div>
    </div>
}

export default function TourArrival({ language, onEnter, onClose }) {
    const button = useRef(null)
    const panel = useRef(null)
    const zh = language === "zh"
    useEffect(() => {
        button.current?.focus()
        const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 600 : 2400
        const timer = window.setTimeout(onEnter, duration)
        return () => window.clearTimeout(timer)
    }, [onEnter])
    const trapFocus = event => {
        if (event.key !== "Tab") return
        const buttons = panel.current?.querySelectorAll("button")
        if (!buttons?.length) return
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus() }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus() }
    }
    return <section ref={panel} className={styles.arrival} role="dialog" aria-modal="true" aria-label="Vibe Guide" onKeyDown={trapFocus}>
        <button className={styles.close} onClick={onClose} aria-label={zh ? "关闭介绍" : "Close intro"} title={zh ? "关闭介绍" : "Close intro"}><X size={20} /></button>
        <div className={styles.title}><span>YUQI GUO / MR. POT</span><h2>Vibe Guide<span>.</span></h2><p>{zh ? "认识一个人，走进他的世界。" : "Meet the person. Follow the curiosity."}</p></div>
        <Entrance />
        <div className={styles.baseline}><span>{zh ? "一起出发" : "A PERSONAL EXPEDITION"}</span><button ref={button} onClick={onEnter}>{zh ? "出发" : "Let's go"}<ArrowRight size={18} /></button></div>
    </section>
}
