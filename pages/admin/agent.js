// pages/admin/agent.js
// Operate console — talks to portfolio-agent-service via the Next.js
// `/api/agent/intent` and `/api/agent/intent/confirm` proxies.
//
// Goals:
//   * Type any natural-language request ("list failed email deliveries",
//     "帮我搜索 Kafka 相关的文章", "republish article 12").
//   * See the structured response: OK / ASK / CONFIRMATION_REQUIRED /
//     FORBIDDEN / GENERAL_CHAT / ERROR.
//   * For CONFIRMATION_REQUIRED, see the staged tool + arguments and
//     click Confirm or Cancel.
//
// This page is intentionally lightweight: no streaming, no markdown, no
// fancy formatting — pure JSON envelopes so you can verify the pipeline.

import { useEffect, useRef, useState } from "react";
import AdminLayout from "../../src/components/admin/AdminLayout";
import { supabase } from "../../src/supabase/supabaseClient";

function generateSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function callAgent(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { "Content-Type": "application/json" };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, text };
}

const TYPE_BADGE = {
  OK: { bg: "#065f46", fg: "#d1fae5" },
  ASK: { bg: "#92400e", fg: "#fde68a" },
  CONFIRMATION_REQUIRED: { bg: "#7c2d12", fg: "#fed7aa" },
  FORBIDDEN: { bg: "#7f1d1d", fg: "#fecaca" },
  GENERAL_CHAT: { bg: "#1e3a8a", fg: "#bfdbfe" },
  ERROR: { bg: "#7f1d1d", fg: "#fecaca" },
};

