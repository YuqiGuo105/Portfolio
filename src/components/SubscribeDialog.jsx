import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { saveSubscriber, loadSubscriber } from "../lib/notificationsClient";

const TOPIC_OPTIONS = [
  { value: "ARTICLE_UPDATES", label: "Article updates" },
  { value: "FEATURE_UPDATES", label: "New feature updates" },
  { value: "JOB_UPDATES", label: "Job position updates" },
];

const CHANNEL_OPTIONS = [
  { value: "WEB", label: "Website notifications" },
  { value: "EMAIL", label: "Email notifications" },
];

/**
 * Subscribe dialog. Controlled component.
 *
 * Props:
 *   - open: boolean
 *   - onClose: () => void
 *   - onSubscribed?: ({ subscriberId, subscriberToken }) => void
 */
export default function SubscribeDialog({ open, onClose, onSubscribed, isDark = false }) {
  const [email, setEmail] = useState("");
  const [topics, setTopics] = useState(["ARTICLE_UPDATES", "FEATURE_UPDATES"]);
  const [channels, setChannels] = useState(["WEB", "EMAIL"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 520);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (open) {
      const existing = loadSubscriber();
      if (existing && existing.email) setEmail(existing.email);
      setError(null);
      setSuccess(false);
      setTimeout(() => firstFieldRef.current && firstFieldRef.current.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape" && open) onClose && onClose(); }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
      saveSubscriber(data.subscriberId, data.subscriberToken, {
        email,
        unsubscribeToken: data.unsubscribeToken,
      });
      setSuccess(true);
      if (onSubscribed) onSubscribed({ subscriberId: data.subscriberId, subscriberToken: data.subscriberToken });
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const bg = isDark ? "#1e1e2a" : "#fff";
  const fg = isDark ? "#e8e8e8" : "#111";
  const subtle = isDark ? "#aaa" : "#555";
  const border = isDark ? "#383850" : "#e5e5e5";
  const inputBg = isDark ? "#2a2a3a" : "#f8f8f8";
  const inputBorder = isDark ? "#444" : "#d0d0d0";
  const sectionBg = isDark ? "#25253a" : "#f9f9fb";
  const accentBg = isDark ? "#4a90e2" : "#111";

  // Render the dialog through a portal mounted on document.body. The header
  // becomes `position: fixed` + `transform: translateZ(0)` once the user
  // scrolls past the hero — and any ancestor with a transform creates a new
  // containing block, which makes a descendant `position: fixed` element be
  // sized relative to that ancestor instead of the viewport. Without a portal
  // the overlay collapses into the ~80px sticky header strip whenever the
  // dialog is opened mid-page.
  if (typeof document === "undefined") return null;

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscribe-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
        zIndex: 9999, padding: isMobile ? 0 : 16,
      }}
    >
      <div
        style={{
          background: bg,
          color: fg,
          borderRadius: isMobile ? "14px 14px 0 0" : 14,
          width: "100%", maxWidth: isMobile ? "100%" : 460,
          boxShadow: isDark ? "0 24px 60px rgba(0,0,0,.75)" : "0 24px 60px rgba(0,0,0,.22)",
          fontFamily: "inherit",
          overflowY: "auto",
          maxHeight: isMobile ? "90dvh" : "95vh",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "20px 24px 16px",
          borderBottom: `1px solid ${border}`,
        }}>
          <h3 id="subscribe-title" style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Subscribe to updates
          </h3>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: subtle, fontSize: 22, lineHeight: 1,
              padding: "2px 6px", borderRadius: 6,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 24px" }}>
          {success ? (
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.5 }}>
                You&apos;re subscribed! You&apos;ll be notified{channels.includes("EMAIL") ? " by email" : ""} the next time something matching your selection goes live.
              </p>
              <button
                type="button" onClick={onClose}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: "11px 28px", borderRadius: 8, border: "none", background: accentBg, color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600 }}
              >Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Email */}
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="sub-email" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: subtle, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Email
                </label>
                <input
                  id="sub-email"
                  ref={firstFieldRef}
                  type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={{
                    width: "100%", padding: "10px 13px",
                    borderRadius: 8, border: `1px solid ${inputBorder}`,
                    fontSize: 15, background: inputBg, color: fg,
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Topics */}
              <div style={{ marginBottom: 16 }}>
                <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: subtle, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  What do you want updates about?
                </p>
                <div style={{ background: sectionBg, borderRadius: 8, overflow: "hidden", border: `1px solid ${border}` }}>
                  {TOPIC_OPTIONS.map((opt, i) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "11px 14px", fontSize: 14, cursor: "pointer",
                        borderTop: i > 0 ? `1px solid ${border}` : "none",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={topics.includes(opt.value)}
                        onChange={() => setTopics((t) => toggle(t, opt.value))}
                        style={{ width: 16, height: 16, cursor: "pointer", accentColor: accentBg }}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Channels */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: subtle, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  How should we notify you?
                </p>
                <div style={{ background: sectionBg, borderRadius: 8, overflow: "hidden", border: `1px solid ${border}` }}>
                  {CHANNEL_OPTIONS.map((opt, i) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "11px 14px", fontSize: 14, cursor: "pointer",
                        borderTop: i > 0 ? `1px solid ${border}` : "none",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={channels.includes(opt.value)}
                        onChange={() => setChannels((c) => toggle(c, opt.value))}
                        style={{ width: 16, height: 16, cursor: "pointer", accentColor: accentBg }}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <div role="alert" style={{
                  background: isDark ? "#3a1a1a" : "#fef0f0",
                  color: isDark ? "#f08080" : "#c0392b",
                  padding: "10px 14px", borderRadius: 8,
                  fontSize: 13, marginBottom: 16,
                  border: `1px solid ${isDark ? "#5a2a2a" : "#fac8c8"}`,
                }}>
                  {error}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", flexDirection: isMobile ? "column-reverse" : "row", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button" onClick={onClose}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                    padding: "10px 20px", borderRadius: 8,
                    border: `1px solid ${inputBorder}`,
                    background: "transparent", color: fg,
                    cursor: "pointer", fontSize: 14, fontWeight: 500,
                    width: isMobile ? "100%" : undefined,
                  }}
                >Cancel</button>
                <button
                  type="submit" disabled={submitting}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                    padding: "10px 24px", borderRadius: 8, border: "none",
                    background: submitting ? "#888" : accentBg,
                    color: "#fff", cursor: submitting ? "wait" : "pointer",
                    fontSize: 14, fontWeight: 600,
                    width: isMobile ? "100%" : undefined,
                  }}
                >{submitting ? "Subscribing…" : "Subscribe"}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
