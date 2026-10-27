import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

// The terminal UI only loads the first time someone opens it.
const SiteTerminal = dynamic(() => import("./SiteTerminal"), { ssr: false });

export const OPEN_TERMINAL_EVENT = "yuqi:open-terminal";

const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// Opens the site terminal with ` (backtick) or ⌘K / Ctrl+K, or when something dispatches
// OPEN_TERMINAL_EVENT (the footer button does, for phones without a keyboard).
export default function TerminalLauncher() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "`" && !mod && !event.altKey && !typing(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    // Load the terminal's code once the page is idle, so the first ` opens it instantly.
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
    const cancelIdle = window.cancelIdleCallback || clearTimeout;
    const preload = idle(() => { import("./SiteTerminal").catch(() => {}); });
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_TERMINAL_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_TERMINAL_EVENT, onOpen);
      cancelIdle(preload);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Mr. Pot's launcher sits at the top z-index too; step it aside while the terminal is open.
    document.documentElement.classList.add("site-terminal-open");
    return () => {
      document.body.style.overflow = previous;
      document.documentElement.classList.remove("site-terminal-open");
    };
  }, [open]);

  return open ? <SiteTerminal onClose={close} /> : null;
}