export default function AdminAgentPage() {
  const sessionRef = useRef(generateSessionId());
  const inputRef = useRef(null);
  const [email, setEmail] = useState("");
  const [utterance, setUtterance] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]); // [{role, ...}]

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data?.session?.user?.email || "");
    });
  }, []);

  const append = (entry) => setHistory((prev) => [...prev, { ts: Date.now(), ...entry }]);

  const send = async (e) => {
    e?.preventDefault?.();
    const text = utterance.trim();
    if (!text || sending) return;
    setSending(true);
    setUtterance("");
    append({ role: "user", text });
    try {
      const r = await callAgent("/api/agent/intent", {
        sessionId: sessionRef.current,
        utterance: text,
        pageContext: { page: "/admin/agent" },
      });
      append({ role: "agent", status: r.status, payload: r.json, raw: r.text });
    } catch (err) {
      append({ role: "agent", error: String(err) });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const confirm = async (pendingActionId, accept) => {
    setSending(true);
    append({
      role: "user",
      text: `[${accept ? "CONFIRM" : "CANCEL"} pending action ${pendingActionId.slice(0, 8)}…]`,
    });
    try {
      const r = await callAgent("/api/agent/intent/confirm", {
        sessionId: sessionRef.current,
        pendingActionId,
        confirm: accept,
      });
      append({ role: "agent", status: r.status, payload: r.json, raw: r.text });
    } catch (err) {
      append({ role: "agent", error: String(err) });
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    sessionRef.current = generateSessionId();
    setHistory([]);
  };

  return (
    <AdminLayout>
      <div className="op-header">
        <h1>Operate Console</h1>
        <div className="op-meta">
          <span>session: <code>{sessionRef.current}</code></span>
          {email ? <span>signed in as <strong>{email}</strong></span> : <span style={{ color: "#fca5a5" }}>not signed in (VIEWER only)</span>}
          <button onClick={reset} className="op-btn op-btn-ghost">Reset</button>
        </div>
        <p className="op-hint">
          Type any natural-language request in any language. Read-only intents execute immediately.
          Write intents (publish, reindex, retry, send-test, unsubscribe…) return
          <code>CONFIRMATION_REQUIRED</code> with the staged tool — click Confirm to fire.
        </p>
      </div>

      <div className="op-log">
        {history.length === 0 && <div className="op-empty">No messages yet — try the examples below.</div>}
        {history.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="op-row op-row-user">
                <div className="op-bubble op-bubble-user">{m.text}</div>
              </div>
            );
          }
          const p = m.payload || {};
          const badge = TYPE_BADGE[p.type] || { bg: "#334155", fg: "#cbd5e1" };
          return (
            <div key={i} className="op-row op-row-agent">
              <div className="op-bubble op-bubble-agent">
                <div className="op-bubble-head">
                  {p.type && (
                    <span className="op-badge" style={{ background: badge.bg, color: badge.fg }}>
                      {p.type}
                    </span>
                  )}
                  <span className="op-status">HTTP {m.status}</span>
                </div>
                {p.message && <div className="op-msg">{p.message}</div>}
                {p.clarificationQuestion && <div className="op-msg">{p.clarificationQuestion}</div>}
                {p.options && Array.isArray(p.options) && (
                  <div className="op-opts">
                    {p.options.map((o, j) => (
                      <button
                        key={j}
                        className="op-btn op-btn-ghost"
                        onClick={() => {
                          setUtterance(typeof o === "string" ? o : o.label || o.value || JSON.stringify(o));
                          inputRef.current?.focus();
                        }}
                      >
                        {typeof o === "string" ? o : o.label || JSON.stringify(o)}
                      </button>
                    ))}
                  </div>
                )}
                {p.type === "CONFIRMATION_REQUIRED" && p.pendingActionId && (
                  <div className="op-confirm">
                    <div className="op-confirm-meta">
                      <strong>Tool:</strong> <code>{p.tool || p.targetTool}</code>{" "}
                      <strong>Risk:</strong> <code>{p.riskLevel}</code>
                    </div>
                    {p.arguments && (
                      <pre className="op-pre">{JSON.stringify(p.arguments, null, 2)}</pre>
                    )}
                    <div className="op-confirm-actions">
                      <button className="op-btn op-btn-confirm" onClick={() => confirm(p.pendingActionId, true)} disabled={sending}>
                        Confirm
                      </button>
                      <button className="op-btn op-btn-ghost" onClick={() => confirm(p.pendingActionId, false)} disabled={sending}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {p.result && (
                  <details className="op-details" open>
                    <summary>result</summary>
                    <pre className="op-pre">{JSON.stringify(p.result, null, 2)}</pre>
                  </details>
                )}
                <details className="op-details">
                  <summary>raw envelope</summary>
                  <pre className="op-pre">{JSON.stringify(p, null, 2)}</pre>
                </details>
                {m.error && <div className="op-msg" style={{ color: "#fca5a5" }}>{m.error}</div>}
                {!p && m.raw && <pre className="op-pre">{m.raw}</pre>}
              </div>
            </div>
          );
        })}
      </div>

      <form className="op-composer" onSubmit={send}>
        <input
          ref={inputRef}
          className="op-input"
          placeholder='e.g. "list failed email deliveries today" or "帮我搜索 Kafka 相关的文章"'
          value={utterance}
          onChange={(e) => setUtterance(e.target.value)}
          disabled={sending}
          autoFocus
        />
        <button className="op-btn op-btn-primary" type="submit" disabled={sending || !utterance.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>

      <div className="op-examples">
        <span>Try:</span>
        {[
          "list failed email deliveries today",
          "check delivery stats",
          "帮我搜索 Kafka 相关的文章",
          "republish the latest Kafka blog",
          "what is the weather today",
        ].map((s, i) => (
          <button key={i} className="op-chip" onClick={() => setUtterance(s)}>{s}</button>
        ))}
      </div>

      <style jsx>{`
        .op-header h1 { color: #f1f5f9; margin: 0 0 8px; font-size: 1.6rem; font-weight: 700; }
        .op-meta { display: flex; gap: 16px; flex-wrap: wrap; color: #94a3b8; font-size: 0.85rem; align-items: center; }
        .op-meta code { color: #38bdf8; background: rgba(56,189,248,0.08); padding: 2px 6px; border-radius: 4px; font-size: 0.78rem; }
        .op-meta strong { color: #f1f5f9; }
        .op-hint { color: #94a3b8; font-size: 0.85rem; margin: 12px 0 24px; }
        .op-hint code { color: #fcd34d; background: rgba(252,211,77,0.08); padding: 2px 6px; border-radius: 4px; font-size: 0.78rem; }

        .op-log {
          background: #0f172a;
          border: 1px solid rgba(148,163,184,0.12);
          border-radius: 16px;
          padding: 16px;
          min-height: 320px;
          max-height: 60vh;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .op-empty { color: #64748b; text-align: center; padding: 60px 12px; }
        .op-row { display: flex; }
        .op-row-user { justify-content: flex-end; }
        .op-row-agent { justify-content: flex-start; }
        .op-bubble {
          max-width: 88%;
          border-radius: 12px;
          padding: 12px 16px;
          font-size: 0.88rem;
          line-height: 1.5;
        }
        .op-bubble-user { background: #1e40af; color: #dbeafe; }
        .op-bubble-agent { background: #1e293b; color: #e2e8f0; border: 1px solid rgba(148,163,184,0.12); }
        .op-bubble-head { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
        .op-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; font-weight: 700; letter-spacing: 0.04em; }
        .op-status { font-size: 0.72rem; color: #64748b; font-family: ui-monospace, monospace; }
        .op-msg { margin: 8px 0; }
        .op-opts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
        .op-confirm { margin-top: 8px; border-top: 1px dashed rgba(148,163,184,0.2); padding-top: 8px; }
        .op-confirm-meta { font-size: 0.82rem; color: #cbd5e1; margin-bottom: 6px; }
        .op-confirm-meta code { color: #fcd34d; }
        .op-confirm-actions { display: flex; gap: 8px; margin-top: 8px; }
        .op-pre { background: #0b1220; color: #cbd5e1; padding: 10px 12px; border-radius: 8px; overflow-x: auto; font-size: 0.78rem; margin: 6px 0; }
        .op-details summary { cursor: pointer; color: #94a3b8; font-size: 0.78rem; margin-top: 6px; }

        .op-composer { display: flex; gap: 8px; margin-top: 16px; }
        .op-input { flex: 1; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.2); background: #0f172a; color: #f1f5f9; font-size: 0.95rem; }
        .op-input:focus { outline: none; border-color: #38bdf8; }
        .op-btn { padding: 9px 16px; border-radius: 10px; font-size: 0.85rem; cursor: pointer; border: 1px solid transparent; transition: opacity 120ms; font-weight: 600; }
        .op-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .op-btn-primary { background: #38bdf8; color: #0f172a; border: 1px solid #38bdf8; }
        .op-btn-confirm { background: #16a34a; color: #052e16; border: 1px solid #16a34a; }
        .op-btn-ghost { background: transparent; color: #cbd5e1; border: 1px solid rgba(148,163,184,0.3); }

        .op-examples { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; color: #94a3b8; font-size: 0.8rem; align-items: center; }
        .op-chip { background: rgba(148,163,184,0.08); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.2); border-radius: 999px; padding: 4px 10px; font-size: 0.78rem; cursor: pointer; }
        .op-chip:hover { background: rgba(148,163,184,0.16); }
      `}</style>
    </AdminLayout>
  );
}
