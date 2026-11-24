import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Download, ImageIcon, Link2, QrCode, RefreshCw, Share2, X } from "lucide-react";
import { shareUrl } from "../../lib/share/link.mjs";
import { canvasBlob, displayUrl, fileName, posterCanvas } from "../../lib/share/poster.mjs";
import { qrPath, qrSvg } from "../../lib/share/qr.mjs";
import styles from "./Share.module.css";
import { trackWidget } from '../../lib/widgetTelemetry';

const save = (blob, name) => {
  const href = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href, download: name });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
};

export default function ShareSheet({ content, onClose }) {
  const id = useId();
  const dialog = useRef(null), preview = useRef(null), copyTimer = useRef(null), mounted = useRef(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState("link");
  const [imageRequested, setImageRequested] = useState(false);
  const [picture, setPicture] = useState("idle");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [canSystemShare, setCanSystemShare] = useState(false);
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  const urls = useMemo(() => {
    const make = via => shareUrl(content.url, via, { quote: content.quote, origin });
    return { link: make("link"), qr: make("qr"), image: make("image"), system: make("system") };
  }, [content.url, content.quote, origin]);
  const qr = useMemo(() => qrPath(urls.qr, { level: "M", quiet: 4 }), [urls.qr]);
  const poster = useMemo(() => ({ ...content, url: urls.link, qrUrl: urls.image }), [content, urls]);

  useEffect(() => {
    mounted.current = true;
    trackWidget('share');
    setCanSystemShare(typeof navigator.share === "function");
    return () => { mounted.current = false; clearTimeout(copyTimer.current); };
  }, []);

  // Font loading and the full-size canvas wait until the image tab is requested.
  useEffect(() => {
    if (!imageRequested) return;
    let live = true;
    setPicture("loading");
    posterCanvas(poster).then(canvas => {
      if (!live || !preview.current) return;
      const target = preview.current;
      target.width = canvas.width; target.height = canvas.height;
      target.getContext("2d").drawImage(canvas, 0, 0);
      setPicture("ready");
    }).catch(() => { if (live) setPicture("failed"); });
    return () => { live = false; };
  }, [poster, imageRequested, revision]);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector("[data-autofocus]")?.focus();
    const onKey = event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = [...dialog.current.querySelectorAll("button, input, a[href]")]
        .filter(item => !item.disabled && item.tabIndex >= 0 && !item.closest("[hidden]"));
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.documentElement.style.overflow = overflow; previous?.focus?.(); };
  }, [onClose]);

  const selectView = next => {
    setView(next); setStatus("");
    if (next === "image") setImageRequested(true);
  };
  const tabKeys = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "link" : event.key === "End" ? "image" : view === "link" ? "image" : "link";
    selectView(next); document.getElementById(`${id}-${next}-tab`)?.focus();
  };
  const copyLink = async () => {
    let success = false;
    try { await navigator.clipboard.writeText(urls.link); success = true; }
    catch {
      const field = dialog.current?.querySelector("input");
      field?.focus(); field?.select();
      try { success = document.execCommand?.("copy") === true; } catch { /* Leave the link selected. */ }
    }
    if (!mounted.current) return;
    if (!success) { clearTimeout(copyTimer.current); setCopied(false); setStatus("Could not copy. Select and copy the link."); return; }
    setCopied(true); setStatus("Link copied");
    trackWidget('share', 'link_copied');
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2200);
  };
  const savePicture = async () => {
    if (picture !== "ready" || saving) return;
    setSaving(true);
    try {
      const blob = await canvasBlob(preview.current);
      if (!mounted.current) return;
      save(blob, fileName(content.title, content.kind === "quote" ? "quote" : content.kind === "card" ? "card" : "share"));
      setStatus("Picture saved");
      trackWidget('share', 'image_download_requested');
    } catch { if (mounted.current) setStatus("Could not save the picture. Please try again."); }
    finally { if (mounted.current) setSaving(false); }
  };
  const saveCode = () => {
    try {
      save(new Blob([qrSvg(urls.qr, { quiet: 4, title: `QR code for ${displayUrl(urls.link)}` })], { type: "image/svg+xml" }), fileName(content.title, "qr").replace(/\.png$/, ".svg"));
      setStatus("QR code saved");
      trackWidget('share', 'qr_download_requested');
    } catch { setStatus("Could not save the QR code. Please try again."); }
  };
  const systemShare = async () => {
    try { await navigator.share({ title: content.title, text: content.kind === "quote" ? `“${content.text}”` : content.title, url: urls.system }); }
    catch (error) { if (mounted.current && error?.name !== "AbortError") setStatus("Sharing did not open. Copy the link instead."); }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`${styles.sheet} ${styles.backdrop}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} ref={dialog} data-share-kind={content.kind}>
        <div className={styles.head}>
          <h2 id={`${id}-heading`} className={styles.heading}>{content.heading || "Share"}<span>.</span></h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close share window" title="Close"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className={styles.subject}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {content.image ? <img className={styles.portrait} src={content.image} width={48} height={48} alt="" /> : <span className={styles.subjectIcon}><Share2 size={22} aria-hidden="true" /></span>}
          <div><p className={styles.what}>{content.title}</p><p className={styles.note}>{content.kind === "card" ? content.role || "Contact card" : content.label || "yuqi.site"}</p></div>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Share format" onKeyDown={tabKeys}>
          <button type="button" role="tab" id={`${id}-link-tab`} aria-controls={`${id}-link-panel`} aria-selected={view === "link"} tabIndex={view === "link" ? 0 : -1} onClick={() => selectView("link")}><QrCode size={17} aria-hidden="true" /> Link &amp; QR</button>
          <button type="button" role="tab" id={`${id}-image-tab`} aria-controls={`${id}-image-panel`} aria-selected={view === "image"} tabIndex={view === "image" ? 0 : -1} onClick={() => selectView("image")}><ImageIcon size={17} aria-hidden="true" /> Share image</button>
        </div>
        <div className={styles.body}>
          <div role="tabpanel" id={`${id}-link-panel`} aria-labelledby={`${id}-link-tab`} hidden={view !== "link"} className={styles.linkPanel}>
            {content.kind === "quote" && <blockquote className={styles.quote}>{content.text}</blockquote>}
            <div className={styles.codeArea}>
              <svg className={styles.code} viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`QR code for ${displayUrl(urls.link)}`} shapeRendering="crispEdges">
                <rect width={qr.size} height={qr.size} fill="#ffffff" /><path d={qr.d} fill="#1c2528" />
              </svg>
              <p className={styles.codeTitle}>{content.kind === "card" ? "Open contact card" : "Open on your phone"}</p>
              <p className={styles.destination}>{displayUrl(urls.link)}</p>
            </div>
            <div className={styles.linkRow}>
              <Link2 size={17} aria-hidden="true" />
              <input id={`${id}-link`} className={styles.link} aria-label="Share link" readOnly value={urls.link} onFocus={event => event.target.select()} />
              <button type="button" className={styles.copy} onClick={copyLink} data-autofocus aria-label={copied ? "Link copied" : "Copy link"} title={copied ? "Link copied" : "Copy link"}>
                {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <div role="tabpanel" id={`${id}-image-panel`} aria-labelledby={`${id}-image-tab`} hidden={view !== "image"} className={styles.imagePanel}>
            <div className={styles.picture} data-state={picture} aria-busy={picture === "loading"}>
              <canvas ref={preview} className={styles.canvas} role="img" aria-label="Share image preview" />
              {picture !== "ready" && <div className={styles.pictureState}>
                {picture === "failed" ? <><p>Preview unavailable</p><button type="button" className={styles.secondary} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /> Retry</button></> : <><ImageIcon size={24} aria-hidden="true" /><p>Preparing image...</p></>}
              </div>}
            </div>
            <p className={styles.imageMeta}>PNG · 1080 × 1350</p>
          </div>
        </div>
        <div className={styles.footer}>
          <div className={styles.actions}>
            {view === "link" ? <button type="button" className={styles.secondary} onClick={saveCode}><Download size={17} aria-hidden="true" /> Save QR</button> : <button type="button" className={styles.primary} onClick={savePicture} disabled={picture !== "ready" || saving}><Download size={17} aria-hidden="true" /> {saving ? "Saving..." : "Save image"}</button>}
            {canSystemShare && <button type="button" className={view === "link" ? styles.primary : styles.secondary} onClick={systemShare}><Share2 size={17} aria-hidden="true" /> Share...</button>}
          </div>
          <p className={styles.status} role="status" aria-live="polite">{status}</p>
        </div>
      </div>
    </div>, document.body
  );
}
