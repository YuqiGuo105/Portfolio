import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Layout from "../src/layout/Layout";
import SeoHead, { absoluteUrl } from "../src/components/SeoHead";
import history from "../src/data/siteHistory.json";

// The homepage through time: each snapshot is a fresh build of a production commit, captured at
// 1440×900 (scripts/site-history). Drag the timeline, play it, or wipe between then and today.

const SNAPSHOTS = history.snapshots;
const LAST = SNAPSHOTS.length - 1;
const PLAY_MS = 1600;

const longDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const shortDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" });

function indexFromHash() {
  if (typeof window === "undefined") return LAST;
  const key = decodeURIComponent(window.location.hash.slice(1));
  if (!key) return LAST;
  const exact = SNAPSHOTS.findIndex((s) => s.sha.startsWith(key) || s.date === key);
  if (exact >= 0) return exact;
  // #2024-03 → the last snapshot on or before the end of that month
  const prefix = SNAPSHOTS.map((s, i) => (s.date <= `${key}-31` ? i : -1)).filter((i) => i >= 0);
  return prefix.length ? prefix[prefix.length - 1] : 0;
}

export default function SiteHistory() {
  const [index, setIndex] = useState(LAST);
  const [view, setView] = useState("cover"); // cover | full
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [isLight, setIsLight] = useState(true);
  const stripRef = useRef(null);
  const frameRef = useRef(null);
  const dragging = useRef(false);

  const snap = SNAPSHOTS[index];
  const today = SNAPSHOTS[LAST];

  useEffect(() => {
    setIndex(indexFromHash());
    const onHash = () => setIndex(indexFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const body = document.body;
    const sync = () => setIsLight(!body.classList.contains("dark-skin"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(body, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const go = useCallback((next, { fromUser = true } = {}) => {
    const clamped = Math.max(0, Math.min(LAST, next));
    setIndex(clamped);
    if (fromUser) setPlaying(false);
    const url = `${window.location.pathname}#${SNAPSHOTS[clamped].date}`;
    window.history.replaceState(null, "", url);
  }, []);

  // Keep the neighbours warm so dragging and playing never wait on the network.
  useEffect(() => {
    [index - 1, index + 1, index + 2].forEach((i) => {
      if (i < 0 || i > LAST) return;
      const img = new Image();
      img.src = view === "full" ? SNAPSHOTS[i].full : SNAPSHOTS[i].cover;
    });
  }, [index, view]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= LAST) { setPlaying(false); return i; }
        return i + 1;
      });
    }, PLAY_MS);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== "range") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
      if (e.key === " " && e.target === document.body) { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);

  // Keep the selected thumbnail in view in the film strip.
  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-i="${index}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  const years = useMemo(() => {
    const seen = new Map();
    SNAPSHOTS.forEach((s, i) => { const y = s.date.slice(0, 4); if (!seen.has(y)) seen.set(y, i); });
    return [...seen.entries()];
  }, []);

  const moveSplit = (clientX) => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return;
    setSplit(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  const src = view === "full" ? snap.full : snap.cover;
  const todaySrc = view === "full" ? today.full : today.cover;
  const ratio = view === "full" ? `${snap.fullWidth} / ${snap.fullHeight}` : "16 / 10";
  const compareOn = compare && index !== LAST;

  return (
    <Layout>
      <SeoHead
        title="This site, then and now"
        description="Drag a timeline through every era of yuqi.site's homepage, rebuilt from its git history."
        url={absoluteUrl("/site-history")}
      />
      <section className="section section-inner started-heading">
        <div className="container">
          <div className="h-titles">
            <h1 className="h-title">Then and now</h1>
          </div>
        </div>
      </section>

      <section className={`site-history ${isLight ? "light" : "dark"}`}>
        <div className="container">
          <p className="lede">
            {SNAPSHOTS.length} versions of this homepage, from {shortDate(SNAPSHOTS[0].date)} to today.
            Each one is a fresh build of the commit that was live at the time. Drag the timeline, press play,
            or wipe between then and now.
          </p>

          <div className="toolbar">
            <div className="seg" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={view === "cover"} className={view === "cover" ? "on" : ""} onClick={() => setView("cover")}>First screen</button>
              <button type="button" role="tab" aria-selected={view === "full"} className={view === "full" ? "on" : ""} onClick={() => setView("full")}>Whole page</button>
            </div>
            <label className="check">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              Compare with today
            </label>
          </div>

          <div className="browser">
            <div className="chrome">
              <span className="dot r" /><span className="dot y" /><span className="dot g" />
              <span className="url">yuqi.site <span className="when">· {longDate(snap.date)}</span></span>
            </div>
            <div className={`viewport ${view}`}>
              <div
                ref={frameRef}
                className="frame"
                style={{ aspectRatio: ratio }}
                onPointerDown={(e) => { if (compareOn) { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); moveSplit(e.clientX); } }}
                onPointerMove={(e) => { if (dragging.current) moveSplit(e.clientX); }}
                onPointerUp={() => { dragging.current = false; }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={src} src={src} alt={`yuqi.site homepage on ${longDate(snap.date)}`} className="shot" draggable={false} />
                {compareOn && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={todaySrc} alt="yuqi.site homepage today" className="shot today" style={{ clipPath: `inset(0 0 0 ${split}%)` }} draggable={false} />
                    <div className="divider" style={{ left: `${split}%` }} aria-hidden="true"><span>⇆</span></div>
                    <span className="tag then">{shortDate(snap.date)}</span>
                    <span className="tag now">Today</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="timeline">
            <button type="button" className="play" onClick={() => { if (index >= LAST) setIndex(0); setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play"}>
              {playing ? "❚❚" : "▶"}
            </button>
            <div className="track">
              <input
                type="range"
                min={0}
                max={LAST}
                step={1}
                value={index}
                onChange={(e) => go(Number(e.target.value))}
                aria-label="Point in time"
                aria-valuetext={longDate(snap.date)}
              />
              <div className="years" aria-hidden="true">
                {years.map(([y, i]) => (
                  <span key={y} style={{ left: `${(i / LAST) * 100}%` }}>{y}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="meta">
            <div>
              <div className="date">{longDate(snap.date)}</div>
              <div className="sub">
                Commit{" "}
                <a href={`${history.repo}/commit/${snap.sha}`} target="_blank" rel="noopener noreferrer"><code>{snap.sha}</code></a>
                {snap.previous ? (
                  <>
                    {" · "}
                    <a href={`${history.repo}/compare/${snap.previous}...${snap.sha}`} target="_blank" rel="noopener noreferrer">
                      {snap.commits} commit{snap.commits === 1 ? "" : "s"} since the previous version
                    </a>
                  </>
                ) : " · the first deploy"}
              </div>
              {snap.changes?.length > 0 && (
                <ul className="changes" aria-label="Homepage changes in this version">
                  {snap.changes.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </div>
            <div className="nav">
              <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Earlier version">←</button>
              <span>{index + 1} / {SNAPSHOTS.length}</span>
              <button type="button" onClick={() => go(index + 1)} disabled={index === LAST} aria-label="Later version">→</button>
            </div>
          </div>

          <div className="strip" ref={stripRef} aria-label="All versions">
            {SNAPSHOTS.map((s, i) => (
              <button type="button" key={s.sha} data-i={i} className={i === index ? "on" : ""} onClick={() => go(i)} aria-label={longDate(s.date)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.thumb} alt="" loading="lazy" width={144} height={90} />
                <span>{shortDate(s.date)}</span>
              </button>
            ))}
          </div>

          <p className="note">
            Rebuilt from git history and captured at 1440×900. Project and post cards show today&apos;s published
            entries that already existed on that date; contact details from old versions are blurred, and live
            widgets that need private keys (weather, markets, GitHub) appear empty.
          </p>
        </div>
      </section>

      <style jsx>{`
        .site-history { --fg: #1f2937; --muted: #64748b; --card: #ffffff; --line: rgba(15,23,42,0.12); --chrome: #eef0f3; --accent: #ff8059; padding: 0 0 80px; color: var(--fg); }
        .site-history.dark { --fg: #e5e7eb; --muted: #94a3b8; --card: #111827; --line: rgba(255,255,255,0.12); --chrome: #1f2937; }
        .lede { max-width: 760px; color: var(--muted); font-size: 16px; line-height: 1.6; margin: 0 0 22px; }
        .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-bottom: 14px; }
        .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 3px; background: var(--card); }
        .seg button { border: 0; background: transparent; color: var(--muted); font: 600 13px/1.2 Rubik, system-ui, sans-serif; padding: 7px 14px; border-radius: 999px; height: auto; margin: 0; cursor: pointer; }
        .seg button.on { background: var(--accent); color: #fff; }
        .check { display: inline-flex; align-items: center; gap: 8px; font: 14px/1.3 Rubik, system-ui, sans-serif; color: var(--fg); margin: 0; cursor: pointer; }
        .check input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
        .browser { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--card); box-shadow: 0 18px 50px rgba(15,23,42,0.12); }
        .chrome { display: flex; align-items: center; gap: 7px; padding: 10px 14px; background: var(--chrome); border-bottom: 1px solid var(--line); }
        .dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
        .r { background: #ff5f57; } .y { background: #febc2e; } .g { background: #28c840; }
        .url { margin-left: 10px; flex: 1; max-width: 520px; padding: 4px 12px; border-radius: 8px; background: var(--card); color: var(--fg); font: 13px/1.4 ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .when { color: var(--muted); }
        .viewport.full { max-height: 72vh; overflow-y: auto; overscroll-behavior: contain; }
        .frame { position: relative; width: 100%; background: #f5f3ef; user-select: none; touch-action: pan-y; }
        .shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; animation: fadein .25s ease; }
        .shot.today { animation: none; }
        .divider { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.25); cursor: ew-resize; }
        .divider span { position: sticky; top: 45%; display: grid; place-items: center; width: 34px; height: 34px; margin-left: -16px; margin-top: 30vh; border-radius: 50%; background: #fff; color: #111; font-size: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
        .viewport.cover .divider span { position: absolute; top: 50%; margin-top: -17px; }
        .tag { position: absolute; top: 10px; padding: 3px 9px; border-radius: 999px; background: rgba(15,23,42,0.75); color: #fff; font: 600 12px/1.4 system-ui, sans-serif; pointer-events: none; }
        .tag.then { left: 10px; } .tag.now { right: 10px; }
        .timeline { display: flex; align-items: center; gap: 14px; margin-top: 22px; }
        .play { flex: none; width: 44px; height: 44px; padding: 0; margin: 0; border-radius: 50%; line-height: 44px; font-size: 14px; border: 0; background: var(--accent); color: #fff; cursor: pointer; }
        .track { position: relative; flex: 1; padding-bottom: 22px; }
        .track input { width: 100%; margin: 0; accent-color: var(--accent); height: 24px; cursor: pointer; }
        .years { position: absolute; left: 8px; right: 8px; bottom: 0; height: 18px; }
        .years span { position: absolute; transform: translateX(-50%); font-size: 12px; color: var(--muted); }
        .meta { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
        .date { font-size: 22px; font-weight: 600; color: var(--fg); }
        .sub { font-size: 14px; color: var(--muted); margin-top: 4px; }
        .sub a { color: var(--accent); }
        .sub code { font-size: 13px; }
        .changes { margin: 10px 0 0; padding: 0 0 0 18px; color: var(--fg); font-size: 14px; line-height: 1.55; max-width: 720px; }
        .changes li { margin: 2px 0; }
        .nav { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; }
        .nav button { width: 38px; height: 38px; padding: 0; margin: 0; line-height: 36px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; font-size: 16px; }
        .nav button:disabled { opacity: 0.35; cursor: default; }
        .strip { display: flex; gap: 10px; overflow-x: auto; padding: 16px 2px 8px; margin-top: 10px; scrollbar-width: thin; }
        .strip button { flex: none; display: grid; gap: 5px; justify-items: center; padding: 4px; margin: 0; height: auto; line-height: 1.2; border: 2px solid transparent; border-radius: 10px; background: transparent; color: var(--muted); font: 500 12px/1.2 Rubik, system-ui, sans-serif; cursor: pointer; }
        .strip button img { width: 144px; height: 90px; object-fit: cover; object-position: top; border-radius: 6px; border: 1px solid var(--line); display: block; }
        .strip button.on { border-color: var(--accent); color: var(--fg); }
        .note { margin-top: 18px; font-size: 13px; color: var(--muted); max-width: 820px; line-height: 1.6; }
        .site-history :global(button::before), .site-history :global(button::after) { content: none !important; display: none !important; }
        @keyframes fadein { from { opacity: 0.35; } to { opacity: 1; } }
        @media (max-width: 767px) {
          .date { font-size: 18px; }
          .strip button img { width: 112px; height: 70px; }
          .viewport.full { max-height: 64vh; }
        }
        @media (prefers-reduced-motion: reduce) { .shot { animation: none; } }
      `}</style>
    </Layout>
  );
}
