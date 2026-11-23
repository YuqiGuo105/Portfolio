import { useEffect, useId, useRef, useState } from 'react';
import { Check, Settings2 } from 'lucide-react';
import styles from './VideoQuality.module.css';

export default function VideoQuality({ quality, title }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    root.current?.querySelector('[aria-checked="true"]')?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function choose(value) { quality.change(value); setOpen(false); trigger.current?.focus(); }
  function navigate(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const items = [...root.current.querySelectorAll('[role="menuitemradio"]')];
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  }
  return <div ref={root} className={styles.control}>
    <button ref={trigger} type="button" className={styles.trigger} aria-label={`${title} video quality`}
      title={`Quality: ${quality.quality === 'auto' ? 'Auto' : `${quality.quality}p`}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <Settings2 size={21} aria-hidden="true" />
    </button>
    {open && <div id={id} role="menu" aria-label="Video quality" className={styles.menu} onKeyDown={navigate}>
      <div className={styles.heading}>Quality</div>
      {['auto', ...quality.options.map(option => option.height)].map(value => <button key={value} type="button"
        role="menuitemradio" aria-checked={quality.quality === value} onClick={() => choose(value)}>
        <span>{value === 'auto' ? 'Auto' : `${value}p`}{value === 'auto' && <small>{quality.resolved}p now</small>}</span>
        {quality.quality === value && <Check size={18} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
