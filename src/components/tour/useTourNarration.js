import { useCallback, useEffect, useRef, useState } from "react"

// 20 ms of silence: played once inside a click so later narration may start without one (iOS / Safari).
const SILENCE = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA"
const HIGH_QUALITY_VOICE_HINT = /enhanced|premium|neural|natural|siri|online/i
const LOW_QUALITY_VOICE_HINT = /compact|espeak|festival|novelty/i

export function selectNaturalVoice(voices, locale) {
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

/**
 * One narration channel for the tour: a single, reused audio element (so a play() unlocked by one click keeps
 * working for autoplay) with the browser's speech synthesis as the fallback when a file cannot play.
 */
export default function useTourNarration() {
    const audioRef = useRef(null)
    const unlockedRef = useRef(false)
    const sessionRef = useRef(0)
    const voicesRef = useRef([])
    const [speaking, setSpeaking] = useState(false)

    useEffect(() => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined
        const synth = window.speechSynthesis
        const refresh = () => { voicesRef.current = synth.getVoices() }
        refresh()
        synth.addEventListener?.("voiceschanged", refresh)
        return () => synth.removeEventListener?.("voiceschanged", refresh)
    }, [])

    const element = useCallback(() => {
        if (!audioRef.current && typeof Audio !== "undefined") {
            const audio = new Audio()
            audio.preload = "auto"
            audioRef.current = audio
        }
        return audioRef.current
    }, [])

    const stop = useCallback(() => {
        sessionRef.current += 1
        audioRef.current?.pause()
        if (typeof window !== "undefined") window.speechSynthesis?.cancel()
        setSpeaking(false)
    }, [])

    /** Call from a click or key handler: lets later, timer-driven narration play on strict browsers. */
    const unlock = useCallback(() => {
        if (unlockedRef.current) return
        const audio = element()
        if (!audio) return
        unlockedRef.current = true
        audio.src = SILENCE
        audio.play()
            .then(() => { if (audio.src === SILENCE) audio.pause() })
            .catch((error) => { if (error?.name === "NotAllowedError") unlockedRef.current = false })
    }, [element])

    /**
     * Play `src`, or speak `text` when there is no file or it cannot play. `onDone(played)` runs once when the
     * narration ends, and never after stop() or a newer play().
     */
    const play = useCallback(({ src, text, locale = "en-US", rate, onDone }) => {
        stop()
        const session = sessionRef.current
        let finished = false
        const finish = (played) => {
            if (finished || session !== sessionRef.current) return
            finished = true
            setSpeaking(false)
            onDone?.(played)
        }
        const speak = () => {
            if (session !== sessionRef.current) return
            if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) { finish(false); return }
            const utterance = new SpeechSynthesisUtterance(text)
            utterance.lang = locale
            utterance.voice = selectNaturalVoice(voicesRef.current, locale)
            utterance.rate = rate || (locale.toLowerCase().startsWith("zh") ? 0.84 : 0.9)
            utterance.pitch = 1.02
            utterance.onend = () => finish(true)
            utterance.onerror = () => finish(false)
            window.speechSynthesis.cancel()
            window.speechSynthesis.speak(utterance)
        }
        setSpeaking(true)
        const audio = src ? element() : null
        if (!audio) { speak(); return }
        let fellBack = false
        const fallback = () => {
            if (fellBack || session !== sessionRef.current) return
            fellBack = true
            speak()
        }
        audio.onended = () => finish(true)
        audio.onerror = fallback
        audio.src = src
        audio.play().then(() => { unlockedRef.current = true }).catch((error) => {
            // A newer play() or stop() interrupted this one: nothing to fall back to.
            if (error?.name !== "AbortError") fallback()
        })
    }, [element, stop])

    useEffect(() => () => {
        sessionRef.current += 1
        audioRef.current?.pause()
        if (typeof window !== "undefined") window.speechSynthesis?.cancel()
    }, [])

    return { speaking, play, stop, unlock }
}
