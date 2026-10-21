import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './LiveVoiceCall.module.css';

export default function VoiceCallStage({ status, level, visible = true, replay = 0 }) {
  const canvas = useRef(null), scene = useRef(null), latest = useRef(status);
  const shown = useRef(visible); shown.current = visible;
  latest.current = status;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const lowPower = (navigator.deviceMemory && navigator.deviceMemory < 4) || navigator.connection?.saveData;
    const fallback = () => { scene.current?.dispose(); scene.current = null; setReady(false); };
    const load = async () => {
      if (motion.matches || lowPower) return;
      try {
        const { createCallScene } = await import('../lib/voice/callScene.mjs');
        if (disposed || motion.matches) return;
        scene.current = createCallScene(canvas.current, { onFailure: fallback });
        scene.current.visible(shown.current);
        scene.current.state(latest.current);
        setReady(true);
      } catch { if (!disposed) fallback(); }
    };
    const change = () => { if (motion.matches) fallback(); else load(); };
    load(); motion.addEventListener('change', change);
    // The audio analyser already runs at a bounded rate; no React updates.
    level.current = value => scene.current?.level(value);
    return () => { disposed = true; motion.removeEventListener('change', change); level.current = null; scene.current?.dispose(); scene.current = null; };
  }, [level]);
  useEffect(() => { scene.current?.state(status); }, [status]);
  useEffect(() => { scene.current?.visible(visible); }, [visible]);
  useEffect(() => { scene.current?.replay(); }, [replay]);
  return <div className={styles.stage} aria-label="Full-body Mr. Pot" role="group" data-renderer={ready ? '3d' : 'image'}>
    {!ready && <Image className={styles.fallback} src="/assets/images/mr-pot-tour-guide.png" layout="fill" objectFit="contain" unoptimized alt="" />}
    <canvas ref={canvas} className={styles.canvas} style={{ opacity: ready ? 1 : 0 }} aria-hidden="true" />
    {ready && <button type="button" className={styles.characterTarget} aria-label="Animate Mr. Pot" title="Say hello to Mr. Pot"
      onPointerEnter={() => scene.current?.enter()}
      onClick={() => scene.current?.react()} onPointerMove={event => {
        if (event.pointerType === 'mouse') scene.current?.point(event.clientX, event.clientY);
      }} onPointerLeave={() => scene.current?.leave()} />}
  </div>;
}
