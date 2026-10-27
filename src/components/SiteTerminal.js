import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { PROMPT_HOST, PROMPT_USER, complete, runCommand } from "../lib/terminalCommands.mjs";

const QUICK = ["help", "ls projects", "cat resume.txt", "mcp call search_portfolio kafka", "kubectl get pods", "git log", "sudo hire yuqi"];
const MAX_LINES = 600;
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const TTL_MS = 10 * 60_000;
const STORE_KEY = "ysh-cache-v1";

// Answers are kept for the page (and the tab, via sessionStorage) so reopening the terminal or
// repeating a command is instant; identical calls in flight share one request.
const memory = new Map();
const inflight = new Map();

function readStore() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}
function remember(key, value) {
  memory.set(key, { at: Date.now(), value });
  try {
    const store = readStore();
    store[key] = { at: Date.now(), value };
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* storage full or blocked: memory still works */ }
}
function recall(key, ttl = TTL_MS) {
  const hit = memory.get(key) || readStore()[key];
  return hit && Date.now() - hit.at < ttl ? hit.value : null;
}
function once(key, load) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = load().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function callTool(tool, args = {}) {
  const query = typeof args.query === "string" ? args.query.trim().replace(/\s+/g, " ").toLowerCase() : "";
  const key = `mcp:${tool}:${query}`;
  const cached = recall(key);
  if (cached) return { ...cached, via: "cache" };
  return once(key, async () => {
    try {
      const params = new URLSearchParams({ tool, ...(query ? { q: query } : {}) });
      const res = await fetch(`/api/terminal/mcp?${params}`);
      const body = await res.json().catch(() => ({ error: "unavailable" }));
      if (!res.ok) return { error: body.error || "unavailable" };
      remember(key, body);
      const edge = res.headers.get("x-vercel-cache");
      return { ...body, via: edge === "HIT" || edge === "STALE" ? "cache" : "live" };
    } catch {
      return { error: "unavailable" };
    }
  });
}

async function fetchJson(url, ttl = 20_000) {
  const key = `get:${url}`;
  const cached = recall(key, ttl);
  if (cached) return cached;
  return once(key, async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const body = await res.json();
      remember(key, body);
      return body;
    } catch { return null; }
  });
}

let evolution = null;
const loadEvolution = () => {
  evolution = evolution || import("../../docs/architecture/platform-evolution.json")
    .then((data) => (data.default || data).milestones || []);
  return evolution;
};

// What the first commands people run will need, fetched while they read the welcome text.
export function warmTerminal() {
  callTool("list_projects");
  callTool("get_profile");
  fetchJson("/api/metrics");
  loadEvolution();
  setTimeout(() => callTool("list_articles"), 800);
}

const welcome = () => [
  { text: "ysh — the yuqi.site shell", tone: "head" },
  { text: "Real data: projects and articles come from the public MCP server, services from live monitoring.", tone: "dim" },
  { text: "Type `help` to start, or tap a command below.", tone: "dim" },
  { text: "" },
];

