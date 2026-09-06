import { useEffect, useRef } from "react"
import { ArrowRight, X } from "lucide-react"
import styles from "./TourArrival.module.css"

export default function TourArrival({ language, onEnter, onClose, children }) {
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
        <button className={styles.close} onClick={onClose} aria-label="Close intro" title="Close intro"><X size={20} /></button>
        <div className={styles.title}><span>YUQI GUO / MR. POT</span><h2>Vibe Guide<span>.</span></h2><p>{zh ? "认识一个人，走进他的世界。" : "Meet the person. Follow the curiosity."}</p></div>
        <div className={styles.performer}>{children}</div>
        <div className={styles.baseline}><span>{zh ? "一起出发" : "A PERSONAL EXPEDITION"}</span><button ref={button} onClick={onEnter}>{zh ? "出发" : "Let's go"}<ArrowRight size={18} /></button></div>
    </section>
}
