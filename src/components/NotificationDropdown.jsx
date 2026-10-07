import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, RefreshCw } from "lucide-react";
import styles from "../../styles/NotificationBell.module.css";

/**
 * Dropdown panel rendered by NotificationBell.
 * Props:
 *   - items: [{ recipientId, notificationId, topic, title, body, url, status, createdAt }]
 *   - loading: boolean
 *   - onClose: () => void
 *   - onMarkRead: (recipientId) => Promise<void>
 *   - onRefresh: () => void
 */
export default function NotificationDropdown({ anchorRef, items, loading, error, onClose, onMarkRead, onRefresh, onSettings, isDark = false }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ visibility: "hidden" });
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(340, window.innerWidth - 24);
      const top = Math.min(rect.bottom + 8, window.innerHeight - 100);
      setPosition({ width, top, right: "auto", left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), maxHeight: Math.min(420, window.innerHeight - top - 12) });
    };
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchorRef]);

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose && onClose();
    }
    function onKey(e) { if (e.key === "Escape") { onClose?.(); anchorRef.current?.focus(); } }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorRef]);

  const dk = isDark;
  const panel = { ...panelStyle, background: dk ? "#1e1e2a" : "#fff", color: dk ? "#e8e8e8" : "#111", boxShadow: dk ? "0 10px 30px rgba(0,0,0,0.5)" : panelStyle.boxShadow };
  const hdr = { ...headerStyle, background: dk ? "#1e1e2a" : "#fff", borderBottom: `1px solid ${dk ? "#333" : "#eee"}` };
  const refBtn = { ...refreshBtnStyle, border: `1px solid ${dk ? "#444" : "#ddd"}`, color: dk ? "#ccc" : "inherit" };

  return createPortal(
    <div ref={ref} role="dialog" aria-label="Notifications" className={styles.panel} style={{ ...panel, ...position }}>
      <div style={hdr}>
        <strong style={{ fontSize: 14 }}>Notifications</strong>
        <button type="button" onClick={onRefresh} disabled={loading} style={refBtn} aria-label="Refresh notifications" title="Refresh notifications">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>

      {error && <div role="alert" style={emptyStyle}>{error}</div>}
      {items.length === 0 ? (
        <div style={emptyStyle}>
          {loading ? "Loading…" : error ? "" : "No notifications yet."}
        </div>
      ) : (
        <ul style={listStyle}>
          {items.map((item) => {
            const unread = item.status === "PENDING" || item.status === "SENT";
            return (
              <li
                key={item.recipientId}
                style={{ ...itemStyle, background: unread ? (dk ? "#252535" : "#f5f8ff") : (dk ? "#1e1e2a" : "#fff") }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <a
                    href={item.url || "#"}
                    target={item.url ? "_blank" : undefined}
                    rel="noreferrer noopener"
                    onClick={() => unread && onMarkRead && onMarkRead(item.recipientId)}
                    style={{ color: dk ? "#e8e8e8" : "#111", textDecoration: "none", flex: 1 }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{item.title}</div>
                    {item.body && (
                      <div style={{ fontSize: 12, color: dk ? "#aaa" : "#444", lineHeight: 1.35 }}>
                        {item.body.length > 140 ? `${item.body.slice(0, 140)}…` : item.body}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: dk ? "#777" : "#888", marginTop: 4 }}>
                      {formatDate(item.createdAt)} · {labelForTopic(item.topic)}
                    </div>
                  </a>
                  {unread && (
                    <button
                      type="button"
                      onClick={() => onMarkRead && onMarkRead(item.recipientId)}
                      style={markBtnStyle}
                      title="Mark as read"
                    >
                    <Check size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {onSettings && <button type="button" onClick={onSettings} style={{ ...refreshBtnStyle, margin: 12, width: "auto", height: "auto", padding: "8px 12px" }}>Notification settings</button>}
    </div>, document.body
  );
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

function labelForTopic(t) {
  switch (t) {
    case "ARTICLE_UPDATES": return "Article";
    case "FEATURE_UPDATES": return "Feature";
    case "JOB_UPDATES": return "Job";
    default: return t || "";
  }
}

const panelStyle = {
  position: "fixed",
  right: 0,
  top: "calc(100% + 8px)",
  width: 340,
  maxHeight: 420,
  overflowY: "auto",
  background: "#fff",
  color: "#111",
  borderRadius: 8,
  boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  zIndex: 9998,
};

const headerStyle = {
  position: "sticky",
  top: 0,
  background: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderBottom: "1px solid #eee",
};

const refreshBtnStyle = {
  background: "none",
  border: "1px solid #ddd",
  borderRadius: 4,
  width: 26,
  height: 26,
  cursor: "pointer",
};

const emptyStyle = {
  padding: "18px 12px",
  textAlign: "center",
  fontSize: 13,
  color: "#666",
};

const listStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};

const itemStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid #eee",
};

const markBtnStyle = {
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  width: 26,
  height: 26,
  fontSize: 14,
  flexShrink: 0,
};
