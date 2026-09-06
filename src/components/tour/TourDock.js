import { forwardRef, useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, AudioLines, Bot, Check, ChevronDown, ChevronUp, ExternalLink, Map, MessageCircle, Pause, Play, Volume2, X } from "lucide-react"
import styles from "./TourDock.module.css"
import { tourNarrative } from "../../lib/tourNarrative.mjs"

const TourDock = forwardRef(function TourDock({ steps, index, current, action, language, visited = [],
    ready, collapsed, mapOpen, autoPlay, speaking, petHidden, discoveries, selected,
    onSelect, onJump, onClose, onCollapse, onMap, onAutoPlay, onSpeak, onAsk,
    onPronounce, onShowPet, onPrev, onNext }, ref) {
    const zh = language === "zh"
    const number = String(index + 1).padStart(2, "0")
    const nextStep = steps[index + 1]
    const title = selected?.title || current?.title
    const story = tourNarrative(current, language)
    const [showQuestion, setShowQuestion] = useState(false)
    useEffect(() => setShowQuestion(false), [index, selected?.href])
    const mapRef = useRef(null)
    const panelRef = useRef(null)
    useEffect(() => { panelRef.current?.querySelector('button')?.focus({ preventScroll: true }) }, [])
    useEffect(() => {
        if (!mapOpen) return undefined
        const previous = document.activeElement
        const panel = mapRef.current
        panel?.querySelector('button')?.focus()
        const trap = event => {
            if (event.key !== 'Tab') return
            const buttons = Array.from(panel.querySelectorAll('button'))
            const first = buttons[0], last = buttons[buttons.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
        panel?.addEventListener('keydown', trap)
        return () => { panel?.removeEventListener('keydown', trap); previous?.focus?.({ preventScroll: true }) }
    }, [mapOpen])
    return <>
        {mapOpen && <div className={styles.mapBackdrop} onClick={onMap}>
            <section ref={mapRef} className={styles.map} role="dialog" aria-modal="true" aria-label={zh ? "导览章节" : "Tour chapters"} onClick={event => event.stopPropagation()}>
                <header><div><span className={styles.eyebrow}>{zh ? "自由探索" : "THE ITINERARY"}</span><h2>{zh ? "下一站，去哪里？" : "Where to next?"}</h2></div>
                    <button className={styles.iconButton} onClick={onMap} aria-label="Close chapters" title="Close chapters"><X size={20} /></button></header>
                <ol>{steps.map((step, position) => <li key={step.id || position}>
                    <button onClick={() => onJump(position)} aria-current={position === index ? "step" : undefined}>
                        <span className={styles.mapNumber}>{String(position + 1).padStart(2, "0")}</span>
                        <span><strong>{step.title}</strong><small>{step.meta || step.content}</small></span>
                        {position === index ? <span className={styles.here}>{zh ? "现在" : "HERE"}</span> : visited.includes(position) ? <Check size={18} aria-label="Visited" /> : <ArrowRight size={18} />}
                    </button>
                </li>)}</ol>
            </section>
        </div>}
        <section ref={node => { panelRef.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node }} className={`${styles.dock} ${collapsed ? styles.collapsed : ""}`} aria-label="Mr.Pot guided tour" data-ready={ready} data-tone={story.tone}>
            <header className={styles.topline}>
                <div className={styles.identity}><span className={`${styles.status} ${!ready ? styles.moving : ""}`} /><strong>VIBE GUIDE</strong><span>{zh ? "和 MR. POT 一起" : "WITH MR. POT"}</span></div>
                <div className={styles.tools}>
                    <span className={styles.counter}>{number}<span> / {String(steps.length).padStart(2, "0")}</span></span>
                    {petHidden && <button className={styles.iconButton} onClick={onShowPet} aria-label="Show Mr.Pot" title="Show Mr.Pot"><Bot size={17} /></button>}
                    <button className={styles.iconButton} onClick={onMap} aria-expanded={mapOpen} aria-label="Tour chapters" title="Tour chapters"><Map size={17} /></button>
                    <button className={styles.iconButton} onClick={onCollapse} aria-expanded={!collapsed} aria-label={collapsed ? "Expand tour" : "Collapse tour"} title={collapsed ? "Expand tour" : "Collapse tour"}>{collapsed ? <ChevronUp size={19} /> : <ChevronDown size={19} />}</button>
                    <button className={styles.iconButton} onClick={onClose} aria-label="Close tour" title="Close tour"><X size={19} /></button>
                </div>
            </header>
            {!collapsed && <div className={styles.main}>
                <div className={styles.story} key={`${index}-${selected?.href || "overview"}`}>
                    <div className={styles.copy}>
                        <span className={styles.chapterLabel}><span>{number}</span>{current.title}</span>
                        <h2 aria-live="polite">{story.title}</h2>
                        <p>{story.line}</p>
                        <div className={styles.storyActions}>
                            {action && <a href={action.href}>{action.label}<ArrowRight size={14} /></a>}
                            {current?.pronunciation && !selected && <button onClick={onPronounce}><Volume2 size={15} />{zh ? "郭育奇" : "Hear my Chinese name"}</button>}
                        </div>
                    </div>
                </div>
                <aside className={styles.discovery}>
                    {selected ? <div className={styles.selectedWork} key={selected.href}>
                        {selected.image && <a href={selected.href} className={styles.coverLink} tabIndex={-1} aria-hidden="true"><img src={selected.image} alt="" /></a>}
                        <div><span className={styles.eyebrow}>{zh ? "正在聚焦" : "IN THE SPOTLIGHT"}</span><a href={selected.href} className={styles.workTitle}>{selected.title}<ExternalLink size={14} /></a>
                            {selected.excerpt && <p>{selected.excerpt}</p>}</div>
                    </div> : <div className={styles.chapterAside}><span className={styles.eyebrow}>{zh ? "MR. POT 的札记" : "MR. POT'S FIELD NOTES"}</span><p>{current?.meta || current?.content}</p></div>}
                    {discoveries.length > 1 && <div className={styles.filmstrip} aria-label="Chapter discoveries">{discoveries.map((item, position) => <button key={item.href} aria-label={`Focus ${item.title}`} title={item.title} aria-pressed={selected?.href === item.href} onClick={() => onSelect(item)}>
                        {item.image ? <img src={item.image} alt="" /> : <ExternalLink size={18} />}<span>{String(position + 1).padStart(2, "0")}</span>
                    </button>)}</div>}
                    {showQuestion ? <button className={styles.question} onClick={() => onAsk(story.question)}><MessageCircle size={17} /><span>{story.question || (zh ? "深入聊聊这一站" : "Tell me more about this chapter")}</span><ArrowRight size={17} /></button>
                        : <button className={styles.ask} onClick={() => setShowQuestion(true)} aria-expanded={false}><MessageCircle size={17} /><span>{zh ? "我想再深入一点" : "Let's go a little deeper"}</span><ArrowRight size={15} /></button>}
                </aside>
            </div>}
            <footer className={styles.footer}>
                <div className={styles.playback}>
                    <button className={styles.iconButton} onClick={onAutoPlay} aria-pressed={autoPlay} aria-label={autoPlay ? "Pause tour" : "Play tour"} title={autoPlay ? "Pause tour" : "Play tour"}>{autoPlay ? <Pause size={16} /> : <Play size={16} />}</button>
                    {!collapsed && <button className={`${styles.narration} ${speaking ? styles.speaking : ""}`} onClick={onSpeak} aria-pressed={speaking} aria-label={speaking ? zh ? "停止讲解" : "Stop audio" : zh ? "听讲解" : "Listen"} title={zh ? "AI 合成语音" : "AI-generated narration"}>
                        <AudioLines size={18} /><span>{speaking ? zh ? "停止讲解" : "Stop audio" : zh ? "听讲解" : "Listen"}</span>
                    </button>}
                </div>
                <span className={styles.upNext}>{collapsed ? title : nextStep ? <>{zh ? "下一站" : "UP NEXT"}<strong>{nextStep.title}</strong></> : <>{zh ? "最后一站" : "THE LAST STOP"}</>}</span>
                <div className={styles.navigation}>
                    <button className={styles.iconButton} onClick={onPrev} disabled={index === 0} aria-label="Previous chapter" title="Previous chapter"><ArrowLeft size={18} /></button>
                    <button className={styles.next} onClick={onNext}>{nextStep ? zh ? "下一站" : "Next chapter" : zh ? "完成导览" : "Finish tour"}{nextStep ? <ArrowRight size={17} /> : <Check size={17} />}</button>
                </div>
            </footer>
            <nav className={styles.rail} aria-label="Tour progress">{steps.map((step, position) => <button key={step.id || position}
                aria-label={`Go to ${step.title}`} title={step.title} aria-current={position === index ? "step" : undefined}
                data-complete={visited.includes(position)} onClick={() => onJump(position)}><span className={autoPlay && position === index && ready && !speaking && !mapOpen ? styles.timed : ""} /></button>)}</nav>
        </section>
    </>
})

export default TourDock