export default function SiteTerminal({ onClose }) {
  const router = useRouter();
  const [lines, setLines] = useState(welcome);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const historyRef = useRef([]);
  const cursorRef = useRef(-1);
  const [startedAt, setStartedAt] = useState(0);
  const [tick, setTick] = useState(0);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); warmTerminal(); }, []);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 90);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  const open = useCallback((path) => {
    setTimeout(() => {
      if (path.startsWith("/#") && router.pathname === "/") {
        onClose();
        document.querySelector(path.slice(1))?.scrollIntoView({ behavior: "smooth" });
      } else {
        router.push(path);
      }
    }, 150);
    return [{ text: `→ ${path}`, tone: "dim" }];
  }, [router, onClose]);

  const ctx = useMemo(() => ({
    callTool,
    fetchJson: (url) => fetchJson(url),
    loadEvolution,
    async whereami() {
      try { return await (await fetch("/api/globe/whereami")).json(); } catch { return null; }
    },
    open,
    now: () => new Date(),
    history: () => historyRef.current,
    clear: () => setLines([]),
    close: onClose,
  }), [open, onClose]);

  const run = useCallback(async (command) => {
    const text = command.trim();
    setInput("");
    cursorRef.current = -1;
    const echo = { text: `${PROMPT_USER}@${PROMPT_HOST}:~$ ${text}`, tone: "prompt" };
    if (!text) { setLines((current) => [...current, echo]); return; }
    historyRef.current = [...historyRef.current.filter((h) => h !== text), text].slice(-50);
    setLines((current) => [...current, echo]);
    setBusy(true);
    setStartedAt(Date.now());
    const out = await runCommand(text, ctx);
    setBusy(false);
    if (text === "clear") return;
    setLines((current) => [...current, ...out].slice(-MAX_LINES));
  }, [ctx]);

  function onKeyDown(event) {
    if (event.key === "Enter") { event.preventDefault(); if (!busy) run(input); return; }
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "Tab") {
      event.preventDefault();
      const next = complete(input);
      if (next) setInput(next);
      return;
    }
    if (event.key === "l" && event.ctrlKey) { event.preventDefault(); setLines([]); return; }
    const history = historyRef.current;
    if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      cursorRef.current = cursorRef.current < 0 ? history.length - 1 : Math.max(0, cursorRef.current - 1);
      setInput(history[cursorRef.current]);
    }
    if (event.key === "ArrowDown" && cursorRef.current >= 0) {
      event.preventDefault();
      cursorRef.current += 1;
      if (cursorRef.current >= history.length) { cursorRef.current = -1; setInput(""); }
      else setInput(history[cursorRef.current]);
    }
  }

  return (
    <div className="term-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="term" role="dialog" aria-modal="true" aria-label="Site terminal">
        <div className="term-bar">
          <button type="button" className="dot red" aria-label="Close terminal" onClick={onClose} />
          <span className="dot yellow" aria-hidden="true" />
          <span className="dot green" aria-hidden="true" />
          <span className="term-title">{PROMPT_USER}@{PROMPT_HOST}: ~</span>
        </div>
        <div className="term-body" ref={bodyRef} onClick={() => inputRef.current?.focus()}>
          {lines.map((l, i) => (
            <div key={i} className={`term-line ${l.tone || ""} ${l.pre ? "pre" : ""}`}>
              {l.href ? (
                <a href={l.href} target={/^https?:/.test(l.href) && !l.href.startsWith("https://www.yuqi.site") ? "_blank" : undefined}
                  rel="noopener noreferrer" onClick={(e) => {
                    if (l.href.startsWith("/") || l.href.startsWith("https://www.yuqi.site")) {
                      e.preventDefault();
                      open(l.href.replace("https://www.yuqi.site", "") || "/");
                    }
                  }}>{l.text}</a>
              ) : l.text || " "}
            </div>
          ))}
          {busy && (
            <div className="term-line dim" aria-live="polite">
              {SPINNER[tick % SPINNER.length]} running · {((Date.now() - startedAt) / 1000).toFixed(1)}s
            </div>
          )}
          <div className="term-input">
            <span className="term-prompt">{PROMPT_USER}@{PROMPT_HOST}:~$</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              aria-label="Command"
            />
          </div>
        </div>
        <div className="term-quick" aria-label="Quick commands">
          {QUICK.map((cmd) => (
            <button type="button" key={cmd} disabled={busy} onClick={() => run(cmd)}>{cmd}</button>
          ))}
        </div>
      </div>
      <style jsx>{`
        .term-backdrop { position: fixed; inset: 0; z-index: 2147483647; background: rgba(2, 6, 23, 0.45); display: flex; align-items: center; justify-content: center; padding: 16px; animation: tin .18s ease; }
        .term { width: min(780px, 100%); height: min(520px, calc(100vh - 32px)); display: flex; flex-direction: column; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,0.45); overflow: hidden; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .term-bar { display: flex; align-items: center; gap: 7px; padding: 9px 12px; background: #161b22; border-bottom: 1px solid #30363d; }
        .dot { width: 12px; height: 12px; border-radius: 50%; border: 0; padding: 0; margin: 0; display: inline-block; height: 12px; line-height: 0; box-shadow: none; }
        .red { background: #ff5f57; cursor: pointer; } .yellow { background: #febc2e; } .green { background: #28c840; }
        .term-title { margin-left: 8px; color: #8b949e; font-size: 12px; }
        .term-body { flex: 1; overflow: auto; padding: 12px 14px; cursor: text; }
        .term-line { white-space: pre-wrap; word-break: break-word; min-height: 1.5em; }
        .term-line.pre { white-space: pre; overflow-x: auto; scrollbar-width: none; }
        .term-line.head { color: #79c0ff; font-weight: 600; }
        .term-line.dim { color: #8b949e; }
        .term-line.err { color: #ff7b72; }
        .term-line.ok { color: #7ee787; }
        .term-line.warn { color: #e3b341; }
        .term-line.code { color: #d2a8ff; }
        .term-line.prompt { color: #e6edf3; margin-top: 4px; }
        .term-line a { color: #7ee787; text-decoration: none; }
        .term-line a:hover { text-decoration: underline; }
        .term-input { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
        .term-prompt { color: #7ee787; white-space: nowrap; font: inherit; }
        .term button::before, .term button::after { content: none; display: none; }
        .term-input input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: #e6edf3; font: inherit; padding: 0; margin: 0; height: auto; box-shadow: none; caret-color: #7ee787; }
        .term-quick { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #30363d; background: #161b22; overflow-x: auto; scrollbar-width: none; }
        .term-quick button { flex: none; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 999px; padding: 4px 10px; font: 12px ui-monospace, Menlo, monospace; cursor: pointer; height: auto; line-height: 1.4; margin: 0; box-shadow: none; }
        .term-quick button:hover { border-color: #7ee787; color: #7ee787; }
        @media (max-width: 640px) {
          .term-backdrop { align-items: flex-end; padding: 0; }
          .term { height: 78vh; border-radius: 14px 14px 0 0; font-size: 12px; }
        }
        :global(html.site-terminal-open .launch-button) { display: none !important; }
        @keyframes tin { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .term-backdrop { animation: none; } }
      `}</style>
    </div>
  );
}
