import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { addLocalFlag, useGlobeLive } from "../lib/globeLive";

const RotatingGlobe = dynamic(() => import("./RotatingGlobe"), { ssr: false });

// Kept in step with src/lib/globeFlags.mjs (the server is the authority).
const EMOJIS = ["🚩", "👋", "❤️", "🌏", "☕", "🚀", "🎉", "🐼"];
const MESSAGE_MAX = 60;
const ERRORS = {
  rate_limited: "That's 3 flags this hour. Come back later!",
  message_not_allowed: "Notes can't contain links, emails or phone numbers.",
  message_too_long: `Keep the note under ${MESSAGE_MAX} characters.`,
  location_required: "Tap the globe to choose where your flag goes.",
  unavailable: "The guestbook is taking a break. Try again soon.",
};

const place = (p) => [p?.city, p?.country].filter(Boolean).join(", ");

// The visitor globe plus its live layer: how many people are looking right now, a ripple where each
// new visitor arrives, and a guestbook of flags. `globeProps` go straight to RotatingGlobe.
export default function LiveGlobe({ globeProps = {}, compact = false }) {
  const live = useGlobeLive(true);
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [message, setMessage] = useState("");
  const [spot, setSpot] = useState(null); // null = my city
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [ticker, setTicker] = useState(null);
  const honeypot = useRef(null);
  const seenPulses = useRef(new Set());

  // Announce arrivals from elsewhere ("Someone in Tokyo just arrived").
  useEffect(() => {
    const fresh = live.pulses.find((p) => !p.self && !seenPulses.current.has(p.id));
    live.pulses.forEach((p) => seenPulses.current.add(p.id));
    if (!fresh) return undefined;
    setTicker(fresh.city ? `Someone in ${fresh.city} just arrived` : "Someone just arrived");
    const timer = setTimeout(() => setTicker(null), 4500);
    return () => clearTimeout(timer);
  }, [live.pulses]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const where = spot
    ? `${spot.lat.toFixed(1)}°, ${spot.lng.toFixed(1)}°`
    : live.me ? place(live.me) || "your city" : null;

  async function submit(event) {
    event.preventDefault();
    if (sending) return;
    if (!spot && !live.me) { setPicking(true); setNotice({ error: true, text: ERRORS.location_required }); return; }
    setSending(true);
    try {
      const res = await fetch("/api/globe/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emoji,
          ...(message.trim() ? { message: message.trim() } : {}),
          ...(spot ? { lat: spot.lat, lng: spot.lng } : {}),
          ...(honeypot.current?.value ? { website: honeypot.current.value } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(ERRORS[body.error] || ERRORS.unavailable);
      if (body.flag) {
        addLocalFlag(body.flag);
        setFlyTo({ lat: body.flag.lat, lng: body.flag.lng, key: body.flag.id });
        setNotice({ text: `${emoji} Your flag is on the globe!` });
      } else {
        setNotice({ text: "Thanks! Your note shows up once Yuqi has read it." });
      }
      setOpen(false); setPicking(false); setMessage(""); setSpot(null);
    } catch (err) {
      setNotice({ error: true, text: err.message });
    } finally {
      setSending(false);
    }
  }

  const count = live.count || 1;
  const pickProps = useMemo(() => ({
    picking,
    onPickLocation: ({ lat, lng }) => { setSpot({ lat, lng }); setPicking(false); setOpen(true); },
  }), [picking]);

  return (
    <div className={`live-globe ${compact ? "compact" : ""}`}>
      <RotatingGlobe
        {...globeProps}
        flags={live.flags}
        pulses={live.pulses}
        peers={live.peers}
        flyTo={flyTo}
        {...pickProps}
      />

      <div className="lg-status" aria-live="polite">
        <span className="lg-dot" aria-hidden="true" />
        {count === 1 ? "Just you here now" : `${count} people here now`}
        {live.flags.length > 0 && <span className="lg-sub"> · {live.flags.length} flags</span>}
      </div>

      {ticker && <div className="lg-ticker" role="status">{ticker}</div>}
      {picking && <div className="lg-ticker lg-pick">Tap anywhere on the globe to place your flag</div>}

      {live.flagsEnabled && !open && !picking && (
        <button type="button" className="lg-plant" onClick={() => { setOpen(true); setNotice(null); }}>
          🚩 Plant a flag
        </button>
      )}

      {notice && !open && <div className={`lg-notice ${notice.error ? "err" : ""}`} role="status">{notice.text}</div>}

      {open && (
        <form className="lg-panel" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
          <div className="lg-row lg-head">
            <strong>Leave your mark</strong>
            <button type="button" className="lg-x" aria-label="Close" onClick={() => { setOpen(false); setPicking(false); }}>×</button>
          </div>
          <div className="lg-emojis" role="radiogroup" aria-label="Flag">
            {EMOJIS.map((e) => (
              <button type="button" key={e} role="radio" aria-checked={emoji === e}
                className={emoji === e ? "on" : ""} onClick={() => setEmoji(e)}>{e}</button>
            ))}
          </div>
          <input
            className="lg-input"
            value={message}
            maxLength={MESSAGE_MAX}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Say hi (optional)"
            aria-label="Note (optional)"
          />
          <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="lg-hp" />
          <div className="lg-row lg-where">
            <span>📍 {where || "Choose a spot"}</span>
            <button type="button" className="lg-link" onClick={() => { setPicking(true); setOpen(false); }}>
              {spot ? "Move" : "Pick on globe"}
            </button>
            {spot && live.me && <button type="button" className="lg-link" onClick={() => setSpot(null)}>My city</button>}
          </div>
          {message.trim() && <p className="lg-hint">Notes appear after a quick review. Emoji-only flags show right away.</p>}
          {notice?.error && <p className="lg-hint err">{notice.text}</p>}
          <button type="submit" className="lg-go" disabled={sending}>{sending ? "Planting…" : `Plant ${emoji}`}</button>
        </form>
      )}

      <style jsx>{`
        .live-globe { position: relative; width: 100%; height: 100%; }
        .live-globe button::before, .live-globe button::after { content: none; display: none; }
        .live-globe :global(button.globe-flag::before), .live-globe :global(button.globe-flag::after) { content: none; display: none; }
        .live-globe :global(button.globe-flag:hover) { transform: translateX(-50%) scale(1.25) !important; }
        .lg-status, .lg-ticker, .lg-plant, .lg-notice, .lg-panel {
          position: absolute; z-index: 6; font: 500 12px/1.3 system-ui, -apple-system, sans-serif;
          color: #fff; background: rgba(15, 23, 42, 0.62); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 999px;
        }
        .lg-status { left: 10px; top: 10px; padding: 5px 10px; display: flex; align-items: center; gap: 6px; pointer-events: none; }
        .lg-sub { opacity: 0.75; }
        .lg-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,.6); animation: lgping 1.8s infinite; }
        @keyframes lgping { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 80%,100% { box-shadow: 0 0 0 7px rgba(34,197,94,0); } }
        .lg-ticker { right: 10px; top: 10px; padding: 5px 10px; max-width: 60%; pointer-events: none; animation: lgin .35s ease; }
        .lg-pick { left: 50%; right: auto; top: auto; bottom: 12px; transform: translateX(-50%); max-width: 90%; text-align: center; background: rgba(234, 88, 12, 0.85); }
        .lg-plant { left: 10px; bottom: 10px; padding: 7px 12px; cursor: pointer; height: auto; line-height: 1.2; margin: 0; box-shadow: none; }
        .lg-plant:hover { background: rgba(234, 88, 12, 0.9); }
        .lg-notice { left: 10px; right: 10px; bottom: 50px; padding: 7px 12px; border-radius: 12px; text-align: center; pointer-events: none; animation: lgin .35s ease; }
        .lg-notice.err { background: rgba(185, 28, 28, 0.85); }
        .lg-panel { left: 10px; right: 10px; bottom: 10px; max-width: 340px; padding: 10px 12px; border-radius: 14px; display: grid; gap: 8px; max-height: calc(100% - 50px); overflow: auto; background: rgba(15, 23, 42, 0.86); }
        .lg-row { display: flex; align-items: center; gap: 8px; }
        .lg-head { justify-content: space-between; font-size: 13px; }
        .lg-x { background: none; border: 0; color: #fff; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; height: auto; margin: 0; box-shadow: none; }
        .lg-emojis { display: flex; flex-wrap: wrap; gap: 4px; }
        .lg-emojis button { font-size: 18px; line-height: 1; padding: 5px; border-radius: 8px; border: 1px solid transparent; background: rgba(255,255,255,0.08); cursor: pointer; height: auto; margin: 0; box-shadow: none; }
        .lg-emojis button.on { border-color: #fb923c; background: rgba(251,146,60,0.25); }
        .lg-input { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: #fff; -webkit-text-fill-color: #fff; opacity: 1; font: 13px system-ui, sans-serif; height: auto; margin: 0; }
        .lg-input::placeholder { color: rgba(255,255,255,0.55); }
        .lg-hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
        .lg-where { flex-wrap: wrap; font-size: 12px; opacity: 0.95; }
        .lg-link { background: none; border: 0; color: #fdba74; cursor: pointer; padding: 0; font: inherit; text-decoration: underline; height: auto; margin: 0; box-shadow: none; }
        .lg-hint { margin: 0; font-size: 11px; opacity: 0.75; }
        .lg-hint.err { color: #fca5a5; opacity: 1; }
        .lg-go { padding: 8px 12px; border-radius: 10px; border: 0; background: #ea580c; color: #fff; font: 600 13px system-ui, sans-serif; cursor: pointer; height: auto; line-height: 1.2; margin: 0; box-shadow: none; }
        .lg-go:disabled { opacity: 0.6; cursor: default; }
        .compact .lg-status { top: 8px; left: 8px; }
        @keyframes lgin { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        .lg-pick { animation: none; }
        @media (prefers-reduced-motion: reduce) { .lg-dot, .lg-ticker, .lg-notice { animation: none; } }
      `}</style>
    </div>
  );
}
