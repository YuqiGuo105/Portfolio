import { useEffect, useState } from 'react';
import styles from './PreLoader.module.css';

let entranceComplete = false;

export default function PreLoader() {
  const [phase, setPhase] = useState('loading');

  useEffect(() => {
    if (entranceComplete) { setPhase('done'); return undefined; }
    let exitTimer;
    let removalTimer;
    const finish = () => {
      exitTimer = window.setTimeout(() => {
        entranceComplete = true;
        setPhase('leaving');
        removalTimer = window.setTimeout(() => setPhase('done'), 240);
      }, 100);
    };
    // Reveal the shell after hydration; remote content loads within its section.
    const frame = window.requestAnimationFrame(finish);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(exitTimer);
      window.clearTimeout(removalTimer);
    };
  }, []);

  if (phase === 'done') return null;
  return (
    <div className={`${styles.entrance} ${phase === 'leaving' ? styles.leaving : ''}`} role="status" aria-label="Loading portfolio">
      <img src="/assets/images/YuqiLogo.png" width="64" height="64" alt="" />
      <span className={styles.progress} aria-hidden="true" />
    </div>
  );
}
