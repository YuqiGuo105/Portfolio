import { useCallback, useEffect, useRef, useState } from 'react';

const REPERTOIRE = ['curious', 'stretch', 'happy', 'balance', 'sleepy', 'greet'];
const RESPONSES = ['happy', 'greet', 'balance'];
const DURATION = { curious: 3700, stretch: 4600, happy: 2400, balance: 3800, sleepy: 5100, greet: 2900 };

export default function usePetPerformance({ enabled, busy }) {
    const [gesture, setGesture] = useState('rest');
    const next = useRef(0);
    const response = useRef(0);
    const playRequested = useRef(false);
    const wake = useRef(null);
    const interact = useCallback(() => {
        // Coalesce repeated clicks, finishing the current pose before responding.
        playRequested.current = true;
        wake.current?.();
    }, []);

    useEffect(() => {
        let timer;
        let performing = false;
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const stop = () => { clearTimeout(timer); performing = false; setGesture('rest'); };
        const allowed = () => enabled && !busy && !document.hidden && !motion.matches;
        const perform = () => {
            if (!allowed()) return stop();
            const chosen = playRequested.current
                ? RESPONSES[response.current++ % RESPONSES.length]
                : REPERTOIRE[next.current++ % REPERTOIRE.length];
            playRequested.current = false;
            performing = true;
            setGesture(chosen);
            timer = setTimeout(() => {
                performing = false;
                setGesture('rest');
                timer = setTimeout(perform, playRequested.current ? 180 : 2400 + Math.random() * 1600);
            }, DURATION[chosen]);
        };
        wake.current = () => {
            if (!allowed() || performing) return;
            clearTimeout(timer);
            timer = setTimeout(perform, 100);
        };
        const resume = () => {
            stop();
            if (allowed()) timer = setTimeout(perform, playRequested.current ? 100 : 1400);
        };
        resume();
        document.addEventListener('visibilitychange', resume);
        motion.addEventListener('change', resume);
        return () => {
            clearTimeout(timer);
            wake.current = null;
            document.removeEventListener('visibilitychange', resume);
            motion.removeEventListener('change', resume);
        };
    }, [enabled, busy]);

    return { gesture: enabled && !busy ? gesture : 'rest', duration: DURATION[gesture] || 3000, interact };
}
