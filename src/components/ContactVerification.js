import { useEffect, useRef, useState } from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';
import styles from './ContactVerification.module.css';

let loading;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const timer = setTimeout(() => failed(), 10000);
    const failed = () => {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error('Verification could not load'));
    };
    script.onerror = failed;
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else failed();
    };
    document.head.appendChild(script);
  });
  return loading;
}

export default function ContactVerification({ active, resetKey, onToken }) {
  const container = useRef(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [nearby, setNearby] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const enabled = active || nearby;

  useEffect(() => {
    if (!window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    callback.current('');
    setError(false);
    if (!sitekey) { setError(true); return; }
    let cancelled = false;
    let widget;
    loadTurnstile().then(api => {
      if (cancelled) return;
      widget = api.render(container.current, {
        sitekey, action: 'contact_submit', theme: 'auto',
        size: container.current.clientWidth < 300 ? 'compact' : 'flexible',
        'response-field': false,
        callback: token => { if (!cancelled) { setError(false); callback.current(token); } },
        'expired-callback': () => { if (!cancelled) callback.current(''); },
        'timeout-callback': () => { if (!cancelled) { callback.current(''); setError(true); } },
        'error-callback': () => { if (!cancelled) { callback.current(''); setError(true); } },
      });
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (widget !== undefined) window.turnstile?.remove(widget); };
  }, [enabled, resetKey, retry, sitekey]);

  return <div className={styles.verification} data-contact-verification>
    <div ref={container} className={error ? styles.failedWidget : undefined} aria-hidden={error || undefined} />
    {error && <div className={styles.feedback}>
      <span className={styles.status} role="status">
        <CircleAlert size={16} aria-hidden="true" />
        <span>Verification unavailable.</span>
      </span>
      <div className={styles.actions}>
        <button className={styles.retry} type="button" onClick={() => setRetry(value => value + 1)}
          aria-label="Retry verification" title="Retry verification">
          <RotateCw size={18} aria-hidden="true" />
        </button>
        <a className={styles.emailLink} href="mailto:yuqi.guo17@gmail.com">Email instead</a>
      </div>
    </div>}
  </div>;
}
