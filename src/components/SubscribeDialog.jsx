import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, X } from "lucide-react";
import { saveSubscriber, loadSubscriber } from "../lib/notificationsClient";
import { recordSubscriptionPrompt } from "../lib/subscriptionPrompt.mjs";
import styles from "../../styles/SubscribeDialog.module.css";
import BrowserPushSettings from "./BrowserPushSettings";

const TOPIC_OPTIONS = [
  { value: "ARTICLE_UPDATES", label: "Article updates" },
  { value: "FEATURE_UPDATES", label: "New features" },
  { value: "JOB_UPDATES", label: "Job updates" },
];

const CHANNEL_OPTIONS = [
  { value: "WEB", label: "Website inbox & browser alerts" },
  { value: "EMAIL", label: "Email notifications" },
];

export default function SubscribeDialog({ open, onClose, onSubscribed, isDark = false, invitation = false }) {
  const [email, setEmail] = useState("");
  const [topics, setTopics] = useState(["ARTICLE_UPDATES", "FEATURE_UPDATES"]);
  const [channels, setChannels] = useState(["WEB", "EMAIL"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [subscriber, setSubscriber] = useState(null);
  const firstFieldRef = useRef(null);
  const dialogRef = useRef(null);
  const doneRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (open) {
      const existing = loadSubscriber();
      setSubscriber(existing);
      if (existing && existing.email) setEmail(existing.email);
      if (Array.isArray(existing?.topics) && existing.topics.length) setTopics(existing.topics);
      if (Array.isArray(existing?.channels) && existing.channels.length) setChannels(existing.channels);
      setError(null);
      setSuccess(false);
      setConfirmationRequired(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    recordSubscriptionPrompt(window);
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const alreadyOpen = document.body.classList.contains(styles.dialogOpen);
    document.body.classList.add(styles.dialogOpen);
    document.body.style.overflow = "hidden";
    // An automatic invitation must not summon the phone keyboard.
    (invitation ? dialogRef.current : firstFieldRef.current)?.focus({ preventScroll: true });
    function onKey(e) {
      if (e.key === "Escape" && !e.isComposing) closeRef.current?.();
      if (e.key !== "Tab") return;
      const fields = dialogRef.current?.querySelectorAll('input:not([disabled]), button:not([disabled]), a[href]');
      const first = fields?.[0], last = fields?.[fields.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault(); last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (!alreadyOpen) document.body.classList.remove(styles.dialogOpen);
      if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
    };
  }, [open, invitation]);

  useEffect(() => {
    if (!open || !window.visualViewport) return undefined;
    const viewport = window.visualViewport;
    const resize = () => {
      dialogRef.current?.style.setProperty("--visible-height", `${viewport.height}px`);
      dialogRef.current?.style.setProperty("--visible-top", `${viewport.offsetTop}px`);
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, [open]);

  useEffect(() => {
    if (open && success) doneRef.current?.focus({ preventScroll: true });
  }, [open, success]);

  if (!open) return null;

  function toggle(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (topics.length === 0) {
      setError("Please choose at least one update type.");
      return;
    }
    if (channels.length === 0) {
      setError("Please choose at least one notification channel.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, topics, channels }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Subscription failed. Please try again.");
        return;
      }
      if (data.status === "CONFIRMATION_REQUIRED") {
        setConfirmationRequired(true);
        setSuccess(true);
        return;
      }
      setConfirmationRequired(false);
      saveSubscriber(data.subscriberId, data.subscriberToken, {
        email,
        unsubscribeToken: data.unsubscribeToken,
        channels, topics,
      });
      setSubscriber({ subscriberId: data.subscriberId, subscriberToken: data.subscriberToken, channels, topics });
      setSuccess(true);
      if (onSubscribed) onSubscribed({ subscriberId: data.subscriberId, subscriberToken: data.subscriberToken });
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof document === "undefined") return null;

  // The sticky header's transform would otherwise clip this fixed overlay.
  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.overlay}
      data-theme={isDark ? "dark" : "light"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscribe-title"
      aria-describedby={invitation && !success ? "subscribe-invitation" : undefined}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <Bell size={20} aria-hidden="true" />
            <h3 id="subscribe-title">{invitation ? "Stay in the loop?" : "Subscribe to updates"}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className={styles.close}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {success ? (
          <>
            <div className={`${styles.body} ${styles.success}`}>
              <Check size={32} aria-hidden="true" />
              <p>{confirmationRequired ? "Check your email and confirm your subscription. Nothing changes until you confirm." : <>You&apos;re subscribed! You&apos;ll be notified{channels.includes("EMAIL") ? " by email" : ""} when an update matches your interests.</>}</p>
              {!confirmationRequired && channels.includes("WEB") && subscriber && <BrowserPushSettings subscriber={subscriber} />}
            </div>
            <footer className={styles.actions}>
              <button ref={doneRef} type="button" onClick={onClose} className={styles.primary}>Done</button>
            </footer>
          </>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.body}>
              {subscriber && (!Array.isArray(subscriber.channels) || subscriber.channels.includes("WEB")) && <BrowserPushSettings subscriber={subscriber} />}
              {invitation && <p id="subscribe-invitation" className={styles.introduction}>
                New articles and projects from Yuqi. Unsubscribe anytime.
              </p>}

              <div className={styles.emailField}>
                <label htmlFor="sub-email">Email</label>
                <input
                  id="sub-email" ref={firstFieldRef} type="email" inputMode="email" autoComplete="email"
                  required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                />
              </div>

              <fieldset className={styles.choices}>
                <legend>Interests</legend>
                {TOPIC_OPTIONS.map(opt => (
                  <label key={opt.value} className={styles.option}>
                    <input type="checkbox" checked={topics.includes(opt.value)} onChange={() => setTopics(t => toggle(t, opt.value))} />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset className={styles.choices}>
                <legend>Notify me via</legend>
                {CHANNEL_OPTIONS.map(opt => (
                  <label key={opt.value} className={styles.option}>
                    <input type="checkbox" checked={channels.includes(opt.value)} onChange={() => setChannels(c => toggle(c, opt.value))} />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </fieldset>
              {error && <div role="alert" className={styles.error}>{error}</div>}
            </div>

            <footer className={styles.actions}>
              <button type="button" onClick={onClose} className={styles.secondary}>{invitation ? "Not now" : "Cancel"}</button>
              <button type="submit" disabled={submitting} className={styles.primary}>{submitting ? "Subscribing..." : "Subscribe"}</button>
            </footer>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
